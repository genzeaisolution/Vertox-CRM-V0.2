const { sql } = require('mssql');
const logger = require('./logger');

// Small reusable helper — any controller can call this to push an in-app
// notification to a specific user without duplicating the INSERT everywhere.
// Failure here must never break the calling request (e.g. a record save
// should still succeed even if the notification insert has a problem), so
// this always swallows its own errors after logging them.
async function notifyUser(pool, userId, title, message, link) {
  if (!userId) return;
  try {
    await pool.request()
      .input('userId', sql.Int, userId)
      .input('title', sql.NVarChar, title)
      .input('message', sql.NVarChar, message || null)
      .input('link', sql.NVarChar, link || null)
      .query(`INSERT INTO dbo.Notifications (UserId, Title, Message, Link) VALUES (@userId, @title, @message, @link)`);
  } catch (err) {
    logger.error('NOTIFY', 'Failed to create notification: ' + err.message, { stack: err.stack, userId, title });
  }
}

module.exports = { notifyUser };
