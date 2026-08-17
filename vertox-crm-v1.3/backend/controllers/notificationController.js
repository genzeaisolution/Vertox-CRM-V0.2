const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');

// Every endpoint here scopes strictly to req.user.userId — a user can only
// ever see/modify their own notifications, no permission check needed
// beyond being logged in.

async function listNotifications(req, res) {
  try {
    const pool = await getPool();
    const onlyUnread = req.query.unread === 'true';
    const request = pool.request().input('userId', sql.Int, req.user.userId);
    let where = 'UserId = @userId';
    if (onlyUnread) where += ' AND IsRead = 0';
    const result = await request.query(`
      SELECT TOP 50 NotificationId, Title, Message, Link, IsRead, CreatedAt
      FROM dbo.Notifications
      WHERE ${where}
      ORDER BY CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'notificationController.js' });
    res.status(500).json({ message: 'Failed to fetch notifications' });
  }
}

async function unreadCount(req, res) {
  try {
    const pool = await getPool();
    const result = await pool.request().input('userId', sql.Int, req.user.userId)
      .query(`SELECT COUNT(*) AS cnt FROM dbo.Notifications WHERE UserId = @userId AND IsRead = 0`);
    res.json({ count: result.recordset[0].cnt });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'notificationController.js' });
    res.status(500).json({ message: 'Failed to fetch unread count' });
  }
}

async function markRead(req, res) {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.Int, req.params.id)
      .input('userId', sql.Int, req.user.userId)
      .query(`UPDATE dbo.Notifications SET IsRead = 1 WHERE NotificationId = @id AND UserId = @userId`);
    if (result.rowsAffected[0] === 0) return res.status(404).json({ message: 'Notification not found' });
    res.json({ message: 'Marked as read' });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'notificationController.js' });
    res.status(500).json({ message: 'Failed to update notification' });
  }
}

async function markAllRead(req, res) {
  try {
    const pool = await getPool();
    await pool.request().input('userId', sql.Int, req.user.userId)
      .query(`UPDATE dbo.Notifications SET IsRead = 1 WHERE UserId = @userId AND IsRead = 0`);
    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'notificationController.js' });
    res.status(500).json({ message: 'Failed to update notifications' });
  }
}

async function deleteNotification(req, res) {
  try {
    const pool = await getPool();
    await pool.request()
      .input('id', sql.Int, req.params.id)
      .input('userId', sql.Int, req.user.userId)
      .query(`DELETE FROM dbo.Notifications WHERE NotificationId = @id AND UserId = @userId`);
    res.json({ message: 'Notification deleted' });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'notificationController.js' });
    res.status(500).json({ message: 'Failed to delete notification' });
  }
}

module.exports = { listNotifications, unreadCount, markRead, markAllRead, deleteNotification };
