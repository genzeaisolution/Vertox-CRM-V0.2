const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');
const { validateDynamicFields, validateMaxLength, hasErrors, sendValidationError } = require('../utils/validate');
const { notifyUser } = require('../utils/notify');

function parseRecord(row) {
  return {
    recordId: row.RecordId,
    moduleId: row.ModuleId,
    title: row.Title,
    ownerId: row.OwnerId,
    status: row.Status,
    fields: row.FieldsJson ? JSON.parse(row.FieldsJson) : {},
    createdBy: row.CreatedBy,
    createdAt: row.CreatedAt,
    updatedAt: row.UpdatedAt
  };
}

async function listRecords(req, res) {
  try {
    const { moduleKey } = req.params;
    const pool = await getPool();

    const mod = await pool.request().input('key', sql.NVarChar, moduleKey)
      .query(`SELECT ModuleId FROM dbo.Modules WHERE ModuleKey = @key`);
    if (!mod.recordset[0]) return res.status(404).json({ message: 'Module not found' });

    const result = await pool.request().input('moduleId', sql.Int, mod.recordset[0].ModuleId)
      .query(`
        SELECT r.*, u.FullName AS OwnerName
        FROM dbo.Records r
        LEFT JOIN dbo.Users u ON u.UserId = r.OwnerId
        WHERE r.ModuleId = @moduleId
        ORDER BY r.CreatedAt DESC
      `);

    res.json(result.recordset.map(row => ({ ...parseRecord(row), ownerName: row.OwnerName })));
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'recordController.js' });
    res.status(500).json({ message: 'Failed to fetch records' });
  }
}

// ---- Streaming export (CSV, Excel-compatible) ----
// Built for very large datasets: mssql's request.stream=true mode pulls rows
// from SQL Server in batches and emits a 'row' event per row instead of
// materializing the whole result set in memory. We write straight to the
// HTTP response as each row arrives, so memory use stays flat (a few KB)
// no matter whether the module has 100 rows or 100 million. If anything
// fails mid-stream we can't change the HTTP status any more (headers are
// already sent), so we end the response and log the error server-side.
function csvEscape(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

async function exportRecords(req, res) {
  const { moduleKey } = req.params;
  try {
    const pool = await getPool();
    const mod = await pool.request().input('key', sql.NVarChar, moduleKey)
      .query(`SELECT ModuleId, Label FROM dbo.Modules WHERE ModuleKey = @key`);
    if (!mod.recordset[0]) return res.status(404).json({ message: 'Module not found' });
    const { ModuleId, Label } = mod.recordset[0];

    const fieldsResult = await pool.request().input('moduleId', sql.Int, ModuleId)
      .query(`SELECT FieldKey, Label FROM dbo.ModuleFields WHERE ModuleId = @moduleId ORDER BY SortOrder`);
    const fields = fieldsResult.recordset;

    const filenameSafe = String(Label || moduleKey).replace(/[^a-z0-9]+/gi, '_');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filenameSafe}_export.csv"`);
    // BOM so Excel opens UTF-8 (Urdu/Arabic names etc.) correctly instead of mangling it.
    res.write('\uFEFF');

    const header = ['Title', 'Status', 'Owner', 'Created At', ...fields.map(f => f.Label)];
    res.write(header.map(csvEscape).join(',') + '\r\n');

    const request = pool.request();
    request.stream = true;
    request.input('moduleId', sql.Int, ModuleId);
    request.query(`
      SELECT r.Title, r.Status, u.FullName AS OwnerName, r.CreatedAt, r.FieldsJson
      FROM dbo.Records r
      LEFT JOIN dbo.Users u ON u.UserId = r.OwnerId
      WHERE r.ModuleId = @moduleId
      ORDER BY r.CreatedAt DESC
    `);

    let rowCount = 0;
    request.on('row', (row) => {
      let fieldsJson = {};
      try { fieldsJson = row.FieldsJson ? JSON.parse(row.FieldsJson) : {}; } catch (e) { /* skip malformed row data */ }
      const line = [
        row.Title, row.Status, row.OwnerName,
        row.CreatedAt ? new Date(row.CreatedAt).toISOString() : '',
        ...fields.map(f => fieldsJson[f.FieldKey])
      ].map(csvEscape).join(',') + '\r\n';
      // Respect backpressure: if the client can't keep up, pause pulling
      // more rows from SQL Server until the write buffer drains.
      if (!res.write(line)) request.pause();
      rowCount++;
    });
    res.on('drain', () => request.resume());
    request.on('error', (err) => {
      logger.error('CONTROLLER', 'Export stream error: ' + err.message, { moduleKey, rowCount });
      res.end();
    });
    request.on('done', () => {
      res.end();
      logger.db('Export completed', { moduleKey, rowCount });
    });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'recordController.js:exportRecords' });
    if (!res.headersSent) res.status(500).json({ message: 'Export failed' });
    else res.end();
  }
}

async function getRecord(req, res) {
  try {
    const pool = await getPool();
    const result = await pool.request().input('id', sql.Int, req.params.id)
      .query(`SELECT * FROM dbo.Records WHERE RecordId = @id`);
    if (!result.recordset[0]) return res.status(404).json({ message: 'Record not found' });
    res.json(parseRecord(result.recordset[0]));
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch record' });
  }
}

// Checks fields marked `unique: true` in their advanced Config against every
// OTHER record already in this module (JSON_VALUE reads straight out of the
// FieldsJson blob, so this works without a real DB column per field).
async function checkUniqueFields(pool, moduleId, fieldDefs, fields, excludeRecordId) {
  const errors = {};
  for (const f of fieldDefs) {
    let cfg = f.Config;
    if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg); } catch (e) { cfg = {}; } }
    if (!cfg || !cfg.unique) continue;
    const val = (fields || {})[f.FieldKey];
    if (val === undefined || val === null || val === '') continue;

    const req_ = pool.request()
      .input('moduleId', sql.Int, moduleId)
      .input('fieldKey', sql.NVarChar, f.FieldKey)
      .input('val', sql.NVarChar, String(val));
    let query = `
      SELECT TOP 1 RecordId FROM dbo.Records
      WHERE ModuleId = @moduleId AND JSON_VALUE(FieldsJson, '$."' + @fieldKey + '"') = @val`;
    if (excludeRecordId) { req_.input('excludeId', sql.Int, excludeRecordId); query += ' AND RecordId <> @excludeId'; }
    const dupe = await req_.query(query);
    if (dupe.recordset[0]) errors[f.FieldKey] = `${f.Label} must be unique — this value is already used by another record`;
  }
  return errors;
}

async function createRecord(req, res) {
  try {
    const { moduleKey } = req.params;
    const { title, ownerId, status, fields } = req.body;
    const pool = await getPool();

    const mod = await pool.request().input('key', sql.NVarChar, moduleKey)
      .query(`SELECT ModuleId FROM dbo.Modules WHERE ModuleKey = @key`);
    if (!mod.recordset[0]) return res.status(404).json({ message: 'Module not found' });

    // Validate required fields
    const fieldDefs = await pool.request().input('moduleId', sql.Int, mod.recordset[0].ModuleId)
      .query(`SELECT * FROM dbo.ModuleFields WHERE ModuleId = @moduleId`);
    const errors = validateDynamicFields(fieldDefs.recordset, fields);
    // Title/Status columns are NVARCHAR(255)/NVARCHAR(50) in the DB — catch
    // an oversized value here with a clear message instead of letting SQL
    // Server truncate/reject it.
    validateMaxLength(title, 'Title', errors, 'title', 255);
    validateMaxLength(status, 'Status', errors, 'status', 50);
    Object.assign(errors, await checkUniqueFields(pool, mod.recordset[0].ModuleId, fieldDefs.recordset, fields, null));
    if (hasErrors(errors)) return sendValidationError(res, errors);

    const result = await pool.request()
      .input('moduleId', sql.Int, mod.recordset[0].ModuleId)
      .input('title', sql.NVarChar, title || null)
      .input('ownerId', sql.Int, ownerId || req.user.userId)
      .input('status', sql.NVarChar, status || null)
      .input('fieldsJson', sql.NVarChar, JSON.stringify(fields || {}))
      .input('createdBy', sql.Int, req.user.userId)
      .query(`
        INSERT INTO dbo.Records (ModuleId, Title, OwnerId, Status, FieldsJson, CreatedBy)
        OUTPUT INSERTED.RecordId
        VALUES (@moduleId, @title, @ownerId, @status, @fieldsJson, @createdBy)
      `);

    logger.audit(req.user?.userId, 'record.create', { recordId: result.recordset[0].RecordId, moduleKey }, req);

    // Notify the assigned owner (if it's someone other than the creator)
    // that a new record has been assigned to them.
    const newRecordId = result.recordset[0].RecordId;
    const assignedTo = ownerId || req.user.userId;
    if (assignedTo && Number(assignedTo) !== Number(req.user.userId)) {
      await notifyUser(pool, assignedTo, 'New record assigned to you',
        `"${title || '(untitled)'}" was assigned to you in ${moduleKey}`,
        `records?module=${moduleKey}`);
    }

    res.status(201).json({ recordId: newRecordId, message: 'Record created successfully' });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'recordController.js' });
    res.status(500).json({ message: 'Failed to create record', error: err.message });
  }
}

async function updateRecord(req, res) {
  try {
    const { title, ownerId, status, fields } = req.body;
    const pool = await getPool();

    const existing = await pool.request().input('id', sql.Int, req.params.id)
      .query(`
        SELECT r.ModuleId, r.OwnerId AS CurrentOwnerId, r.Title AS PrevTitle, r.Status AS PrevStatus,
               r.FieldsJson AS PrevFieldsJson, m.ModuleKey
        FROM dbo.Records r JOIN dbo.Modules m ON m.ModuleId = r.ModuleId
        WHERE r.RecordId = @id
      `);
    if (!existing.recordset[0]) return res.status(404).json({ message: 'Record not found' });

    const fieldDefs = await pool.request().input('moduleId', sql.Int, existing.recordset[0].ModuleId)
      .query(`SELECT * FROM dbo.ModuleFields WHERE ModuleId = @moduleId`);
    const errors = validateDynamicFields(fieldDefs.recordset, fields);
    validateMaxLength(title, 'Title', errors, 'title', 255);
    validateMaxLength(status, 'Status', errors, 'status', 50);
    Object.assign(errors, await checkUniqueFields(pool, existing.recordset[0].ModuleId, fieldDefs.recordset, fields, Number(req.params.id)));
    if (hasErrors(errors)) return sendValidationError(res, errors);

    await pool.request()
      .input('id', sql.Int, req.params.id)
      .input('title', sql.NVarChar, title || null)
      .input('ownerId', sql.Int, ownerId === undefined || ownerId === null || ownerId === '' ? null : ownerId)
      .input('status', sql.NVarChar, status || null)
      .input('fieldsJson', sql.NVarChar, JSON.stringify(fields || {}))
      .query(`
        UPDATE dbo.Records
        SET Title = @title, OwnerId = COALESCE(@ownerId, OwnerId), Status = @status,
            FieldsJson = @fieldsJson, UpdatedAt = SYSUTCDATETIME()
        WHERE RecordId = @id
      `);
    // Before/after diff for the Audit Trail: only changed keys are stored
    // (not the whole record) so entries stay compact and easy to scan.
    const prevFields = existing.recordset[0].PrevFieldsJson ? JSON.parse(existing.recordset[0].PrevFieldsJson) : {};
    const nextFields = fields || {};
    const before = {}, after = {};
    if ((existing.recordset[0].PrevTitle || '') !== (title || '')) { before.title = existing.recordset[0].PrevTitle; after.title = title; }
    if ((existing.recordset[0].PrevStatus || '') !== (status || '')) { before.status = existing.recordset[0].PrevStatus; after.status = status; }
    for (const key of new Set([...Object.keys(prevFields), ...Object.keys(nextFields)])) {
      const a = prevFields[key], b = nextFields[key];
      if (JSON.stringify(a) !== JSON.stringify(b)) { before[key] = a ?? null; after[key] = b ?? null; }
    }
    logger.audit(req.user?.userId, 'record.update', { recordId: req.params.id, moduleKey: existing.recordset[0].ModuleKey, before, after }, req);

    // Notify only when the record is being reassigned to a NEW owner
    // (different from who it was already assigned to).
    const prevOwnerId = existing.recordset[0].CurrentOwnerId;
    const newOwnerId = ownerId === undefined || ownerId === null || ownerId === '' ? prevOwnerId : Number(ownerId);
    if (newOwnerId && Number(newOwnerId) !== Number(prevOwnerId) && Number(newOwnerId) !== Number(req.user.userId)) {
      await notifyUser(pool, newOwnerId, 'Record assigned to you',
        `"${title || '(untitled)'}" was reassigned to you in ${existing.recordset[0].ModuleKey}`,
        `records?module=${existing.recordset[0].ModuleKey}`);
    }

    res.json({ message: 'Record updated successfully' });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'recordController.js' });
    res.status(500).json({ message: 'Failed to update record', error: err.message });
  }
}

async function deleteRecord(req, res) {
  try {
    const pool = await getPool();
    await pool.request().input('id', sql.Int, req.params.id).query(`DELETE FROM dbo.Records WHERE RecordId = @id`);
    logger.audit(req.user?.userId, 'record.delete', { recordId: req.params.id }, req);
    res.json({ message: 'Record deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete record', error: err.message });
  }
}

module.exports = { listRecords, getRecord, createRecord, updateRecord, deleteRecord, exportRecords };
