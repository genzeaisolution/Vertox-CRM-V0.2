const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');
const { validateRequired, hasErrors, sendValidationError } = require('../utils/validate');

async function assertIsGrantRecord(pool, recordId) {
  const row = await pool.request().input('id', sql.Int, recordId).query(`
    SELECT r.RecordId, r.Title, r.FieldsJson FROM dbo.Records r
    JOIN dbo.Modules m ON m.ModuleId = r.ModuleId
    WHERE r.RecordId = @id AND m.ModuleKey = 'grants'
  `);
  return row.recordset[0] || null;
}

// Approved amount vs total spent vs remaining — computed live from
// GrantExpenses rather than a manually-maintained running total, so it
// can never drift out of sync with the actual line items.
async function budgetSummary(req, res) {
  try {
    const { grantId } = req.params;
    const pool = await getPool();
    const grant = await assertIsGrantRecord(pool, grantId);
    if (!grant) return res.status(404).json({ message: 'Grant record not found' });

    const fields = grant.FieldsJson ? JSON.parse(grant.FieldsJson) : {};
    const approved = Number(fields.approved_amount) || Number(fields.amount) || 0;

    const expenses = await pool.request().input('grantId', sql.Int, grantId).query(`
      SELECT ExpenseId, Category, Description, Amount, ExpenseDate
      FROM dbo.GrantExpenses WHERE GrantRecordId = @grantId ORDER BY ExpenseDate DESC
    `);
    const spent = expenses.recordset.reduce((sum, e) => sum + Number(e.Amount), 0);

    const byCategory = {};
    expenses.recordset.forEach(e => { byCategory[e.Category] = (byCategory[e.Category] || 0) + Number(e.Amount); });

    res.json({
      grantTitle: grant.Title,
      approvedAmount: approved,
      totalSpent: Math.round(spent * 100) / 100,
      remaining: Math.round((approved - spent) * 100) / 100,
      utilizationPercent: approved > 0 ? Math.round((spent / approved) * 1000) / 10 : null,
      overBudget: spent > approved && approved > 0,
      byCategory,
      expenses: expenses.recordset
    });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'grantExpenseController.js:summary' });
    res.status(500).json({ message: 'Failed to build budget summary' });
  }
}

async function createExpense(req, res) {
  try {
    const { grantId } = req.params;
    const { category, description, amount, expenseDate } = req.body;
    const errors = {};
    validateRequired(category, 'Category', errors, 'category');
    validateRequired(amount, 'Amount', errors, 'amount');
    validateRequired(expenseDate, 'Expense Date', errors, 'expenseDate');
    if (amount !== undefined && (isNaN(Number(amount)) || Number(amount) <= 0)) {
      errors.amount = 'Amount must be a positive number';
    }
    if (hasErrors(errors)) return sendValidationError(res, errors);

    const pool = await getPool();
    const grant = await assertIsGrantRecord(pool, grantId);
    if (!grant) return res.status(404).json({ message: 'Grant record not found' });

    const result = await pool.request()
      .input('grantId', sql.Int, grantId)
      .input('category', sql.NVarChar, category)
      .input('description', sql.NVarChar, description || null)
      .input('amount', sql.Decimal(18, 2), Number(amount))
      .input('expenseDate', sql.Date, expenseDate)
      .input('createdBy', sql.Int, req.user.userId)
      .query(`
        INSERT INTO dbo.GrantExpenses (GrantRecordId, Category, Description, Amount, ExpenseDate, CreatedBy)
        OUTPUT INSERTED.ExpenseId
        VALUES (@grantId, @category, @description, @amount, @expenseDate, @createdBy)
      `);

    // Mirror this into the shared ledger (base currency) so org-wide
    // financial reports include grant spending, same pattern as
    // donationController's refund entry.
    const baseCur = await pool.request().query(`SELECT TOP 1 CurrencyCode, ExchangeRateToBase FROM dbo.Currencies WHERE IsBase = 1`);
    if (baseCur.recordset[0]) {
      const { CurrencyCode, ExchangeRateToBase } = baseCur.recordset[0];
      const amountNum = -Math.abs(Number(amount));
      await pool.request()
        .input('entryDate', sql.DateTime2, new Date(expenseDate))
        .input('entryType', sql.NVarChar, 'expense')
        .input('description', sql.NVarChar, `Grant expense (${category}): ${grant.Title || 'Grant #' + grant.RecordId}${description ? ' — ' + description : ''}`.slice(0, 255))
        .input('reference', sql.NVarChar, 'grant:' + grant.RecordId)
        .input('currencyCode', sql.NVarChar, CurrencyCode)
        .input('amount', sql.Decimal(18, 2), amountNum)
        .input('rate', sql.Decimal(18, 6), Number(ExchangeRateToBase))
        .input('amountBase', sql.Decimal(18, 2), amountNum * Number(ExchangeRateToBase))
        .input('createdBy', sql.Int, req.user.userId)
        .query(`
          INSERT INTO dbo.LedgerEntries (EntryDate, EntryType, Description, Reference, CurrencyCode, Amount, ExchangeRate, AmountBase, CreatedBy)
          VALUES (@entryDate, @entryType, @description, @reference, @currencyCode, @amount, @rate, @amountBase, @createdBy)
        `);
    }

    logger.audit(req.user?.userId, 'grant.expense.create', { grantId, expenseId: result.recordset[0].ExpenseId, amount });
    res.status(201).json({ expenseId: result.recordset[0].ExpenseId, message: 'Expense recorded' });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'grantExpenseController.js:create' });
    res.status(500).json({ message: 'Failed to record expense', error: err.message });
  }
}

async function deleteExpense(req, res) {
  try {
    const pool = await getPool();
    const result = await pool.request().input('id', sql.Int, req.params.id)
      .query(`DELETE FROM dbo.GrantExpenses WHERE ExpenseId = @id`);
    if (result.rowsAffected[0] === 0) return res.status(404).json({ message: 'Expense not found' });
    logger.audit(req.user?.userId, 'grant.expense.delete', { expenseId: req.params.id });
    res.json({ message: 'Expense removed (note: any linked ledger entry is not auto-removed — adjust the ledger manually if needed)' });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'grantExpenseController.js:delete' });
    res.status(500).json({ message: 'Failed to remove expense' });
  }
}

module.exports = { budgetSummary, createExpense, deleteExpense };
