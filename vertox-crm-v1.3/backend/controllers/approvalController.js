const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');
const { notifyUser } = require('../utils/notify');
const { validateRequired, hasErrors, sendValidationError } = require('../utils/validate');

async function assertRecordExists(pool, recordId) {
  const row = await pool.request().input('id', sql.Int, recordId).query(`
    SELECT r.RecordId, r.Title, m.ModuleKey
    FROM dbo.Records r JOIN dbo.Modules m ON m.ModuleId = r.ModuleId
    WHERE r.RecordId = @id
  `);
  return row.recordset[0] || null;
}

async function loadRequestWithSteps(pool, requestId) {
  const reqResult = await pool.request().input('id', sql.Int, requestId).query(`
    SELECT ar.*, u.FullName AS RequestedByName
    FROM dbo.ApprovalRequests ar
    LEFT JOIN dbo.Users u ON u.UserId = ar.RequestedBy
    WHERE ar.RequestId = @id
  `);
  const request = reqResult.recordset[0];
  if (!request) return null;

  const stepsResult = await pool.request().input('requestId', sql.Int, requestId).query(`
    SELECT s.*, u.FullName AS ApproverName
    FROM dbo.ApprovalSteps s
    LEFT JOIN dbo.Users u ON u.UserId = s.ApproverUserId
    WHERE s.RequestId = @requestId
    ORDER BY s.StepNumber ASC
  `);
  return { ...request, steps: stepsResult.recordset };
}

// The whole point of "sequential" approval: a step can only be acted on
// once every step before it is Approved. This is what stops step 3's
// approver from jumping the queue and deciding before step 1 and 2 have.
function isStepActionable(steps, stepNumber) {
  return steps.filter(s => s.StepNumber < stepNumber).every(s => s.Status === 'Approved');
}

// GET /api/approvals/record/:recordId — every request (current + history) for this record
async function listForRecord(req, res) {
  try {
    const pool = await getPool();
    const recordId = Number(req.params.recordId);
    const record = await assertRecordExists(pool, recordId);
    if (!record) return res.status(404).json({ message: 'Record not found' });

    const result = await pool.request().input('recordId', sql.Int, recordId).query(`
      SELECT RequestId FROM dbo.ApprovalRequests WHERE RecordId = @recordId ORDER BY CreatedAt DESC
    `);
    const requests = [];
    for (const row of result.recordset) {
      requests.push(await loadRequestWithSteps(pool, row.RequestId));
    }
    res.json({ requests });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'approvalController.js:listForRecord' });
    res.status(500).json({ message: 'Failed to load approval requests' });
  }
}

// POST /api/approvals/record/:recordId  body: { title, approverUserIds: [1,2,3] }
async function createRequest(req, res) {
  try {
    const pool = await getPool();
    const recordId = Number(req.params.recordId);
    const record = await assertRecordExists(pool, recordId);
    if (!record) return res.status(404).json({ message: 'Record not found' });

    const { title, approverUserIds } = req.body;
    const errors = {};
    if (!Array.isArray(approverUserIds) || approverUserIds.length === 0) {
      errors.approverUserIds = 'Select at least one approver';
    }
    if (hasErrors(errors)) return sendValidationError(res, errors);

    // Only one active (Pending) chain per record at a time — starting a
    // second one while the first is still open would make "what's the
    // current approval status of this record" ambiguous.
    const existing = await pool.request().input('recordId', sql.Int, recordId).query(`
      SELECT RequestId FROM dbo.ApprovalRequests WHERE RecordId = @recordId AND OverallStatus = 'Pending'
    `);
    if (existing.recordset.length > 0) {
      return res.status(409).json({ message: 'This record already has a pending approval request' });
    }

    const insertReq = await pool.request()
      .input('recordId', sql.Int, recordId)
      .input('moduleKey', sql.NVarChar, record.ModuleKey)
      .input('title', sql.NVarChar, title || null)
      .input('requestedBy', sql.Int, req.user.userId)
      .query(`
        INSERT INTO dbo.ApprovalRequests (RecordId, ModuleKey, Title, RequestedBy)
        OUTPUT INSERTED.RequestId
        VALUES (@recordId, @moduleKey, @title, @requestedBy)
      `);
    const requestId = insertReq.recordset[0].RequestId;

    for (let i = 0; i < approverUserIds.length; i++) {
      await pool.request()
        .input('requestId', sql.Int, requestId)
        .input('stepNumber', sql.Int, i + 1)
        .input('approverUserId', sql.Int, approverUserIds[i])
        .query(`INSERT INTO dbo.ApprovalSteps (RequestId, StepNumber, ApproverUserId) VALUES (@requestId, @stepNumber, @approverUserId)`);
    }

    // Only the first step is actionable right away — notify that approver,
    // not everyone in the chain, so people don't act out of turn.
    await notifyUser(pool, approverUserIds[0], 'Approval needed', `"${record.Title || 'A record'}" needs your approval (step 1 of ${approverUserIds.length})`, `/records.html?module=${record.ModuleKey}`);

    logger.audit(req.user.userId, 'approval.request.create', { requestId, recordId, steps: approverUserIds.length });
    res.status(201).json({ message: 'Approval request started', requestId });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'approvalController.js:createRequest' });
    res.status(500).json({ message: 'Failed to start approval request', error: err.message });
  }
}

// POST /api/approvals/steps/:stepId/act  body: { action: 'approve'|'reject', comments }
async function actOnStep(req, res) {
  try {
    const pool = await getPool();
    const stepId = Number(req.params.stepId);
    const { action, comments } = req.body;
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ message: 'action must be "approve" or "reject"' });
    }

    const stepResult = await pool.request().input('id', sql.Int, stepId).query(`SELECT * FROM dbo.ApprovalSteps WHERE StepId = @id`);
    const step = stepResult.recordset[0];
    if (!step) return res.status(404).json({ message: 'Approval step not found' });

    // Only the assigned approver (or SuperAdmin, for legitimate override
    // cases like the approver being unavailable) can act on this step —
    // this is an identity check, not a permission-key check, because the
    // whole point of a named approver is that nobody else can decide for them.
    if (req.user.userId !== step.ApproverUserId && req.user.roleName !== 'SuperAdmin') {
      return res.status(403).json({ message: 'Only the assigned approver can act on this step' });
    }
    if (step.Status !== 'Pending') {
      return res.status(409).json({ message: `This step was already ${step.Status.toLowerCase()}` });
    }

    const request = await loadRequestWithSteps(pool, step.RequestId);
    if (!isStepActionable(request.steps, step.StepNumber)) {
      return res.status(409).json({ message: 'Earlier steps in this chain have not been approved yet' });
    }

    const newStatus = action === 'approve' ? 'Approved' : 'Rejected';
    await pool.request()
      .input('id', sql.Int, stepId)
      .input('status', sql.NVarChar, newStatus)
      .input('comments', sql.NVarChar, comments || null)
      .query(`UPDATE dbo.ApprovalSteps SET Status = @status, Comments = @comments, ActedAt = SYSUTCDATETIME() WHERE StepId = @id`);

    const record = await assertRecordExists(pool, request.RecordId);

    if (newStatus === 'Rejected') {
      // A rejection anywhere stops the whole chain — remaining Pending
      // steps are marked Skipped so the UI doesn't show them hanging forever.
      await pool.request().input('requestId', sql.Int, step.RequestId).query(`
        UPDATE dbo.ApprovalSteps SET Status = 'Skipped' WHERE RequestId = @requestId AND Status = 'Pending'
      `);
      await pool.request().input('requestId', sql.Int, step.RequestId).query(`
        UPDATE dbo.ApprovalRequests SET OverallStatus = 'Rejected', DecidedAt = SYSUTCDATETIME() WHERE RequestId = @requestId
      `);
      await notifyUser(pool, request.RequestedBy, 'Approval rejected', `"${record?.Title || 'Your record'}" was rejected at step ${step.StepNumber}`, `/records.html?module=${request.ModuleKey}`);
    } else {
      const nextStep = request.steps.find(s => s.StepNumber === step.StepNumber + 1);
      if (nextStep) {
        await notifyUser(pool, nextStep.ApproverUserId, 'Approval needed', `"${record?.Title || 'A record'}" needs your approval (step ${nextStep.StepNumber} of ${request.steps.length})`, `/records.html?module=${request.ModuleKey}`);
      } else {
        // That was the last step — the whole chain is now Approved.
        await pool.request().input('requestId', sql.Int, step.RequestId).query(`
          UPDATE dbo.ApprovalRequests SET OverallStatus = 'Approved', DecidedAt = SYSUTCDATETIME() WHERE RequestId = @requestId
        `);
        await notifyUser(pool, request.RequestedBy, 'Approval complete', `"${record?.Title || 'Your record'}" was fully approved`, `/records.html?module=${request.ModuleKey}`);
      }
    }

    logger.audit(req.user.userId, 'approval.step.' + action, { stepId, requestId: step.RequestId, recordId: request.RecordId });
    res.json({ message: `Step ${newStatus.toLowerCase()}` });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'approvalController.js:actOnStep' });
    res.status(500).json({ message: 'Failed to record decision', error: err.message });
  }
}

// DELETE /api/approvals/:requestId — only while still Pending, only by the requester or SuperAdmin
async function cancelRequest(req, res) {
  try {
    const pool = await getPool();
    const requestId = Number(req.params.requestId);
    const result = await pool.request().input('id', sql.Int, requestId).query(`SELECT * FROM dbo.ApprovalRequests WHERE RequestId = @id`);
    const request = result.recordset[0];
    if (!request) return res.status(404).json({ message: 'Approval request not found' });
    if (request.OverallStatus !== 'Pending') return res.status(409).json({ message: 'Only a pending request can be cancelled' });
    if (req.user.userId !== request.RequestedBy && req.user.roleName !== 'SuperAdmin') {
      return res.status(403).json({ message: 'Only the person who started this request can cancel it' });
    }

    await pool.request().input('id', sql.Int, requestId).query(`
      UPDATE dbo.ApprovalRequests SET OverallStatus = 'Cancelled', DecidedAt = SYSUTCDATETIME() WHERE RequestId = @id
    `);
    await pool.request().input('id', sql.Int, requestId).query(`
      UPDATE dbo.ApprovalSteps SET Status = 'Skipped' WHERE RequestId = @id AND Status = 'Pending'
    `);

    logger.audit(req.user.userId, 'approval.request.cancel', { requestId });
    res.json({ message: 'Approval request cancelled' });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'approvalController.js:cancelRequest' });
    res.status(500).json({ message: 'Failed to cancel approval request' });
  }
}

// GET /api/approvals/my-pending — steps waiting on me, across every module
async function myPendingSteps(req, res) {
  try {
    const pool = await getPool();
    const result = await pool.request().input('userId', sql.Int, req.user.userId).query(`
      SELECT s.StepId, s.StepNumber, s.RequestId, ar.RecordId, ar.ModuleKey, ar.Title, r.Title AS RecordTitle,
             u.FullName AS RequestedByName, ar.CreatedAt
      FROM dbo.ApprovalSteps s
      JOIN dbo.ApprovalRequests ar ON ar.RequestId = s.RequestId
      JOIN dbo.Records r ON r.RecordId = ar.RecordId
      LEFT JOIN dbo.Users u ON u.UserId = ar.RequestedBy
      WHERE s.ApproverUserId = @userId AND s.Status = 'Pending' AND ar.OverallStatus = 'Pending'
      ORDER BY ar.CreatedAt ASC
    `);
    // Filter to steps that are actually actionable right now (earlier steps
    // already approved) — a pending step 3 while step 1 is untouched isn't
    // "my turn" yet, so it shouldn't clutter this list.
    const actionable = [];
    for (const row of result.recordset) {
      const allSteps = (await pool.request().input('requestId', sql.Int, row.RequestId).query(`SELECT StepNumber, Status FROM dbo.ApprovalSteps WHERE RequestId = @requestId`)).recordset;
      if (isStepActionable(allSteps, row.StepNumber)) actionable.push(row);
    }
    res.json({ steps: actionable });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'approvalController.js:myPendingSteps' });
    res.status(500).json({ message: 'Failed to load your pending approvals' });
  }
}

module.exports = { listForRecord, createRequest, actOnStep, cancelRequest, myPendingSteps };
