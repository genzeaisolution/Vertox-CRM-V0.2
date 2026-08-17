const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');
const { validateRequired, validateMaxLength, hasErrors, sendValidationError } = require('../utils/validate');

const STATUSES = ['Pending', 'In Progress', 'Completed'];

// Status returned to the client is "computed" — a Pending/In Progress
// milestone whose DueDate has passed is surfaced as 'Overdue' without ever
// being stored that way, so re-opening/editing a milestone doesn't need to
// "un-overdue" it first.
function withComputedStatus(row) {
  const isPastDue = row.DueDate && row.Status !== 'Completed' && new Date(row.DueDate) < new Date(new Date().toDateString());
  return { ...row, ComputedStatus: isPastDue ? 'Overdue' : row.Status };
}

async function assertIsGrantRecord(pool, recordId) {
  const row = await pool.request().input('id', sql.Int, recordId).query(`
    SELECT r.RecordId FROM dbo.Records r
    JOIN dbo.Modules m ON m.ModuleId = r.ModuleId
    WHERE r.RecordId = @id AND m.ModuleKey = 'grants'
  `);
  return !!row.recordset[0];
}

async function listMilestones(req, res) {
  try {
    const { grantRecordId } = req.query;
    const pool = await getPool();
    const request = pool.request();
    let where = '1=1';
    if (grantRecordId) { request.input('grantId', sql.Int, grantRecordId); where += ' AND m.GrantRecordId = @grantId'; }

    const result = await request.query(`
      SELECT m.*, r.Title AS GrantName
      FROM dbo.GrantMilestones m
      LEFT JOIN dbo.Records r ON r.RecordId = m.GrantRecordId
      WHERE ${where}
      ORDER BY ISNULL(m.DueDate, '9999-12-31') ASC, m.SortOrder ASC
    `);
    res.json(result.recordset.map(withComputedStatus));
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'milestoneController.js' });
    res.status(500).json({ message: 'Failed to fetch milestones' });
  }
}

async function createMilestone(req, res) {
  try {
    const { grantRecordId, title, description, dueDate, status, sortOrder } = req.body;
    const errors = {};
    validateRequired(grantRecordId, 'Grant', errors, 'grantRecordId');
    validateRequired(title, 'Title', errors, 'title');
    validateMaxLength(title, 'Title', errors, 'title', 255);
    validateMaxLength(description, 'Description', errors, 'description', 1000);
    if (status && !STATUSES.includes(status)) errors.status = 'Status must be one of: ' + STATUSES.join(', ');
    if (hasErrors(errors)) return sendValidationError(res, errors);

    const pool = await getPool();
    if (!(await assertIsGrantRecord(pool, grantRecordId))) {
      return sendValidationError(res, { grantRecordId: 'Selected record is not a valid Grant' });
    }

    const result = await pool.request()
      .input('grantId', sql.Int, grantRecordId)
      .input('title', sql.NVarChar, title)
      .input('description', sql.NVarChar, description || null)
      .input('dueDate', sql.Date, dueDate || null)
      .input('status', sql.NVarChar, status || 'Pending')
      .input('sortOrder', sql.Int, Number(sortOrder) || 0)
      .input('createdBy', sql.Int, req.user.userId)
      .query(`
        INSERT INTO dbo.GrantMilestones (GrantRecordId, Title, Description, DueDate, Status, SortOrder, CompletedAt, CreatedBy)
        OUTPUT INSERTED.MilestoneId
        VALUES (@grantId, @title, @description, @dueDate, @status, @sortOrder, CASE WHEN @status = 'Completed' THEN SYSUTCDATETIME() ELSE NULL END, @createdBy)
      `);
    logger.audit(req.user?.userId, 'milestone.create', { milestoneId: result.recordset[0].MilestoneId, grantRecordId }, req);
    res.status(201).json({ milestoneId: result.recordset[0].MilestoneId, message: 'Milestone created successfully' });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'milestoneController.js' });
    res.status(500).json({ message: 'Failed to create milestone', error: err.message });
  }
}

async function updateMilestone(req, res) {
  try {
    const { title, description, dueDate, status, sortOrder } = req.body;
    const errors = {};
    validateRequired(title, 'Title', errors, 'title');
    validateMaxLength(title, 'Title', errors, 'title', 255);
    validateMaxLength(description, 'Description', errors, 'description', 1000);
    if (status && !STATUSES.includes(status)) errors.status = 'Status must be one of: ' + STATUSES.join(', ');
    if (hasErrors(errors)) return sendValidationError(res, errors);

    const pool = await getPool();
    const existing = await pool.request().input('id', sql.Int, req.params.id).query(`SELECT * FROM dbo.GrantMilestones WHERE MilestoneId = @id`);
    if (!existing.recordset[0]) return res.status(404).json({ message: 'Milestone not found' });

    const wasCompleted = existing.recordset[0].Status === 'Completed';
    const nowCompleted = status === 'Completed';

    await pool.request()
      .input('id', sql.Int, req.params.id)
      .input('title', sql.NVarChar, title)
      .input('description', sql.NVarChar, description || null)
      .input('dueDate', sql.Date, dueDate || null)
      .input('status', sql.NVarChar, status || 'Pending')
      .input('sortOrder', sql.Int, Number(sortOrder) || 0)
      .query(`
        UPDATE dbo.GrantMilestones
        SET Title=@title, Description=@description, DueDate=@dueDate, Status=@status, SortOrder=@sortOrder,
            CompletedAt = CASE
              WHEN @status = 'Completed' AND CompletedAt IS NULL THEN SYSUTCDATETIME()
              WHEN @status <> 'Completed' THEN NULL
              ELSE CompletedAt END,
            UpdatedAt = SYSUTCDATETIME()
        WHERE MilestoneId=@id
      `);
    logger.audit(req.user?.userId, 'milestone.update', { milestoneId: req.params.id, completedTransition: !wasCompleted && nowCompleted }, req);
    res.json({ message: 'Milestone updated successfully' });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'milestoneController.js' });
    res.status(500).json({ message: 'Failed to update milestone', error: err.message });
  }
}

async function deleteMilestone(req, res) {
  try {
    const pool = await getPool();
    const existing = await pool.request().input('id', sql.Int, req.params.id).query(`SELECT 1 FROM dbo.GrantMilestones WHERE MilestoneId = @id`);
    if (!existing.recordset[0]) return res.status(404).json({ message: 'Milestone not found' });
    await pool.request().input('id', sql.Int, req.params.id).query(`DELETE FROM dbo.GrantMilestones WHERE MilestoneId = @id`);
    logger.audit(req.user?.userId, 'milestone.delete', { milestoneId: req.params.id }, req);
    res.json({ message: 'Milestone deleted successfully' });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'milestoneController.js' });
    res.status(500).json({ message: 'Failed to delete milestone', error: err.message });
  }
}

async function listGrantOptions(req, res) {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT r.RecordId, r.Title
      FROM dbo.Records r JOIN dbo.Modules m ON m.ModuleId = r.ModuleId
      WHERE m.ModuleKey = 'grants'
      ORDER BY r.Title
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch grants' });
  }
}

module.exports = { listMilestones, createMilestone, updateMilestone, deleteMilestone, listGrantOptions };
