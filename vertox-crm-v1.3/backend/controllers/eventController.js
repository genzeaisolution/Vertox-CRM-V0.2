const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');
const { validateRequired, hasErrors, sendValidationError } = require('../utils/validate');

// Same defensive pattern as shiftController.assertIsVolunteerRecord —
// makes sure an EventRecordId actually points at a real Events-module
// record before anything is attached to it.
async function assertIsEventRecord(pool, recordId) {
  const row = await pool.request().input('id', sql.Int, recordId).query(`
    SELECT r.RecordId, r.Title, r.FieldsJson FROM dbo.Records r
    JOIN dbo.Modules m ON m.ModuleId = r.ModuleId
    WHERE r.RecordId = @id AND m.ModuleKey = 'events'
  `);
  return row.recordset[0] || null;
}

async function listCheckIns(req, res) {
  try {
    const { eventId } = req.params;
    const pool = await getPool();
    const event = await assertIsEventRecord(pool, eventId);
    if (!event) return res.status(404).json({ message: 'Event record not found' });

    const result = await pool.request().input('eventId', sql.Int, eventId).query(`
      SELECT c.CheckInId, c.AttendeeName, c.Phone, c.Notes, c.CheckedInAt, u.FullName AS CheckedInByName
      FROM dbo.EventCheckIns c
      LEFT JOIN dbo.Users u ON u.UserId = c.CheckedInBy
      WHERE c.EventRecordId = @eventId
      ORDER BY c.CheckedInAt DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'eventController.js' });
    res.status(500).json({ message: 'Failed to fetch check-ins' });
  }
}

async function createCheckIn(req, res) {
  try {
    const { eventId } = req.params;
    const { attendeeName, phone, notes } = req.body;
    const errors = {};
    validateRequired(attendeeName, 'Attendee Name', errors, 'attendeeName');
    if (hasErrors(errors)) return sendValidationError(res, errors);

    const pool = await getPool();
    const event = await assertIsEventRecord(pool, eventId);
    if (!event) return res.status(404).json({ message: 'Event record not found' });

    const result = await pool.request()
      .input('eventId', sql.Int, eventId)
      .input('name', sql.NVarChar, attendeeName)
      .input('phone', sql.NVarChar, phone || null)
      .input('notes', sql.NVarChar, notes || null)
      .input('userId', sql.Int, req.user.userId)
      .query(`
        INSERT INTO dbo.EventCheckIns (EventRecordId, AttendeeName, Phone, Notes, CheckedInBy)
        OUTPUT INSERTED.CheckInId
        VALUES (@eventId, @name, @phone, @notes, @userId)
      `);
    logger.audit(req.user?.userId, 'event.checkin', { eventId, checkInId: result.recordset[0].CheckInId });
    res.status(201).json({ checkInId: result.recordset[0].CheckInId, message: 'Checked in successfully' });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'eventController.js' });
    res.status(500).json({ message: 'Failed to check in attendee', error: err.message });
  }
}

async function deleteCheckIn(req, res) {
  try {
    const pool = await getPool();
    const result = await pool.request().input('id', sql.Int, req.params.id)
      .query(`DELETE FROM dbo.EventCheckIns WHERE CheckInId = @id`);
    if (result.rowsAffected[0] === 0) return res.status(404).json({ message: 'Check-in not found' });
    logger.audit(req.user?.userId, 'event.checkin.delete', { checkInId: req.params.id });
    res.json({ message: 'Check-in removed' });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'eventController.js' });
    res.status(500).json({ message: 'Failed to remove check-in' });
  }
}

// Post-event report: expected vs actual attendance, budget vs actual cost
// variance — pulled from the event's own dynamic fields (budget,
// actual_cost, expected_attendees) plus a live COUNT of EventCheckIns,
// so it's always accurate even if those fields get edited later.
async function eventReport(req, res) {
  try {
    const { eventId } = req.params;
    const pool = await getPool();
    const event = await assertIsEventRecord(pool, eventId);
    if (!event) return res.status(404).json({ message: 'Event record not found' });

    const fields = event.FieldsJson ? JSON.parse(event.FieldsJson) : {};
    const checkInCount = await pool.request().input('eventId', sql.Int, eventId)
      .query(`SELECT COUNT(*) AS cnt FROM dbo.EventCheckIns WHERE EventRecordId = @eventId`);

    const expected = Number(fields.expected_attendees) || 0;
    const actual = checkInCount.recordset[0].cnt;
    const budget = Number(fields.budget) || 0;
    const actualCost = Number(fields.actual_cost) || 0;

    res.json({
      eventTitle: event.Title,
      expectedAttendees: expected,
      actualAttendees: actual,
      attendanceRate: expected > 0 ? Math.round((actual / expected) * 1000) / 10 : null,
      budget,
      actualCost,
      variance: budget - actualCost,
      overBudget: actualCost > budget
    });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'eventController.js:eventReport' });
    res.status(500).json({ message: 'Failed to build event report' });
  }
}

module.exports = { listCheckIns, createCheckIn, deleteCheckIn, eventReport };
