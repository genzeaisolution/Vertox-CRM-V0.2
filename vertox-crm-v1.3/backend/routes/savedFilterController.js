const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');
const { validateRequired, validateMaxLength, hasErrors, sendValidationError } = require('../utils/validate');

// Every row is scoped to req.user.userId — a user only ever sees/manages
// their own saved filters, same pattern as notifications.

async function listFilters(req, res) {
  try {
    const { moduleKey } = req.params;
    const pool = await getPool();
    const result = await pool.request()
      .input('userId', sql.Int, req.user.userId)
      .input('moduleKey', sql.NVarChar, moduleKey)
      .query(`
        SELECT FilterId, FilterName, FilterJson, CreatedAt
        FROM dbo.SavedFilters
        WHERE UserId = @userId AND ModuleKey = @moduleKey
        ORDER BY CreatedAt DESC
      `);
    res.json(result.recordset.map(r => ({
      filterId: r.FilterId,
      name: r.FilterName,
      filter: JSON.parse(r.FilterJson),
      createdAt: r.CreatedAt
    })));
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'savedFilterController.js' });
    res.status(500).json({ message: 'Failed to fetch saved filters' });
  }
}

async function createFilter(req, res) {
  try {
    const { moduleKey } = req.params;
    const { name, filter } = req.body;
    const errors = {};
    validateRequired(name, 'Filter Name', errors, 'name');
    validateMaxLength(name, 'Filter Name', errors, 'name', 150);
    if (!filter || typeof filter !== 'object') errors.filter = 'Filter data is required';
    if (hasErrors(errors)) return sendValidationError(res, errors);

    const filterJson = JSON.stringify(filter);
    if (filterJson.length > 1000) return sendValidationError(res, { filter: 'Filter data is too large' });

    const pool = await getPool();
    // One saved filter per (user, module, name) — saving again under the
    // same name updates it instead of creating a duplicate.
    const existing = await pool.request()
      .input('userId', sql.Int, req.user.userId)
      .input('moduleKey', sql.NVarChar, moduleKey)
      .input('name', sql.NVarChar, name.trim())
      .query(`SELECT FilterId FROM dbo.SavedFilters WHERE UserId=@userId AND ModuleKey=@moduleKey AND FilterName=@name`);

    if (existing.recordset[0]) {
      await pool.request()
        .input('id', sql.Int, existing.recordset[0].FilterId)
        .input('filterJson', sql.NVarChar, filterJson)
        .query(`UPDATE dbo.SavedFilters SET FilterJson=@filterJson WHERE FilterId=@id`);
      return res.json({ filterId: existing.recordset[0].FilterId, message: 'Saved filter updated' });
    }

    const result = await pool.request()
      .input('userId', sql.Int, req.user.userId)
      .input('moduleKey', sql.NVarChar, moduleKey)
      .input('name', sql.NVarChar, name.trim())
      .input('filterJson', sql.NVarChar, filterJson)
      .query(`
        INSERT INTO dbo.SavedFilters (UserId, ModuleKey, FilterName, FilterJson)
        OUTPUT INSERTED.FilterId
        VALUES (@userId, @moduleKey, @name, @filterJson)
      `);
    res.status(201).json({ filterId: result.recordset[0].FilterId, message: 'Filter saved' });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'savedFilterController.js' });
    res.status(500).json({ message: 'Failed to save filter', error: err.message });
  }
}

async function deleteFilter(req, res) {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.Int, req.params.id)
      .input('userId', sql.Int, req.user.userId)
      .query(`DELETE FROM dbo.SavedFilters WHERE FilterId = @id AND UserId = @userId`);
    if (result.rowsAffected[0] === 0) return res.status(404).json({ message: 'Saved filter not found' });
    res.json({ message: 'Saved filter deleted' });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'savedFilterController.js' });
    res.status(500).json({ message: 'Failed to delete saved filter' });
  }
}

module.exports = { listFilters, createFilter, deleteFilter };
