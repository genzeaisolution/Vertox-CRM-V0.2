// ===== Shared recurring-donation cadence math =====
// Used by both reminderController.js (schedule create/edit) and
// reminderScheduler.js (the daily background job) so "what's the next due
// date" is computed in exactly one place.

const FREQUENCIES = ['Weekly', 'Monthly', 'Quarterly', 'Yearly'];

// Adds one cadence step to a date, handling month-length edge cases (e.g.
// Jan 31 + 1 month must land on Feb 28/29, not roll over into March).
function addCadence(date, frequency) {
  const d = new Date(date);
  const day = d.getUTCDate();
  switch (frequency) {
    case 'Weekly':
      d.setUTCDate(d.getUTCDate() + 7);
      return d;
    case 'Monthly':
      return addMonthsClamped(d, 1, day);
    case 'Quarterly':
      return addMonthsClamped(d, 3, day);
    case 'Yearly':
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      // Handles Feb 29 on a leap year rolling into a non-leap year.
      if (d.getUTCDate() !== day) d.setUTCDate(0);
      return d;
    default:
      throw new Error('Unknown frequency: ' + frequency);
  }
}

function addMonthsClamped(date, months, originalDay) {
  const d = new Date(date);
  d.setUTCDate(1); // avoid month-rollover while adding
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDayOfTargetMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(originalDay, lastDayOfTargetMonth));
  return d;
}

// Keeps advancing NextDueDate until it's strictly in the future — covers the
// case where the scheduler didn't run for a while (server was off) and a
// schedule has several missed cycles to catch up in one pass, without
// generating a reminder for every single missed cycle.
function catchUpToFuture(nextDueDate, frequency, today) {
  let d = new Date(nextDueDate);
  let guard = 0;
  while (d <= today && guard < 1000) {
    d = addCadence(d, frequency);
    guard++;
  }
  return d;
}

module.exports = { FREQUENCIES, addCadence, catchUpToFuture };
