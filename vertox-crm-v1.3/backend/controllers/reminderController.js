const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');
const { validateRequired, validateNumber, validateDate, hasErrors, sendValidationError } = require('../utils/validate');
const { FREQUENCIES } = require('../utils/recurrence');
const { runReminderSweepNow } = require('../utils/reminderScheduler');

// ===== Recurring Donation Schedules =====

async function listSchedules(req, res) {
  try {
    const { status } = req.query;
    const pool = await getPool();
    const request = pool.request();
    let where = '1=1';
    if (status) { request.input('status', sql.NVarChar, status); where += ' AND s.Status = @status'; }
    const result = await request.query(`
      SELECT s.*, r.Title AS DonationTitle
      FROM dbo.DonationSchedules s
      LEFT JOIN dbo.Records r ON r.RecordId = s.DonationRecordId
      WHERE ${where}
      ORDER BY s.NextDueDate ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'reminderController.js' });
    res.status(500).json({ message: 'Failed to fetch recurring donation schedules' });
  }
}

function validateScheduleBody(body) {
  const { donorName, amount, frequency, startDate } = body;
  const errors = {};
  validateRequired(donorName, 'Donor Name', errors, 'donorName');
  validateNumber(amount, 'Amount', errors, 'amount', true);
  if (!errors.amount && Number(amount) <= 0) errors.amount = 'Amount must be greater than zero';
  validateRequired(frequency, 'Frequency', errors, 'frequency');
  if (frequency && !FREQUENCIES.includes(frequency)) errors.frequency = 'Frequency must be one of: ' + FREQUENCIES.join(', ');
  validateDate(startDate, 'Start Date', errors, 'startDate', true);
  return errors;
}

async function createSchedule(req, res) {
  try {
    const errors = validateScheduleBody(req.body);
    if (hasErrors(errors)) return sendValidationError(res, errors);

    const { donationRecordId, donorName, amount, currencyCode, frequency, startDate, notes } = req.body;
    const pool = await getPool();

    if (currencyCode) {
      const cur = await pool.request().input('code', sql.NVarChar, currencyCode).query(`SELECT 1 FROM dbo.Currencies WHERE CurrencyCode = @code`);
      if (!cur.recordset[0]) return sendValidationError(res, { currencyCode: 'Unknown currency' });
    }

    const result = await pool.request()
      .input('donationId', sql.Int, donationRecordId || null)
      .input('donorName', sql.NVarChar, donorName)
      .input('amount', sql.Decimal(18, 2), Number(amount))
      .input('currencyCode', sql.NVarChar, currencyCode || null)
      .input('frequency', sql.NVarChar, frequency)
      .input('startDate', sql.Date, startDate)
      .input('nextDue', sql.Date, startDate)
      .input('notes', sql.NVarChar, notes || null)
      .input('createdBy', sql.Int, req.user.userId)
      .query(`
        INSERT INTO dbo.DonationSchedules (DonationRecordId, DonorName, Amount, CurrencyCode, Frequency, StartDate, NextDueDate, Status, Notes, CreatedBy)
        OUTPUT INSERTED.ScheduleId
        VALUES (@donationId, @donorName, @amount, @currencyCode, @frequency, @startDate, @nextDue, 'Active', @notes, @createdBy)
      `);
    logger.audit(req.user?.userId, 'donationSchedule.create', { scheduleId: result.recordset[0].ScheduleId }, req);
    res.status(201).json({ scheduleId: result.recordset[0].ScheduleId, message: 'Recurring donation schedule created — reminders will generate automatically' });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'reminderController.js' });
    res.status(500).json({ message: 'Failed to create schedule', error: err.message });
  }
}

async function updateSchedule(req, res) {
  try {
    const errors = validateScheduleBody(req.body);
    if (hasErrors(errors)) return sendValidationError(res, errors);

    const { donorName, amount, currencyCode, frequency, startDate, status, notes, nextDueDate } = req.body;
    const pool = await getPool();
    const existing = await pool.request().input('id', sql.Int, req.params.id).query(`SELECT * FROM dbo.DonationSchedules WHERE ScheduleId = @id`);
    if (!existing.recordset[0]) return res.status(404).json({ message: 'Schedule not found' });

    if (currencyCode) {
      const cur = await pool.request().input('code', sql.NVarChar, currencyCode).query(`SELECT 1 FROM dbo.Currencies WHERE CurrencyCode = @code`);
      if (!cur.recordset[0]) return sendValidationError(res, { currencyCode: 'Unknown currency' });
    }
    const allowedStatus = ['Active', 'Paused', 'Cancelled'];
    if (status && !allowedStatus.includes(status)) return sendValidationError(res, { status: 'Status must be one of: ' + allowedStatus.join(', ') });

    await pool.request()
      .input('id', sql.Int, req.params.id)
      .input('donorName', sql.NVarChar, donorName)
      .input('amount', sql.Decimal(18, 2), Number(amount))
      .input('currencyCode', sql.NVarChar, currencyCode || null)
      .input('frequency', sql.NVarChar, frequency)
      .input('startDate', sql.Date, startDate)
      .input('nextDue', sql.Date, nextDueDate || existing.recordset[0].NextDueDate)
      .input('status', sql.NVarChar, status || existing.recordset[0].Status)
      .input('notes', sql.NVarChar, notes || null)
      .query(`
        UPDATE dbo.DonationSchedules
        SET DonorName=@donorName, Amount=@amount, CurrencyCode=@currencyCode, Frequency=@frequency,
            StartDate=@startDate, NextDueDate=@nextDue, Status=@status, Notes=@notes, UpdatedAt=SYSUTCDATETIME()
        WHERE ScheduleId=@id
      `);
    logger.audit(req.user?.userId, 'donationSchedule.update', { scheduleId: req.params.id }, req);
    res.json({ message: 'Schedule updated successfully' });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'reminderController.js' });
    res.status(500).json({ message: 'Failed to update schedule', error: err.message });
  }
}

async function deleteSchedule(req, res) {
  try {
    const pool = await getPool();
    const existing = await pool.request().input('id', sql.Int, req.params.id).query(`SELECT 1 FROM dbo.DonationSchedules WHERE ScheduleId = @id`);
    if (!existing.recordset[0]) return res.status(404).json({ message: 'Schedule not found' });
    await pool.request().input('id', sql.Int, req.params.id).query(`DELETE FROM dbo.DonationSchedules WHERE ScheduleId = @id`);
    logger.audit(req.user?.userId, 'donationSchedule.delete', { scheduleId: req.params.id }, req);
    res.json({ message: 'Schedule deleted successfully' });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'reminderController.js' });
    res.status(500).json({ message: 'Failed to delete schedule', error: err.message });
  }
}

// ===== Generated Reminders =====

async function listReminders(req, res) {
  try {
    const { status } = req.query;
    const pool = await getPool();
    const request = pool.request();
    let where = '1=1';
    if (status) { request.input('status', sql.NVarChar, status); where += ' AND rem.Status = @status'; }
    const result = await request.query(`
      SELECT rem.*, s.DonorName, s.Amount, s.CurrencyCode, s.Frequency
      FROM dbo.DonationReminders rem
      JOIN dbo.DonationSchedules s ON s.ScheduleId = rem.ScheduleId
      WHERE ${where}
      ORDER BY rem.DueDate DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'reminderController.js' });
    res.status(500).json({ message: 'Failed to fetch reminders' });
  }
}

async function actionReminder(req, res) {
  try {
    const { status } = req.body; // Sent / Dismissed / Collected
    const allowed = ['Sent', 'Dismissed', 'Collected'];
    if (!allowed.includes(status)) return sendValidationError(res, { status: 'Status must be one of: ' + allowed.join(', ') });

    const pool = await getPool();
    const existing = await pool.request().input('id', sql.Int, req.params.id).query(`SELECT 1 FROM dbo.DonationReminders WHERE ReminderId = @id`);
    if (!existing.recordset[0]) return res.status(404).json({ message: 'Reminder not found' });

    await pool.request()
      .input('id', sql.Int, req.params.id)
      .input('status', sql.NVarChar, status)
      .input('userId', sql.Int, req.user.userId)
      .query(`UPDATE dbo.DonationReminders SET Status=@status, ActionedAt=SYSUTCDATETIME(), ActionedBy=@userId WHERE ReminderId=@id`);
    logger.audit(req.user?.userId, 'reminder.action', { reminderId: req.params.id, status }, req);
    res.json({ message: 'Reminder updated' });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'reminderController.js' });
    res.status(500).json({ message: 'Failed to update reminder', error: err.message });
  }
}

// Lets an admin manually trigger the same sweep the background scheduler
// runs automatically every day — useful right after creating a schedule
// whose start date is today, or for on-demand testing without waiting for
// the next scheduled tick.
async function runSweepNow(req, res) {
  try {
    const result = await runReminderSweepNow();
    logger.audit(req.user?.userId, 'reminder.manualSweep', result, req);
    res.json({ message: 'Reminder sweep completed', ...result });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'reminderController.js' });
    res.status(500).json({ message: 'Failed to run reminder sweep', error: err.message });
  }
}

module.exports = {
  listSchedules, createSchedule, updateSchedule, deleteSchedule,
  listReminders, actionReminder, runSweepNow
};
