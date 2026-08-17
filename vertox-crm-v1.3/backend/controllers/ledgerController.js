const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');
const { validateRequired, validateNumber, validateDate, hasErrors, sendValidationError } = require('../utils/validate');

const ENTRY_TYPES = ['grant', 'income', 'expense'];

// ===== Currencies =====

async function listCurrencies(req, res) {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`SELECT * FROM dbo.Currencies ORDER BY IsBase DESC, CurrencyCode`);
    res.json(result.recordset);
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'ledgerController.js' });
    res.status(500).json({ message: 'Failed to fetch currencies' });
  }
}

async function createCurrency(req, res) {
  try {
    const { currencyCode, currencyName, symbol, exchangeRateToBase } = req.body;
    const errors = {};
    validateRequired(currencyCode, 'Currency Code', errors, 'currencyCode');
    validateRequired(currencyName, 'Currency Name', errors, 'currencyName');
    if (currencyCode && !/^[A-Za-z]{3}$/.test(currencyCode)) errors.currencyCode = 'Currency Code must be a 3-letter code (e.g. USD)';
    validateNumber(exchangeRateToBase, 'Exchange Rate', errors, 'exchangeRateToBase', true);
    if (!errors.exchangeRateToBase && Number(exchangeRateToBase) <= 0) errors.exchangeRateToBase = 'Exchange Rate must be greater than zero';
    if (hasErrors(errors)) return sendValidationError(res, errors);

    const pool = await getPool();
    const code = String(currencyCode).toUpperCase();
    const existing = await pool.request().input('code', sql.NVarChar, code)
      .query(`SELECT 1 FROM dbo.Currencies WHERE CurrencyCode = @code`);
    if (existing.recordset[0]) return sendValidationError(res, { currencyCode: 'This currency code already exists' });

    await pool.request()
      .input('code', sql.NVarChar, code)
      .input('name', sql.NVarChar, currencyName)
      .input('symbol', sql.NVarChar, symbol || null)
      .input('rate', sql.Decimal(18, 6), Number(exchangeRateToBase))
      .query(`
        INSERT INTO dbo.Currencies (CurrencyCode, CurrencyName, Symbol, ExchangeRateToBase, IsBase)
        VALUES (@code, @name, @symbol, @rate, 0)
      `);
    logger.audit(req.user?.userId, 'currency.create', { currencyCode: code }, req);
    res.status(201).json({ currencyCode: code, message: 'Currency added successfully' });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'ledgerController.js' });
    res.status(500).json({ message: 'Failed to add currency', error: err.message });
  }
}

async function updateCurrency(req, res) {
  try {
    const { code } = req.params;
    const { currencyName, symbol, exchangeRateToBase } = req.body;
    const pool = await getPool();

    const existing = await pool.request().input('code', sql.NVarChar, code)
      .query(`SELECT * FROM dbo.Currencies WHERE CurrencyCode = @code`);
    if (!existing.recordset[0]) return res.status(404).json({ message: 'Currency not found' });
    if (existing.recordset[0].IsBase && Number(exchangeRateToBase) !== 1) {
      return sendValidationError(res, { exchangeRateToBase: 'Base currency rate must stay 1' });
    }

    const errors = {};
    validateRequired(currencyName, 'Currency Name', errors, 'currencyName');
    validateNumber(exchangeRateToBase, 'Exchange Rate', errors, 'exchangeRateToBase', true);
    if (!errors.exchangeRateToBase && Number(exchangeRateToBase) <= 0) errors.exchangeRateToBase = 'Exchange Rate must be greater than zero';
    if (hasErrors(errors)) return sendValidationError(res, errors);

    await pool.request()
      .input('code', sql.NVarChar, code)
      .input('name', sql.NVarChar, currencyName)
      .input('symbol', sql.NVarChar, symbol || null)
      .input('rate', sql.Decimal(18, 6), Number(exchangeRateToBase))
      .query(`
        UPDATE dbo.Currencies
        SET CurrencyName = @name, Symbol = @symbol, ExchangeRateToBase = @rate, UpdatedAt = SYSUTCDATETIME()
        WHERE CurrencyCode = @code
      `);
    logger.audit(req.user?.userId, 'currency.update', { currencyCode: code }, req);
    res.json({ message: 'Currency updated successfully' });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'ledgerController.js' });
    res.status(500).json({ message: 'Failed to update currency', error: err.message });
  }
}

async function deleteCurrency(req, res) {
  try {
    const { code } = req.params;
    const pool = await getPool();

    const existing = await pool.request().input('code', sql.NVarChar, code)
      .query(`SELECT IsBase FROM dbo.Currencies WHERE CurrencyCode = @code`);
    if (!existing.recordset[0]) return res.status(404).json({ message: 'Currency not found' });
    if (existing.recordset[0].IsBase) return res.status(403).json({ message: 'Base currency cannot be deleted' });

    const inUse = await pool.request().input('code', sql.NVarChar, code)
      .query(`SELECT TOP 1 1 AS x FROM dbo.LedgerEntries WHERE CurrencyCode = @code`);
    if (inUse.recordset[0]) return res.status(409).json({ message: 'Currency is used by existing ledger entries and cannot be deleted' });

    await pool.request().input('code', sql.NVarChar, code).query(`DELETE FROM dbo.Currencies WHERE CurrencyCode = @code`);
    logger.audit(req.user?.userId, 'currency.delete', { currencyCode: code }, req);
    res.json({ message: 'Currency deleted successfully' });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'ledgerController.js' });
    res.status(500).json({ message: 'Failed to delete currency', error: err.message });
  }
}

// ===== Ledger Entries =====

function buildDateWhere(request, from, to, alias = 'l') {
  let where = '1=1';
  if (from) { request.input('from', sql.DateTime2, new Date(from)); where += ` AND ${alias}.EntryDate >= @from`; }
  if (to) {
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);
    request.input('to', sql.DateTime2, toDate);
    where += ` AND ${alias}.EntryDate <= @to`;
  }
  return where;
}

async function listEntries(req, res) {
  try {
    const { from, to, currency, type } = req.query;
    const pool = await getPool();
    const request = pool.request();
    let where = buildDateWhere(request, from, to, 'l');
    if (currency) { request.input('currency', sql.NVarChar, currency); where += ' AND l.CurrencyCode = @currency'; }
    if (type) { request.input('type', sql.NVarChar, type); where += ' AND l.EntryType = @type'; }

    const result = await request.query(`
      SELECT l.*, u.FullName AS CreatedByName
      FROM dbo.LedgerEntries l
      LEFT JOIN dbo.Users u ON u.UserId = l.CreatedBy
      WHERE ${where}
      ORDER BY l.EntryDate DESC, l.EntryId DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'ledgerController.js' });
    res.status(500).json({ message: 'Failed to fetch ledger entries' });
  }
}

async function getLedgerSummary(req, res) {
  try {
    const { from, to } = req.query;
    const pool = await getPool();
    const request = pool.request();
    const where = buildDateWhere(request, from, to, 'l');

    const byCurrency = await request.query(`
      SELECT l.CurrencyCode, c.Symbol, c.CurrencyName, l.EntryType, SUM(l.Amount) AS total, SUM(l.AmountBase) AS totalBase
      FROM dbo.LedgerEntries l
      JOIN dbo.Currencies c ON c.CurrencyCode = l.CurrencyCode
      WHERE ${where}
      GROUP BY l.CurrencyCode, c.Symbol, c.CurrencyName, l.EntryType
    `);

    const base = await pool.request().query(`SELECT CurrencyCode FROM dbo.Currencies WHERE IsBase = 1`);

    res.json({
      baseCurrency: base.recordset[0]?.CurrencyCode || 'USD',
      byCurrency: byCurrency.recordset
    });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'ledgerController.js' });
    res.status(500).json({ message: 'Failed to build ledger summary', error: err.message });
  }
}

async function createEntry(req, res) {
  try {
    const { entryDate, entryType, description, reference, currencyCode, amount } = req.body;
    const errors = {};
    validateDate(entryDate, 'Entry Date', errors, 'entryDate', true);
    validateRequired(entryType, 'Entry Type', errors, 'entryType');
    if (entryType && !ENTRY_TYPES.includes(entryType)) errors.entryType = 'Entry Type must be grant, income or expense';
    validateRequired(description, 'Description', errors, 'description');
    validateRequired(currencyCode, 'Currency', errors, 'currencyCode');
    validateNumber(amount, 'Amount', errors, 'amount', true);
    if (!errors.amount && Number(amount) <= 0) errors.amount = 'Amount must be greater than zero';
    if (hasErrors(errors)) return sendValidationError(res, errors);

    const pool = await getPool();
    const cur = await pool.request().input('code', sql.NVarChar, currencyCode)
      .query(`SELECT * FROM dbo.Currencies WHERE CurrencyCode = @code`);
    if (!cur.recordset[0]) return sendValidationError(res, { currencyCode: 'Unknown currency' });

    const rate = Number(cur.recordset[0].ExchangeRateToBase);
    const amountNum = Number(amount);
    const amountBase = Math.round(amountNum * rate * 100) / 100;

    const result = await pool.request()
      .input('entryDate', sql.DateTime2, new Date(entryDate))
      .input('entryType', sql.NVarChar, entryType)
      .input('description', sql.NVarChar, description)
      .input('reference', sql.NVarChar, reference || null)
      .input('currencyCode', sql.NVarChar, currencyCode)
      .input('amount', sql.Decimal(18, 2), amountNum)
      .input('rate', sql.Decimal(18, 6), rate)
      .input('amountBase', sql.Decimal(18, 2), amountBase)
      .input('createdBy', sql.Int, req.user.userId)
      .query(`
        INSERT INTO dbo.LedgerEntries (EntryDate, EntryType, Description, Reference, CurrencyCode, Amount, ExchangeRate, AmountBase, CreatedBy)
        OUTPUT INSERTED.EntryId
        VALUES (@entryDate, @entryType, @description, @reference, @currencyCode, @amount, @rate, @amountBase, @createdBy)
      `);
    logger.audit(req.user?.userId, 'ledger.create', { entryId: result.recordset[0].EntryId, currencyCode, amount: amountNum }, req);
    res.status(201).json({ entryId: result.recordset[0].EntryId, message: 'Ledger entry recorded successfully' });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'ledgerController.js' });
    res.status(500).json({ message: 'Failed to record ledger entry', error: err.message });
  }
}

async function updateEntry(req, res) {
  try {
    const { entryDate, entryType, description, reference, currencyCode, amount } = req.body;
    const pool = await getPool();

    const existing = await pool.request().input('id', sql.Int, req.params.id)
      .query(`SELECT * FROM dbo.LedgerEntries WHERE EntryId = @id`);
    if (!existing.recordset[0]) return res.status(404).json({ message: 'Ledger entry not found' });

    const errors = {};
    validateDate(entryDate, 'Entry Date', errors, 'entryDate', true);
    validateRequired(entryType, 'Entry Type', errors, 'entryType');
    if (entryType && !ENTRY_TYPES.includes(entryType)) errors.entryType = 'Entry Type must be grant, income or expense';
    validateRequired(description, 'Description', errors, 'description');
    validateRequired(currencyCode, 'Currency', errors, 'currencyCode');
    validateNumber(amount, 'Amount', errors, 'amount', true);
    if (!errors.amount && Number(amount) <= 0) errors.amount = 'Amount must be greater than zero';
    if (hasErrors(errors)) return sendValidationError(res, errors);

    const cur = await pool.request().input('code', sql.NVarChar, currencyCode)
      .query(`SELECT * FROM dbo.Currencies WHERE CurrencyCode = @code`);
    if (!cur.recordset[0]) return sendValidationError(res, { currencyCode: 'Unknown currency' });

    const rate = Number(cur.recordset[0].ExchangeRateToBase);
    const amountNum = Number(amount);
    const amountBase = Math.round(amountNum * rate * 100) / 100;

    await pool.request()
      .input('id', sql.Int, req.params.id)
      .input('entryDate', sql.DateTime2, new Date(entryDate))
      .input('entryType', sql.NVarChar, entryType)
      .input('description', sql.NVarChar, description)
      .input('reference', sql.NVarChar, reference || null)
      .input('currencyCode', sql.NVarChar, currencyCode)
      .input('amount', sql.Decimal(18, 2), amountNum)
      .input('rate', sql.Decimal(18, 6), rate)
      .input('amountBase', sql.Decimal(18, 2), amountBase)
      .query(`
        UPDATE dbo.LedgerEntries
        SET EntryDate = @entryDate, EntryType = @entryType, Description = @description, Reference = @reference,
            CurrencyCode = @currencyCode, Amount = @amount, ExchangeRate = @rate, AmountBase = @amountBase,
            UpdatedAt = SYSUTCDATETIME()
        WHERE EntryId = @id
      `);
    logger.audit(req.user?.userId, 'ledger.update', { entryId: req.params.id }, req);
    res.json({ message: 'Ledger entry updated successfully' });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'ledgerController.js' });
    res.status(500).json({ message: 'Failed to update ledger entry', error: err.message });
  }
}

async function deleteEntry(req, res) {
  try {
    const pool = await getPool();
    const existing = await pool.request().input('id', sql.Int, req.params.id)
      .query(`SELECT 1 FROM dbo.LedgerEntries WHERE EntryId = @id`);
    if (!existing.recordset[0]) return res.status(404).json({ message: 'Ledger entry not found' });

    await pool.request().input('id', sql.Int, req.params.id).query(`DELETE FROM dbo.LedgerEntries WHERE EntryId = @id`);
    logger.audit(req.user?.userId, 'ledger.delete', { entryId: req.params.id }, req);
    res.json({ message: 'Ledger entry deleted successfully' });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'ledgerController.js' });
    res.status(500).json({ message: 'Failed to delete ledger entry', error: err.message });
  }
}

module.exports = {
  listCurrencies, createCurrency, updateCurrency, deleteCurrency,
  listEntries, createEntry, updateEntry, deleteEntry, getLedgerSummary
};
