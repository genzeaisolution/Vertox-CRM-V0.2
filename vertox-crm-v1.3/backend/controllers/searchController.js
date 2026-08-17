const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');

// One query across every module's records: matches on Title, Status, or
// anywhere inside the dynamic FieldsJson blob (a simple LIKE against the
// raw JSON text — good enough for a "did I type something that appears
// somewhere in this record" global search, without needing a per-field
// index). Capped at 20 results so the topbar dropdown stays fast and small.
async function globalSearch(req, res) {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json([]);

    const pool = await getPool();
    const result = await pool.request()
      .input('q', sql.NVarChar, '%' + q.replace(/[%_[\]]/g, '') + '%')
      .query(`
        SELECT TOP 20 r.RecordId, r.Title, r.Status, r.UpdatedAt,
               m.ModuleKey, m.Label AS ModuleLabel, m.Icon AS ModuleIcon
        FROM dbo.Records r
        JOIN dbo.Modules m ON m.ModuleId = r.ModuleId
        WHERE r.Title LIKE @q OR r.Status LIKE @q OR r.FieldsJson LIKE @q
        ORDER BY r.UpdatedAt DESC
      `);
    res.json(result.recordset.map(row => ({
      recordId: row.RecordId,
      title: row.Title || '(untitled)',
      status: row.Status,
      moduleKey: row.ModuleKey,
      moduleLabel: row.ModuleLabel,
      moduleIcon: row.ModuleIcon,
      updatedAt: row.UpdatedAt
    })));
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'searchController.js' });
    res.status(500).json({ message: 'Search failed' });
  }
}

module.exports = { globalSearch };
