const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');
const { validateRequired, hasErrors, sendValidationError } = require('../utils/validate');

async function listModules(req, res) {
  try {
    const pool = await getPool();
    const modules = await pool.request().query(`SELECT * FROM dbo.Modules ORDER BY ModuleId`);
    const fields = await pool.request().query(`SELECT * FROM dbo.ModuleFields ORDER BY SortOrder`);
    const data = modules.recordset.map(m => ({
      ...m,
      fields: fields.recordset
        .filter(f => f.ModuleId === m.ModuleId)
        .map(f => ({ ...f, Options: f.Options ? JSON.parse(f.Options) : null, Config: f.Config ? JSON.parse(f.Config) : {} }))
    }));
    res.json(data);
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'moduleController.js' });
    res.status(500).json({ message: 'Failed to fetch modules' });
  }
}

async function createModule(req, res) {
  try {
    const { moduleKey, label, icon } = req.body;
    const errors = {};
    validateRequired(moduleKey, 'Module Key', errors, 'moduleKey');
    validateRequired(label, 'Label', errors, 'label');
    if (moduleKey && !/^[a-z0-9_]+$/.test(moduleKey)) errors.moduleKey = 'Module Key can only contain lowercase letters, numbers and underscores';
    if (hasErrors(errors)) return sendValidationError(res, errors);

    const pool = await getPool();
    const result = await pool.request()
      .input('moduleKey', sql.NVarChar, moduleKey)
      .input('label', sql.NVarChar, label)
      .input('icon', sql.NVarChar, icon || 'layers')
      .query(`
        INSERT INTO dbo.Modules (ModuleKey, Label, Icon, IsSystem)
        OUTPUT INSERTED.ModuleId
        VALUES (@moduleKey, @label, @icon, 0)
      `);
    logger.audit(req.user?.userId, 'module.create', { moduleId: result.recordset[0].ModuleId, moduleKey }, req);
    res.status(201).json({ moduleId: result.recordset[0].ModuleId, message: 'Module created successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to create module', error: err.message });
  }
}

async function deleteModule(req, res) {
  try {
    const pool = await getPool();
    const check = await pool.request().input('id', sql.Int, req.params.id)
      .query(`SELECT IsSystem FROM dbo.Modules WHERE ModuleId = @id`);
    if (!check.recordset[0]) return res.status(404).json({ message: 'Module not found' });
    if (check.recordset[0].IsSystem) return res.status(403).json({ message: 'System module cannot be deleted' });

    await pool.request().input('id', sql.Int, req.params.id).query(`DELETE FROM dbo.Records WHERE ModuleId = @id`);
    await pool.request().input('id', sql.Int, req.params.id).query(`DELETE FROM dbo.Modules WHERE ModuleId = @id`);
    logger.audit(req.user?.userId, 'module.delete', { moduleId: req.params.id }, req);
    res.json({ message: 'Module deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete module', error: err.message });
  }
}

// ---- Dynamic Fields ----

async function addField(req, res) {
  try {
    const { moduleId } = req.params;
    const { fieldKey, label, fieldType, options, config, isRequired, showInList, sortOrder } = req.body;
    const errors = {};
    validateRequired(fieldKey, 'Field Key', errors, 'fieldKey');
    validateRequired(label, 'Label', errors, 'label');
    validateRequired(fieldType, 'Field Type', errors, 'fieldType');
    if (fieldKey && !/^[a-z0-9_]+$/.test(fieldKey)) errors.fieldKey = 'Field Key can only contain lowercase letters, numbers and underscores';
    // Advanced config sanity check: min must not exceed max for numeric-ish types
    if (config && config.min !== undefined && config.max !== undefined && config.min !== '' && config.max !== '' && Number(config.min) > Number(config.max)) {
      errors.config = 'Minimum value cannot be greater than maximum value';
    }
    if (hasErrors(errors)) return sendValidationError(res, errors);

    const pool = await getPool();

    // Check the module actually exists first — otherwise a bad/garbage
    // moduleId silently produces a foreign-key violation deep in the DB
    // driver instead of a clean 404.
    const mod = await pool.request().input('moduleId', sql.Int, moduleId)
      .query(`SELECT ModuleId FROM dbo.Modules WHERE ModuleId = @moduleId`);
    if (!mod.recordset[0]) return res.status(404).json({ message: 'Module not found' });

    // Pre-check for a duplicate FieldKey on this module so we can return a
    // friendly 409 instead of surfacing the raw UNIQUE constraint error.
    const dupe = await pool.request().input('moduleId', sql.Int, moduleId).input('fieldKey', sql.NVarChar, fieldKey)
      .query(`SELECT 1 FROM dbo.ModuleFields WHERE ModuleId = @moduleId AND FieldKey = @fieldKey`);
    if (dupe.recordset[0]) return sendValidationError(res, { fieldKey: 'A field with this key already exists on this module' });

    const result = await pool.request()
      .input('moduleId', sql.Int, moduleId)
      .input('fieldKey', sql.NVarChar, fieldKey)
      .input('label', sql.NVarChar, label)
      .input('fieldType', sql.NVarChar, fieldType)
      .input('options', sql.NVarChar, options ? JSON.stringify(options) : null)
      .input('config', sql.NVarChar, config ? JSON.stringify(config) : null)
      .input('isRequired', sql.Bit, !!isRequired)
      .input('showInList', sql.Bit, showInList === undefined ? true : !!showInList)
      .input('sortOrder', sql.Int, sortOrder || 0)
      .query(`
        INSERT INTO dbo.ModuleFields (ModuleId, FieldKey, Label, FieldType, Options, Config, IsRequired, IsDefault, SortOrder, ShowInList)
        OUTPUT INSERTED.FieldId
        VALUES (@moduleId, @fieldKey, @label, @fieldType, @options, @config, @isRequired, 0, @sortOrder, @showInList)
      `);
    logger.audit(req.user?.userId, 'field.create', { moduleId, fieldKey }, req);
    res.status(201).json({ fieldId: result.recordset[0].FieldId, message: 'Field added successfully' });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'moduleController.js' });
    // 2627/2601 = SQL Server unique-constraint violation numbers — a
    // last-resort net in case of a race between the pre-check above and
    // the insert (two requests adding the same key at the same instant).
    if (err.number === 2627 || err.number === 2601) {
      return sendValidationError(res, { fieldKey: 'A field with this key already exists on this module' });
    }
    res.status(500).json({ message: 'Failed to add field', error: err.message });
  }
}

async function updateField(req, res) {
  try {
    const { label, fieldType, options, config, isRequired, showInList, sortOrder } = req.body;
    if (config && config.min !== undefined && config.max !== undefined && config.min !== '' && config.max !== '' && Number(config.min) > Number(config.max)) {
      return sendValidationError(res, { config: 'Minimum value cannot be greater than maximum value' });
    }
    const pool = await getPool();
    await pool.request()
      .input('id', sql.Int, req.params.fieldId)
      .input('label', sql.NVarChar, label)
      .input('fieldType', sql.NVarChar, fieldType)
      .input('options', sql.NVarChar, options ? JSON.stringify(options) : null)
      .input('config', sql.NVarChar, config ? JSON.stringify(config) : null)
      .input('isRequired', sql.Bit, !!isRequired)
      .input('showInList', sql.Bit, !!showInList)
      .input('sortOrder', sql.Int, sortOrder || 0)
      .query(`
        UPDATE dbo.ModuleFields
        SET Label = @label, FieldType = @fieldType, Options = @options, Config = @config,
            IsRequired = @isRequired, ShowInList = @showInList, SortOrder = @sortOrder
        WHERE FieldId = @id
      `);
    logger.audit(req.user?.userId, 'field.update', { fieldId: req.params.fieldId }, req);
    res.json({ message: 'Field updated successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update field', error: err.message });
  }
}

async function deleteField(req, res) {
  try {
    const pool = await getPool();
    const check = await pool.request().input('id', sql.Int, req.params.fieldId)
      .query(`SELECT IsDefault FROM dbo.ModuleFields WHERE FieldId = @id`);
    if (!check.recordset[0]) return res.status(404).json({ message: 'Field not found' });
    if (check.recordset[0].IsDefault) return res.status(403).json({ message: 'Default/core field cannot be deleted' });

    await pool.request().input('id', sql.Int, req.params.fieldId).query(`DELETE FROM dbo.ModuleFields WHERE FieldId = @id`);
    logger.audit(req.user?.userId, 'field.delete', { fieldId: req.params.fieldId }, req);
    res.json({ message: 'Field deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete field', error: err.message });
  }
}

module.exports = { listModules, createModule, deleteModule, addField, updateField, deleteField };
