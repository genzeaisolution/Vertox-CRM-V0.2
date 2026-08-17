const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');

async function getSettings(req, res) {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`SELECT * FROM dbo.Settings`);
    const settings = {};
    result.recordset.forEach(row => { settings[row.SettingKey] = row.SettingValue; });
    res.json(settings);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch settings' });
  }
}

async function updateSettings(req, res) {
  try {
    const pool = await getPool();
    const entries = Object.entries(req.body || {});
    for (const [key, value] of entries) {
      await pool.request().input('key', sql.NVarChar, key).input('value', sql.NVarChar, String(value))
        .query(`
          MERGE dbo.Settings AS target
          USING (SELECT @key AS SettingKey) AS src ON target.SettingKey = src.SettingKey
          WHEN MATCHED THEN UPDATE SET SettingValue = @value, UpdatedAt = SYSUTCDATETIME()
          WHEN NOT MATCHED THEN INSERT (SettingKey, SettingValue) VALUES (@key, @value);
        `);
    }
    logger.audit(req.user?.userId, 'settings.update', { keys: Object.keys(req.body||{}) }, req);
    res.json({ message: 'Settings updated successfully' });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'settingsController.js' });
    res.status(500).json({ message: 'Failed to update settings', error: err.message });
  }
}

// `from`/`to` are optional (YYYY-MM-DD). When given, the module totals and
// recent-records list are scoped to that CreatedAt range so the dashboard's
// date-range picker actually changes what's shown, not just the charts.
// totalUsers stays account-wide since it's a headcount, not activity.
async function getDashboardStats(req, res) {
  try {
    const { from, to } = req.query;
    const pool = await getPool();
    const users = await pool.request().query(`SELECT COUNT(*) AS cnt FROM dbo.Users`);

    const modReq = pool.request();
    let dateWhere = '1=1';
    if (from) { modReq.input('from', sql.DateTime2, new Date(from)); dateWhere += ' AND r.CreatedAt >= @from'; }
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      modReq.input('to', sql.DateTime2, toDate);
      dateWhere += ' AND r.CreatedAt <= @to';
    }

    const modules = await modReq.query(`
      SELECT m.ModuleKey, m.Label, COUNT(r.RecordId) AS total
      FROM dbo.Modules m LEFT JOIN dbo.Records r ON r.ModuleId = m.ModuleId AND ${dateWhere}
      GROUP BY m.ModuleKey, m.Label
    `);

    const recentReq = pool.request();
    let recentWhere = '1=1';
    if (from) { recentReq.input('from', sql.DateTime2, new Date(from)); recentWhere += ' AND r.CreatedAt >= @from'; }
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      recentReq.input('to', sql.DateTime2, toDate);
      recentWhere += ' AND r.CreatedAt <= @to';
    }
    const recent = await recentReq.query(`
      SELECT TOP 8 r.RecordId, r.Title, r.Status, r.CreatedAt, m.Label AS ModuleLabel
      FROM dbo.Records r JOIN dbo.Modules m ON m.ModuleId = r.ModuleId
      WHERE ${recentWhere}
      ORDER BY r.CreatedAt DESC
    `);
    res.json({
      totalUsers: users.recordset[0].cnt,
      modules: modules.recordset,
      recentRecords: recent.recordset
    });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'settingsController.js' });
    res.status(500).json({ message: 'Failed to fetch dashboard stats', error: err.message });
  }
}

module.exports = { getSettings, updateSettings, getDashboardStats };
