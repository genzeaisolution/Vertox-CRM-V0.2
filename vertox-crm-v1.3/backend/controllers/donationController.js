const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');
const { validateRequired, hasErrors, sendValidationError } = require('../utils/validate');
const { notifyUser } = require('../utils/notify');

// Same guard pattern used by shiftController/eventController — confirms
// the RecordId actually belongs to the 'donations' module before any
// lifecycle action touches it.
async function assertIsDonationRecord(pool, recordId) {
  const row = await pool.request().input('id', sql.Int, recordId).query(`
    SELECT r.RecordId, r.Title, r.FieldsJson, r.OwnerId, r.ModuleId
    FROM dbo.Records r JOIN dbo.Modules m ON m.ModuleId = r.ModuleId
    WHERE r.RecordId = @id AND m.ModuleKey = 'donations'
  `);
  return row.recordset[0] || null;
}

async function saveFields(pool, recordId, fields) {
  await pool.request()
    .input('id', sql.Int, recordId)
    .input('fieldsJson', sql.NVarChar, JSON.stringify(fields))
    .query(`UPDATE dbo.Records SET FieldsJson = @fieldsJson, UpdatedAt = SYSUTCDATETIME() WHERE RecordId = @id`);
}

// Mark a donation as acknowledged (i.e. thank-you receipt sent to donor).
// Only valid from Pending/Confirmed — an already-refunded or cancelled
// donation shouldn't silently flip back to "acknowledged".
async function acknowledgeDonation(req, res) {
  try {
    const pool = await getPool();
    const donation = await assertIsDonationRecord(pool, req.params.id);
    if (!donation) return res.status(404).json({ message: 'Donation record not found' });

    const fields = donation.FieldsJson ? JSON.parse(donation.FieldsJson) : {};
    if (['Refunded', 'Cancelled'].includes(fields.donation_status)) {
      return res.status(400).json({ message: `Cannot acknowledge a donation that is already ${fields.donation_status}` });
    }

    fields.donation_status = 'Acknowledged';
    fields.acknowledgement_sent_date = new Date().toISOString().slice(0, 10);
    await saveFields(pool, donation.RecordId, fields);
    logger.audit(req.user?.userId, 'donation.acknowledge', { recordId: donation.RecordId });
    res.json({ message: 'Donation acknowledged', fields });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'donationController.js:acknowledge' });
    res.status(500).json({ message: 'Failed to acknowledge donation' });
  }
}

// Refund a donation: records refund fields on the donation itself AND
// writes a matching negative 'refund' entry to the shared ledger (base
// currency, PKR) so the org's financial totals reflect the money actually
// leaving — a refund that only lived on the donation record and never hit
// the ledger would silently overstate income.
async function refundDonation(req, res) {
  try {
    const { refundAmount, refundReason } = req.body;
    const errors = {};
    validateRequired(refundAmount, 'Refund Amount', errors, 'refundAmount');
    validateRequired(refundReason, 'Refund Reason', errors, 'refundReason');
    if (refundAmount !== undefined && (isNaN(Number(refundAmount)) || Number(refundAmount) <= 0)) {
      errors.refundAmount = 'Refund Amount must be a positive number';
    }
    if (hasErrors(errors)) return sendValidationError(res, errors);

    const pool = await getPool();
    const donation = await assertIsDonationRecord(pool, req.params.id);
    if (!donation) return res.status(404).json({ message: 'Donation record not found' });

    const fields = donation.FieldsJson ? JSON.parse(donation.FieldsJson) : {};
    if (fields.donation_status === 'Refunded') {
      return res.status(400).json({ message: 'This donation has already been refunded' });
    }

    const today = new Date().toISOString().slice(0, 10);
    fields.donation_status = 'Refunded';
    fields.refund_date = today;
    fields.refund_amount = Number(refundAmount);
    fields.refund_reason = refundReason;
    await saveFields(pool, donation.RecordId, fields);

    // Write the matching ledger entry in the base currency.
    const baseCur = await pool.request().query(`SELECT TOP 1 CurrencyCode, ExchangeRateToBase FROM dbo.Currencies WHERE IsBase = 1`);
    if (baseCur.recordset[0]) {
      const { CurrencyCode, ExchangeRateToBase } = baseCur.recordset[0];
      const amountNum = -Math.abs(Number(refundAmount)); // negative = money leaving
      await pool.request()
        .input('entryDate', sql.DateTime2, new Date())
        .input('entryType', sql.NVarChar, 'refund')
        .input('description', sql.NVarChar, `Refund: ${donation.Title || 'Donation #' + donation.RecordId} — ${refundReason}`.slice(0, 255))
        .input('reference', sql.NVarChar, 'donation:' + donation.RecordId)
        .input('currencyCode', sql.NVarChar, CurrencyCode)
        .input('amount', sql.Decimal(18, 2), amountNum)
        .input('rate', sql.Decimal(18, 6), Number(ExchangeRateToBase))
        .input('amountBase', sql.Decimal(18, 2), amountNum * Number(ExchangeRateToBase))
        .input('createdBy', sql.Int, req.user.userId)
        .query(`
          INSERT INTO dbo.LedgerEntries (EntryDate, EntryType, Description, Reference, CurrencyCode, Amount, ExchangeRate, AmountBase, CreatedBy)
          VALUES (@entryDate, @entryType, @description, @reference, @currencyCode, @amount, @rate, @amountBase, @createdBy)
        `);
    } else {
      logger.error('CONTROLLER', 'No base currency configured — refund ledger entry skipped', { file: 'donationController.js:refund', recordId: donation.RecordId });
    }

    if (donation.OwnerId && Number(donation.OwnerId) !== Number(req.user.userId)) {
      await notifyUser(pool, donation.OwnerId, 'Donation refunded',
        `"${donation.Title || 'Donation'}" was refunded (Rs. ${refundAmount})`, 'records?module=donations');
    }

    logger.audit(req.user?.userId, 'donation.refund', { recordId: donation.RecordId, refundAmount });
    res.json({ message: 'Donation refunded and ledger updated', fields });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'donationController.js:refund' });
    res.status(500).json({ message: 'Failed to process refund', error: err.message });
  }
}

// Cancel a donation (e.g. a pledge/cheque that never cleared) — unlike a
// refund, no money moved, so no ledger entry is written; it's purely a
// status change with a required reason for the audit trail.
async function cancelDonation(req, res) {
  try {
    const { cancelReason } = req.body;
    const errors = {};
    validateRequired(cancelReason, 'Cancellation Reason', errors, 'cancelReason');
    if (hasErrors(errors)) return sendValidationError(res, errors);

    const pool = await getPool();
    const donation = await assertIsDonationRecord(pool, req.params.id);
    if (!donation) return res.status(404).json({ message: 'Donation record not found' });

    const fields = donation.FieldsJson ? JSON.parse(donation.FieldsJson) : {};
    if (fields.donation_status === 'Refunded') {
      return res.status(400).json({ message: 'A refunded donation cannot also be cancelled' });
    }
    fields.donation_status = 'Cancelled';
    fields.refund_reason = cancelReason;
    await saveFields(pool, donation.RecordId, fields);

    logger.audit(req.user?.userId, 'donation.cancel', { recordId: donation.RecordId });
    res.json({ message: 'Donation cancelled', fields });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'donationController.js:cancel' });
    res.status(500).json({ message: 'Failed to cancel donation' });
  }
}

module.exports = { acknowledgeDonation, refundDonation, cancelDonation };
