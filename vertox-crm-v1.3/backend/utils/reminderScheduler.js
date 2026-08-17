// ===== Recurring Donation Reminder Engine =====
// This is the piece that was missing before: previously "Recurring
// Donation" was just a checkbox on a Donation record with no follow-up.
// Now every Active DonationSchedule is checked once a day (and once at
// boot). Any schedule whose NextDueDate has arrived gets a
// DonationReminders row generated automatically, and NextDueDate is
// advanced to the following cycle — completely unattended.
//
// Idempotent by design: (ScheduleId, DueDate) has a UNIQUE constraint in
// the DB (see schema.sql), so running the sweep twice for the same day
// never creates duplicate reminders — the duplicate insert is simply
// skipped.

const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');
const { addCadence, catchUpToFuture } = require('./recurrence');

const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000; // once a day
let intervalHandle = null;

async function runReminderSweepNow() {
  const pool = await getPool();
  const today = new Date(new Date().toDateString()); // midnight, local server date

  const due = await pool.request().input('today', sql.Date, today).query(`
    SELECT * FROM dbo.DonationSchedules WHERE Status = 'Active' AND NextDueDate <= @today
  `);

  let generated = 0;
  let skippedDuplicate = 0;

  for (const schedule of due.recordset) {
    try {
      // Generate the reminder for the due date that was actually hit before
      // advancing — this is the date the donor is being reminded about.
      await pool.request()
        .input('scheduleId', sql.Int, schedule.ScheduleId)
        .input('dueDate', sql.Date, schedule.NextDueDate)
        .query(`
          IF NOT EXISTS (SELECT 1 FROM dbo.DonationReminders WHERE ScheduleId=@scheduleId AND DueDate=@dueDate)
            INSERT INTO dbo.DonationReminders (ScheduleId, DueDate, Status) VALUES (@scheduleId, @dueDate, 'Pending')
        `);
      generated++;

      // Advance NextDueDate to the next future cycle (catches up in one
      // pass if the server was offline for a while, without spamming a
      // reminder per missed cycle).
      const nextDue = catchUpToFuture(schedule.NextDueDate, schedule.Frequency, today);
      await pool.request()
        .input('id', sql.Int, schedule.ScheduleId)
        .input('nextDue', sql.Date, nextDue)
        .query(`UPDATE dbo.DonationSchedules SET NextDueDate=@nextDue, LastGeneratedAt=SYSUTCDATETIME(), UpdatedAt=SYSUTCDATETIME() WHERE ScheduleId=@id`);
    } catch (err) {
      skippedDuplicate++;
      logger.error('REMINDER_SCHEDULER', 'Failed processing schedule ' + schedule.ScheduleId + ': ' + err.message, { stack: err.stack });
    }
  }

  logger.info('REMINDER_SCHEDULER', `Sweep complete: ${generated} reminder(s) generated, ${due.recordset.length} schedule(s) checked`, { generated, checked: due.recordset.length });
  return { checked: due.recordset.length, generated };
}

// Called once from server.js at boot. Runs an immediate sweep (so reminders
// due "today" show up right away even if the server was just restarted),
// then keeps sweeping every 24h for as long as the process is alive.
function startReminderScheduler() {
  if (intervalHandle) return; // already running, don't double-start
  runReminderSweepNow()
    .then(r => logger.info('REMINDER_SCHEDULER', 'Initial sweep on boot done', r))
    .catch(err => logger.error('REMINDER_SCHEDULER', 'Initial sweep failed: ' + err.message, { stack: err.stack }));

  intervalHandle = setInterval(() => {
    runReminderSweepNow().catch(err => logger.error('REMINDER_SCHEDULER', 'Scheduled sweep failed: ' + err.message, { stack: err.stack }));
  }, SWEEP_INTERVAL_MS);
  // Don't let this timer keep the Node process alive on its own if
  // everything else has shut down.
  if (intervalHandle.unref) intervalHandle.unref();
}

function stopReminderScheduler() {
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
}

module.exports = { startReminderScheduler, stopReminderScheduler, runReminderSweepNow };
