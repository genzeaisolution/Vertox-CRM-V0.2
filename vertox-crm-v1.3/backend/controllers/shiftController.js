const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');
const { validateRequired, validateDate, hasErrors, sendValidationError } = require('../utils/validate');

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const STATUSES = ['Scheduled', 'Completed', 'No-Show', 'Cancelled'];

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// Two shifts overlap if one starts before the other ends, on the same date,
// for the same volunteer. Zero-length / inverted ranges are rejected before
// this ever runs (see validateShiftBody).
function shiftsOverlap(aStart, aEnd, bStart, bEnd) {
  return timeToMinutes(aStart) < timeToMinutes(bEnd) && timeToMinutes(bStart) < timeToMinutes(aEnd);
}

function validateShiftBody(body) {
  const { volunteerRecordId, shiftDate, startTime, endTime, status } = body;
  const errors = {};
  validateRequired(volunteerRecordId, 'Volunteer', errors, 'volunteerRecordId');
  validateDate(shiftDate, 'Shift Date', errors, 'shiftDate', true);
  validateRequired(startTime, 'Start Time', errors, 'startTime');
  validateRequired(endTime, 'End Time', errors, 'endTime');
  if (startTime && !TIME_RE.test(startTime)) errors.startTime = 'Start Time must be in HH:MM 24-hour format';
  if (endTime && !TIME_RE.test(endTime)) errors.endTime = 'End Time must be in HH:MM 24-hour format';
  if (!errors.startTime && !errors.endTime && timeToMinutes(startTime) >= timeToMinutes(endTime)) {
    errors.endTime = 'End Time must be after Start Time';
  }
  if (status && !STATUSES.includes(status)) errors.status = 'Status must be one of: ' + STATUSES.join(', ');
  return errors;
}

// Every list/create/update call scopes to a real Volunteers-module record
// via Records.RecordId — this is what stops a shift being attached to a
// record that belongs to a totally different module (e.g. a Deal record id
// typo'd into the volunteer field).
async function assertIsVolunteerRecord(pool, recordId) {
  const row = await pool.request().input('id', sql.Int, recordId).query(`
    SELECT r.RecordId FROM dbo.Records r
    JOIN dbo.Modules m ON m.ModuleId = r.ModuleId
    WHERE r.RecordId = @id AND m.ModuleKey = 'volunteers'
  `);
  return !!row.recordset[0];
}

async function listShifts(req, res) {
  try {
    const { from, to, volunteerRecordId, status } = req.query;
    const pool = await getPool();
    const request = pool.request();
    let where = '1=1';
    if (from) { request.input('from', sql.Date, from); where += ' AND s.ShiftDate >= @from'; }
    if (to) { request.input('to', sql.Date, to); where += ' AND s.ShiftDate <= @to'; }
    if (volunteerRecordId) { request.input('volId', sql.Int, volunteerRecordId); where += ' AND s.VolunteerRecordId = @volId'; }
    if (status) { request.input('status', sql.NVarChar, status); where += ' AND s.Status = @status'; }

    const result = await request.query(`
      SELECT s.*, rv.Title AS VolunteerName, rp.Title AS ProjectName
      FROM dbo.VolunteerShifts s
      LEFT JOIN dbo.Records rv ON rv.RecordId = s.VolunteerRecordId
      LEFT JOIN dbo.Records rp ON rp.RecordId = s.ProjectRecordId
      WHERE ${where}
      ORDER BY s.ShiftDate ASC, s.StartTime ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'shiftController.js' });
    res.status(500).json({ message: 'Failed to fetch shifts' });
  }
}

async function createShift(req, res) {
  try {
    const errors = validateShiftBody(req.body);
    if (hasErrors(errors)) return sendValidationError(res, errors);

    const { volunteerRecordId, projectRecordId, shiftDate, startTime, endTime, role, location, status, notes } = req.body;
    const pool = await getPool();

    if (!(await assertIsVolunteerRecord(pool, volunteerRecordId))) {
      return sendValidationError(res, { volunteerRecordId: 'Selected record is not a valid Volunteer' });
    }

    // Conflict detection: same volunteer, same date, overlapping time range.
    const existing = await pool.request()
      .input('volId', sql.Int, volunteerRecordId)
      .input('date', sql.Date, shiftDate)
      .query(`SELECT StartTime, EndTime, ShiftId FROM dbo.VolunteerShifts WHERE VolunteerRecordId = @volId AND ShiftDate = @date AND Status <> 'Cancelled'`);
    const conflict = existing.recordset.find(s => shiftsOverlap(startTime, endTime, s.StartTime, s.EndTime));
    if (conflict) {
      return res.status(409).json({ message: `This volunteer already has a shift from ${conflict.StartTime} to ${conflict.EndTime} on this date — times overlap.` });
    }

    const result = await pool.request()
      .input('volId', sql.Int, volunteerRecordId)
      .input('projId', sql.Int, projectRecordId || null)
      .input('date', sql.Date, shiftDate)
      .input('start', sql.VarChar(5), startTime)
      .input('end', sql.VarChar(5), endTime)
      .input('role', sql.NVarChar, role || null)
      .input('location', sql.NVarChar, location || null)
      .input('status', sql.NVarChar, status || 'Scheduled')
      .input('notes', sql.NVarChar, notes || null)
      .input('createdBy', sql.Int, req.user.userId)
      .query(`
        INSERT INTO dbo.VolunteerShifts (VolunteerRecordId, ProjectRecordId, ShiftDate, StartTime, EndTime, Role, Location, Status, Notes, CreatedBy)
        OUTPUT INSERTED.ShiftId
        VALUES (@volId, @projId, @date, @start, @end, @role, @location, @status, @notes, @createdBy)
      `);
    logger.audit(req.user?.userId, 'shift.create', { shiftId: result.recordset[0].ShiftId, volunteerRecordId }, req);
    res.status(201).json({ shiftId: result.recordset[0].ShiftId, message: 'Shift scheduled successfully' });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'shiftController.js' });
    res.status(500).json({ message: 'Failed to schedule shift', error: err.message });
  }
}

async function updateShift(req, res) {
  try {
    const errors = validateShiftBody(req.body);
    if (hasErrors(errors)) return sendValidationError(res, errors);

    const { volunteerRecordId, projectRecordId, shiftDate, startTime, endTime, role, location, status, notes } = req.body;
    const pool = await getPool();

    const existingRow = await pool.request().input('id', sql.Int, req.params.id).query(`SELECT * FROM dbo.VolunteerShifts WHERE ShiftId = @id`);
    if (!existingRow.recordset[0]) return res.status(404).json({ message: 'Shift not found' });

    if (!(await assertIsVolunteerRecord(pool, volunteerRecordId))) {
      return sendValidationError(res, { volunteerRecordId: 'Selected record is not a valid Volunteer' });
    }

    const others = await pool.request()
      .input('volId', sql.Int, volunteerRecordId)
      .input('date', sql.Date, shiftDate)
      .input('excludeId', sql.Int, req.params.id)
      .query(`SELECT StartTime, EndTime FROM dbo.VolunteerShifts WHERE VolunteerRecordId = @volId AND ShiftDate = @date AND Status <> 'Cancelled' AND ShiftId <> @excludeId`);
    const conflict = others.recordset.find(s => shiftsOverlap(startTime, endTime, s.StartTime, s.EndTime));
    if (conflict) {
      return res.status(409).json({ message: `This volunteer already has a shift from ${conflict.StartTime} to ${conflict.EndTime} on this date — times overlap.` });
    }

    await pool.request()
      .input('id', sql.Int, req.params.id)
      .input('volId', sql.Int, volunteerRecordId)
      .input('projId', sql.Int, projectRecordId || null)
      .input('date', sql.Date, shiftDate)
      .input('start', sql.VarChar(5), startTime)
      .input('end', sql.VarChar(5), endTime)
      .input('role', sql.NVarChar, role || null)
      .input('location', sql.NVarChar, location || null)
      .input('status', sql.NVarChar, status || 'Scheduled')
      .input('notes', sql.NVarChar, notes || null)
      .query(`
        UPDATE dbo.VolunteerShifts
        SET VolunteerRecordId=@volId, ProjectRecordId=@projId, ShiftDate=@date, StartTime=@start, EndTime=@end,
            Role=@role, Location=@location, Status=@status, Notes=@notes, UpdatedAt=SYSUTCDATETIME()
        WHERE ShiftId=@id
      `);
    logger.audit(req.user?.userId, 'shift.update', { shiftId: req.params.id }, req);
    res.json({ message: 'Shift updated successfully' });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'shiftController.js' });
    res.status(500).json({ message: 'Failed to update shift', error: err.message });
  }
}

async function deleteShift(req, res) {
  try {
    const pool = await getPool();
    const existing = await pool.request().input('id', sql.Int, req.params.id).query(`SELECT 1 FROM dbo.VolunteerShifts WHERE ShiftId = @id`);
    if (!existing.recordset[0]) return res.status(404).json({ message: 'Shift not found' });
    await pool.request().input('id', sql.Int, req.params.id).query(`DELETE FROM dbo.VolunteerShifts WHERE ShiftId = @id`);
    logger.audit(req.user?.userId, 'shift.delete', { shiftId: req.params.id }, req);
    res.json({ message: 'Shift deleted successfully' });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'shiftController.js' });
    res.status(500).json({ message: 'Failed to delete shift', error: err.message });
  }
}

// For the "Schedule Shift" form dropdown — every Volunteers-module record.
async function listVolunteerOptions(req, res) {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT r.RecordId, r.Title
      FROM dbo.Records r JOIN dbo.Modules m ON m.ModuleId = r.ModuleId
      WHERE m.ModuleKey = 'volunteers'
      ORDER BY r.Title
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch volunteers' });
  }
}

// Per-volunteer attendance summary: total completed shifts, total hours
// (computed from StartTime/EndTime on Completed shifts only — Scheduled/
// Cancelled/No-Show shifts don't count toward hours), and a no-show count
// so coordinators can spot reliability issues. This is what "attendance
// history" surfaces as on the volunteer's record — computed live from
// VolunteerShifts rather than a separately-maintained total that could
// drift out of sync.
async function volunteerSummary(req, res) {
  try {
    const { id } = req.params;
    const pool = await getPool();
    const isVol = await assertIsVolunteerRecord(pool, id);
    if (!isVol) return res.status(404).json({ message: 'Volunteer record not found' });

    const result = await pool.request().input('volId', sql.Int, id).query(`
      SELECT ShiftDate, StartTime, EndTime, Status, Role, Location
      FROM dbo.VolunteerShifts
      WHERE VolunteerRecordId = @volId
      ORDER BY ShiftDate DESC
    `);

    let totalMinutes = 0, completedCount = 0, noShowCount = 0, scheduledCount = 0;
    result.recordset.forEach(s => {
      if (s.Status === 'Completed') {
        completedCount++;
        totalMinutes += timeToMinutes(s.EndTime) - timeToMinutes(s.StartTime);
      } else if (s.Status === 'No-Show') noShowCount++;
      else if (s.Status === 'Scheduled') scheduledCount++;
    });

    res.json({
      totalShifts: result.recordset.length,
      completedShifts: completedCount,
      noShowShifts: noShowCount,
      upcomingShifts: scheduledCount,
      totalHours: Math.round((totalMinutes / 60) * 10) / 10,
      recentShifts: result.recordset.slice(0, 10)
    });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'shiftController.js:volunteerSummary' });
    res.status(500).json({ message: 'Failed to compute volunteer summary' });
  }
}

module.exports = { listShifts, createShift, updateShift, deleteShift, listVolunteerOptions, volunteerSummary };
