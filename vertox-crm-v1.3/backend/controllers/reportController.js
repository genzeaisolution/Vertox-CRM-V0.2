const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');

// Returns record data for a module (optionally filtered by created-date range
// and status) together with the module's field definitions, so the frontend
// can build a fully dynamic report table/export regardless of which fields
// the module currently has.
async function getModuleReport(req, res) {
  try {
    const { moduleKey } = req.params;
    const { from, to, status } = req.query;
    const pool = await getPool();

    const mod = await pool.request().input('key', sql.NVarChar, moduleKey)
      .query(`SELECT ModuleId, Label FROM dbo.Modules WHERE ModuleKey = @key`);
    if (!mod.recordset[0]) return res.status(404).json({ message: 'Module not found' });
    const moduleId = mod.recordset[0].ModuleId;

    const fieldsResult = await pool.request().input('moduleId', sql.Int, moduleId)
      .query(`SELECT * FROM dbo.ModuleFields WHERE ModuleId = @moduleId ORDER BY SortOrder`);
    const fields = fieldsResult.recordset.map(f => ({ ...f, Options: f.Options ? JSON.parse(f.Options) : null }));

    const request = pool.request().input('moduleId', sql.Int, moduleId);
    let where = 'r.ModuleId = @moduleId';
    if (from) { request.input('from', sql.DateTime2, new Date(from)); where += ' AND r.CreatedAt >= @from'; }
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      request.input('to', sql.DateTime2, toDate);
      where += ' AND r.CreatedAt <= @to';
    }
    if (status) { request.input('status', sql.NVarChar, status); where += ' AND r.Status = @status'; }

    const result = await request.query(`
      SELECT r.RecordId, r.Title, r.Status, r.FieldsJson, r.CreatedAt, r.UpdatedAt, u.FullName AS OwnerName
      FROM dbo.Records r
      LEFT JOIN dbo.Users u ON u.UserId = r.OwnerId
      WHERE ${where}
      ORDER BY r.CreatedAt DESC
    `);

    const records = result.recordset.map(row => ({
      recordId: row.RecordId,
      title: row.Title,
      status: row.Status,
      ownerName: row.OwnerName,
      createdAt: row.CreatedAt,
      updatedAt: row.UpdatedAt,
      fields: row.FieldsJson ? JSON.parse(row.FieldsJson) : {}
    }));

    res.json({ moduleKey, moduleLabel: mod.recordset[0].Label, fields, records });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'reportController.js' });
    res.status(500).json({ message: 'Failed to build report', error: err.message });
  }
}

// Lightweight summary across ALL modules for a given date range — used by
// the "all modules at once" report view and by dashboard KPI widgets.
async function getSummaryReport(req, res) {
  try {
    const { from, to } = req.query;
    const pool = await getPool();

    const request = pool.request();
    let where = '1=1';
    if (from) { request.input('from', sql.DateTime2, new Date(from)); where += ' AND r.CreatedAt >= @from'; }
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      request.input('to', sql.DateTime2, toDate);
      where += ' AND r.CreatedAt <= @to';
    }

    const result = await request.query(`
      SELECT m.ModuleKey, m.Label, r.Status, COUNT(*) AS total
      FROM dbo.Records r
      JOIN dbo.Modules m ON m.ModuleId = r.ModuleId
      WHERE ${where}
      GROUP BY m.ModuleKey, m.Label, r.Status
    `);

    res.json(result.recordset);
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'reportController.js' });
    res.status(500).json({ message: 'Failed to build summary report', error: err.message });
  }
}

// Records created per day, for a trend line chart — optionally scoped to a
// single module. Always DB-driven (GROUP BY on Records.CreatedAt), never
// hard-coded, so it reflects real data immediately.
async function getTimeseries(req, res) {
  try {
    const { moduleKey, days } = req.query;
    const pool = await getPool();
    const span = Math.min(Math.max(parseInt(days, 10) || 30, 1), 365);
    const since = new Date();
    since.setDate(since.getDate() - span);

    const request = pool.request().input('since', sql.DateTime2, since);
    let where = 'r.CreatedAt >= @since';

    if (moduleKey) {
      const mod = await pool.request().input('key', sql.NVarChar, moduleKey)
        .query(`SELECT ModuleId FROM dbo.Modules WHERE ModuleKey = @key`);
      if (!mod.recordset[0]) return res.status(404).json({ message: 'Module not found' });
      request.input('moduleId', sql.Int, mod.recordset[0].ModuleId);
      where += ' AND r.ModuleId = @moduleId';
    }

    const result = await request.query(`
      SELECT CAST(r.CreatedAt AS DATE) AS day, COUNT(*) AS total
      FROM dbo.Records r
      WHERE ${where}
      GROUP BY CAST(r.CreatedAt AS DATE)
      ORDER BY day
    `);

    res.json(result.recordset.map(r => ({ day: r.day, total: r.total })));
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'reportController.js' });
    res.status(500).json({ message: 'Failed to build timeseries', error: err.message });
  }
}

// Flat, cross-module list of records for dashboard drill-down: click a bar
// in "Records per Module" or a slice in "Records by Status" and this backs
// the popup with the actual records behind that number (optionally scoped
// by moduleKey/status/date-range). Capped at 100 rows — this is a preview
// list for a modal, not a full export (use /reports/:moduleKey for that).
async function getFilteredRecords(req, res) {
  try {
    const { moduleKey, status, from, to } = req.query;
    const pool = await getPool();
    const request = pool.request();
    let where = '1=1';

    if (moduleKey) {
      const mod = await pool.request().input('key', sql.NVarChar, moduleKey)
        .query(`SELECT ModuleId FROM dbo.Modules WHERE ModuleKey = @key`);
      if (!mod.recordset[0]) return res.status(404).json({ message: 'Module not found' });
      request.input('moduleId', sql.Int, mod.recordset[0].ModuleId);
      where += ' AND r.ModuleId = @moduleId';
    }
    if (status) {
      request.input('status', sql.NVarChar, status === 'Unspecified' ? '' : status);
      where += status === 'Unspecified' ? ' AND (r.Status IS NULL OR r.Status = @status)' : ' AND r.Status = @status';
    }
    if (from) { request.input('from', sql.DateTime2, new Date(from)); where += ' AND r.CreatedAt >= @from'; }
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      request.input('to', sql.DateTime2, toDate);
      where += ' AND r.CreatedAt <= @to';
    }

    const result = await request.query(`
      SELECT TOP 100 r.RecordId, r.Title, r.Status, r.CreatedAt, m.Label AS ModuleLabel, m.ModuleKey, u.FullName AS OwnerName
      FROM dbo.Records r
      JOIN dbo.Modules m ON m.ModuleId = r.ModuleId
      LEFT JOIN dbo.Users u ON u.UserId = r.OwnerId
      WHERE ${where}
      ORDER BY r.CreatedAt DESC
    `);

    res.json(result.recordset);
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'reportController.js' });
    res.status(500).json({ message: 'Failed to fetch records', error: err.message });
  }
}

// Cross-module "what's coming up" widget: scans EVERY date/datetime field on
// EVERY module (not a hardcoded list of "due_date"/"deadline" columns), reads
// each record's FieldsJson for that field, and returns anything falling in
// the next N days. New modules and new date fields need zero code changes
// here — they're picked up the next time this runs because it reads
// ModuleFields live.
async function getUpcomingDates(req, res) {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 14, 1), 365);
    const pool = await getPool();

    const dateFieldsResult = await pool.request().query(`
      SELECT mf.FieldId, mf.FieldKey, mf.Label AS FieldLabel, mf.ModuleId, m.ModuleKey, m.Label AS ModuleLabel
      FROM dbo.ModuleFields mf
      JOIN dbo.Modules m ON m.ModuleId = mf.ModuleId
      WHERE mf.FieldType IN ('date', 'datetime')
    `);
    const dateFields = dateFieldsResult.recordset;
    if (!dateFields.length) return res.json([]);

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const until = new Date(today); until.setDate(until.getDate() + days);

    const moduleIds = [...new Set(dateFields.map(f => f.ModuleId))];
    const recordsResult = await pool.request().query(`
      SELECT r.RecordId, r.Title, r.ModuleId, r.FieldsJson
      FROM dbo.Records r
      WHERE r.ModuleId IN (${moduleIds.join(',')})
    `);

    const upcoming = [];
    for (const rec of recordsResult.recordset) {
      let fields = {};
      try { fields = rec.FieldsJson ? JSON.parse(rec.FieldsJson) : {}; } catch (e) { continue; }
      const fieldsForThisModule = dateFields.filter(f => f.ModuleId === rec.ModuleId);
      for (const f of fieldsForThisModule) {
        const raw = fields[f.FieldKey];
        if (!raw) continue;
        const d = new Date(raw);
        if (isNaN(d.getTime())) continue;
        if (d >= today && d <= until) {
          upcoming.push({
            recordId: rec.RecordId,
            title: rec.Title || '(untitled)',
            moduleKey: f.ModuleKey,
            moduleLabel: f.ModuleLabel,
            fieldLabel: f.FieldLabel,
            date: d.toISOString()
          });
        }
      }
    }
    upcoming.sort((a, b) => new Date(a.date) - new Date(b.date));
    res.json(upcoming.slice(0, 50));
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'reportController.js' });
    res.status(500).json({ message: 'Failed to fetch upcoming dates', error: err.message });
  }
}

// Donor + Grant KPI dashboard: donor retention, top donors, average gift size,
// recurring-donor share, grant portfolio health (status mix + milestone
// completion as a stand-in for budget/deliverable progress), and
// cost-per-beneficiary (total program expense from the Ledger divided by
// beneficiaries on file). Nothing here is a new table — it's all computed
// live from the same Records/FieldsJson + LedgerEntries data every other
// screen already writes to, so it reflects real numbers the moment
// donations/grants/expenses are entered, with zero extra data entry.
async function getDonorGrantKpis(req, res) {
  try {
    const { from, to } = req.query;
    const pool = await getPool();

    const modRes = await pool.request().query(`
      SELECT ModuleId, ModuleKey FROM dbo.Modules WHERE ModuleKey IN ('donations','donors','grants','beneficiaries')
    `);
    const modIds = {};
    modRes.recordset.forEach(m => { modIds[m.ModuleKey] = m.ModuleId; });

    async function fetchRecords(moduleKey) {
      const moduleId = modIds[moduleKey];
      if (!moduleId) return [];
      const r = await pool.request().input('mid', sql.Int, moduleId).query(`
        SELECT RecordId, Title, Status, FieldsJson, CreatedAt FROM dbo.Records WHERE ModuleId = @mid
      `);
      return r.recordset.map(row => {
        let fields = {};
        try { fields = row.FieldsJson ? JSON.parse(row.FieldsJson) : {}; } catch (e) { /* skip malformed */ }
        return { recordId: row.RecordId, title: row.Title, status: row.Status, createdAt: row.CreatedAt, fields };
      });
    }

    const [donations, grants, beneficiaries] = await Promise.all([
      fetchRecords('donations'), fetchRecords('grants'), fetchRecords('beneficiaries')
    ]);

    const fromDate = from ? new Date(from) : null;
    const toDate = to ? (() => { const d = new Date(to); d.setHours(23, 59, 59, 999); return d; })() : null;
    function inRange(dateVal) {
      const d = dateVal ? new Date(dateVal) : null;
      if (!d || isNaN(d.getTime())) return !fromDate && !toDate;
      if (fromDate && d < fromDate) return false;
      if (toDate && d > toDate) return false;
      return true;
    }

    const scopedDonations = donations.filter(d => inRange(d.fields.donation_date || d.createdAt));

    // ---- Donor KPIs ----
    const donorTotals = new Map(); // donor name -> { name, amount, count, recurring }
    let totalDonationAmount = 0;
    for (const d of scopedDonations) {
      const name = String(d.fields.donor_name || d.title || 'Unknown').trim() || 'Unknown';
      const amount = Number(d.fields.amount) || 0;
      totalDonationAmount += amount;
      const cur = donorTotals.get(name) || { name, amount: 0, count: 0, recurring: false };
      cur.amount += amount;
      cur.count += 1;
      if (d.fields.is_recurring === true || d.fields.is_recurring === 'true' || d.fields.is_recurring === 1) cur.recurring = true;
      donorTotals.set(name, cur);
    }
    const topDonors = [...donorTotals.values()].sort((a, b) => b.amount - a.amount).slice(0, 10);
    const uniqueDonorCount = donorTotals.size;
    const recurringDonorCount = [...donorTotals.values()].filter(d => d.recurring).length;
    const avgDonationSize = scopedDonations.length ? totalDonationAmount / scopedDonations.length : 0;

    // Retention: donors who gave in the trailing 12-24 month window who gave
    // again in the trailing 0-12 month window (rolling year-over-year, not
    // tied to the from/to filter above so retention is always comparable).
    const now = new Date();
    const curStart = new Date(now); curStart.setFullYear(curStart.getFullYear() - 1);
    const prevStart = new Date(now); prevStart.setFullYear(prevStart.getFullYear() - 2);
    function donorsInWindow(start, end) {
      const set = new Set();
      for (const d of donations) {
        const raw = d.fields.donation_date || d.createdAt;
        const dt = raw ? new Date(raw) : null;
        if (!dt || isNaN(dt.getTime())) continue;
        if (dt >= start && dt < end) set.add(String(d.fields.donor_name || d.title || 'Unknown').trim() || 'Unknown');
      }
      return set;
    }
    const prevDonors = donorsInWindow(prevStart, curStart);
    const curDonors = donorsInWindow(curStart, now);
    let retained = 0;
    prevDonors.forEach(name => { if (curDonors.has(name)) retained++; });
    const retentionRatePct = prevDonors.size ? (retained / prevDonors.size) * 100 : null;

    // ---- Grant KPIs ----
    const grantStatusCounts = {};
    let totalGrantAmount = 0, activeGrantAmount = 0;
    for (const g of grants) {
      const status = g.fields.status || g.status || 'Unspecified';
      grantStatusCounts[status] = (grantStatusCounts[status] || 0) + 1;
      const amt = Number(g.fields.amount) || 0;
      totalGrantAmount += amt;
      if (status === 'Active') activeGrantAmount += amt;
    }

    let milestoneStats = { total: 0, completed: 0, overdue: 0 };
    const grantIds = grants.map(g => g.recordId).filter(id => Number.isInteger(id));
    if (grantIds.length) {
      const msRes = await pool.request().query(`
        SELECT Status, DueDate FROM dbo.GrantMilestones WHERE GrantRecordId IN (${grantIds.join(',')})
      `);
      const today = new Date(new Date().toDateString());
      for (const row of msRes.recordset) {
        milestoneStats.total++;
        if (row.Status === 'Completed') milestoneStats.completed++;
        else if (row.DueDate && new Date(row.DueDate) < today) milestoneStats.overdue++;
      }
    }
    const milestoneCompletionRatePct = milestoneStats.total ? (milestoneStats.completed / milestoneStats.total) * 100 : null;

    // ---- Cost per beneficiary (program expense from Ledger / beneficiaries on file) ----
    const beneficiaryCount = beneficiaries.length;
    const expReq = pool.request().input('type', sql.NVarChar, 'expense');
    let expenseWhere = 'EntryType = @type';
    if (fromDate) { expReq.input('efrom', sql.DateTime2, fromDate); expenseWhere += ' AND EntryDate >= @efrom'; }
    if (toDate) { expReq.input('eto', sql.DateTime2, toDate); expenseWhere += ' AND EntryDate <= @eto'; }
    const expRes = await expReq.query(`SELECT ISNULL(SUM(AmountBase),0) AS total FROM dbo.LedgerEntries WHERE ${expenseWhere}`);
    const totalExpense = Number(expRes.recordset[0].total) || 0;
    const costPerBeneficiary = beneficiaryCount ? totalExpense / beneficiaryCount : null;

    res.json({
      range: { from: from || null, to: to || null },
      donors: {
        uniqueDonorCount,
        totalDonationAmount,
        totalDonationCount: scopedDonations.length,
        avgDonationSize,
        recurringDonorCount,
        recurringDonorSharePct: uniqueDonorCount ? (recurringDonorCount / uniqueDonorCount) * 100 : null,
        retentionRatePct,
        retentionWindow: { prevDonorCount: prevDonors.size, retainedCount: retained },
        topDonors
      },
      grants: {
        totalGrants: grants.length,
        totalGrantAmount,
        activeGrantAmount,
        statusBreakdown: grantStatusCounts,
        milestoneCompletionRatePct,
        milestones: milestoneStats
      },
      impact: {
        beneficiaryCount,
        totalExpense,
        costPerBeneficiary
      }
    });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'reportController.js' });
    res.status(500).json({ message: 'Failed to build donor/grant KPI dashboard', error: err.message });
  }
}

module.exports = { getModuleReport, getSummaryReport, getTimeseries, getFilteredRecords, getUpcomingDates, getDonorGrantKpis };
