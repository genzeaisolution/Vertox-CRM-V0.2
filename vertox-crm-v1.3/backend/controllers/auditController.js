const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');

async function listAuditLogs(req, res) {
  try {
    const { userId, action, module, from, to, q } = req.query;
    const pool = await getPool();
    const request = pool.request();
    let where = '1=1';

    if (userId) { request.input('userId', sql.Int, userId); where += ' AND l.UserId = @userId'; }
    if (action) { request.input('action', sql.NVarChar, action); where += ' AND l.Action = @action'; }
    if (module) { request.input('module', sql.NVarChar, module); where += ' AND l.Module = @module'; }
    if (q) { request.input('q', sql.NVarChar, `%${q}%`); where += ' AND (l.Action LIKE @q OR l.Details LIKE @q OR u.Username LIKE @q)'; }
    if (from) { request.input('from', sql.DateTime2, new Date(from)); where += ' AND l.CreatedAt >= @from'; }
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      request.input('to', sql.DateTime2, toDate);
      where += ' AND l.CreatedAt <= @to';
    }

    const result = await request.query(`
      SELECT TOP 500 l.LogId, l.UserId, u.Username, u.FullName, l.Action, l.Module, l.RecordId, l.Details, l.IpAddress, l.UserAgent, l.CreatedAt
      FROM dbo.AuditLogs l
      LEFT JOIN dbo.Users u ON u.UserId = l.UserId
      WHERE ${where}
      ORDER BY l.CreatedAt DESC
    `);

    res.json(result.recordset);
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'auditController.js' });
    res.status(500).json({ message: 'Failed to fetch audit logs', error: err.message });
  }
}

// Login History: a focused view over AuditLogs for just the sign-in/sign-out
// lifecycle (successful logins, failed attempts with the reason, and
// logouts), with IP + device already attached. Same underlying table as the
// general Audit Trail — this just narrows Action to the auth-related ones
// and defaults to the last 90 days so the screen loads fast.
async function listLoginHistory(req, res) {
  try {
    const { userId, status, from, to } = req.query;
    const pool = await getPool();
    const request = pool.request();
    let where = `l.Action IN ('login', 'login.failed', 'logout')`;

    if (userId) { request.input('userId', sql.Int, userId); where += ' AND l.UserId = @userId'; }
    if (status === 'success') where += ` AND l.Action = 'login'`;
    if (status === 'failed') where += ` AND l.Action = 'login.failed'`;
    if (status === 'logout') where += ` AND l.Action = 'logout'`;

    const defaultFrom = new Date(); defaultFrom.setDate(defaultFrom.getDate() - 90);
    request.input('from', sql.DateTime2, from ? new Date(from) : defaultFrom);
    where += ' AND l.CreatedAt >= @from';
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      request.input('to', sql.DateTime2, toDate);
      where += ' AND l.CreatedAt <= @to';
    }

    const result = await request.query(`
      SELECT TOP 500 l.LogId, l.UserId, u.Username, u.FullName, l.Action, l.Details, l.IpAddress, l.UserAgent, l.CreatedAt
      FROM dbo.AuditLogs l
      LEFT JOIN dbo.Users u ON u.UserId = l.UserId
      WHERE ${where}
      ORDER BY l.CreatedAt DESC
    `);

    res.json(result.recordset);
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'auditController.js' });
    res.status(500).json({ message: 'Failed to fetch login history', error: err.message });
  }
}

async function listAuditFilters(req, res) {
  try {
    const pool = await getPool();
    const actions = await pool.request().query(`SELECT DISTINCT Action FROM dbo.AuditLogs ORDER BY Action`);
    const modules = await pool.request().query(`SELECT DISTINCT Module FROM dbo.AuditLogs WHERE Module IS NOT NULL ORDER BY Module`);
    const users = await pool.request().query(`
      SELECT DISTINCT u.UserId, u.Username, u.FullName
      FROM dbo.AuditLogs l JOIN dbo.Users u ON u.UserId = l.UserId
      ORDER BY u.Username
    `);
    res.json({
      actions: actions.recordset.map(r => r.Action),
      modules: modules.recordset.map(r => r.Module),
      users: users.recordset
    });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'auditController.js' });
    res.status(500).json({ message: 'Failed to fetch audit filter options', error: err.message });
  }
}

module.exports = { listAuditLogs, listAuditFilters, listLoginHistory };
