const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');

// Pulls every record for a given module and returns { fields, createdAt }
// pairs with FieldsJson already parsed — the dynamic-fields records table
// has no per-field SQL columns, so any cross-record aggregation (totals,
// grouping, trends) has to be done here in JS after a single bulk fetch,
// rather than with SQL GROUP BY on a column that doesn't exist.
async function fetchModuleRecords(pool, moduleKey) {
  const result = await pool.request().input('key', sql.NVarChar, moduleKey).query(`
    SELECT r.RecordId, r.Title, r.Status, r.FieldsJson, r.CreatedAt
    FROM dbo.Records r JOIN dbo.Modules m ON m.ModuleId = r.ModuleId
    WHERE m.ModuleKey = @key
  `);
  return result.recordset.map(r => ({
    recordId: r.RecordId,
    title: r.Title,
    status: r.Status,
    createdAt: r.CreatedAt,
    fields: r.FieldsJson ? JSON.parse(r.FieldsJson) : {}
  }));
}

function monthKey(d) {
  const dt = new Date(d);
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
}

async function donorGrantKpis(req, res) {
  try {
    const pool = await getPool();
    const [donations, grants, projects, expensesResult] = await Promise.all([
      fetchModuleRecords(pool, 'donations'),
      fetchModuleRecords(pool, 'grants'),
      fetchModuleRecords(pool, 'projects'),
      pool.request().query(`SELECT ISNULL(SUM(Amount),0) AS total FROM dbo.GrantExpenses`)
    ]);

    // ---- Donor KPIs ----
    // Refunded/Cancelled donations don't count toward money actually
    // received — same rule the ledger refund entry already encodes.
    const validDonations = donations.filter(d => !['Refunded', 'Cancelled'].includes(d.fields.donation_status));
    const totalDonationAmount = validDonations.reduce((sum, d) => sum + (Number(d.fields.amount) || 0), 0);
    const avgDonation = validDonations.length ? Math.round((totalDonationAmount / validDonations.length) * 100) / 100 : 0;

    const byDonor = {};
    validDonations.forEach(d => {
      const name = (d.fields.donor_name || 'Unknown').trim();
      byDonor[name] = (byDonor[name] || 0) + (Number(d.fields.amount) || 0);
    });
    const topDonors = Object.entries(byDonor)
      .map(([name, total]) => ({ name, total: Math.round(total * 100) / 100 }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    // Retention: of the donors who gave last calendar year, what % also
    // gave this calendar year. A standard donor-retention definition.
    const thisYear = new Date().getFullYear();
    const lastYear = thisYear - 1;
    const donorsByYear = { [thisYear]: new Set(), [lastYear]: new Set() };
    validDonations.forEach(d => {
      const dateStr = d.fields.donation_date || d.createdAt;
      if (!dateStr) return;
      const y = new Date(dateStr).getFullYear();
      if (donorsByYear[y]) donorsByYear[y].add((d.fields.donor_name || '').trim().toLowerCase());
    });
    let retainedCount = 0;
    donorsByYear[lastYear].forEach(name => { if (name && donorsByYear[thisYear].has(name)) retainedCount++; });
    const retentionRate = donorsByYear[lastYear].size > 0
      ? Math.round((retainedCount / donorsByYear[lastYear].size) * 1000) / 10
      : null;

    // Last 6 months donation trend
    const monthly = {};
    validDonations.forEach(d => {
      const key = monthKey(d.fields.donation_date || d.createdAt);
      monthly[key] = (monthly[key] || 0) + (Number(d.fields.amount) || 0);
    });
    const now = new Date();
    const trend = [];
    for (let i = 5; i >= 0; i--) {
      const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = monthKey(dt);
      trend.push({ month: key, total: Math.round((monthly[key] || 0) * 100) / 100 });
    }

    // ---- Grant KPIs ----
    const totalApproved = grants.reduce((sum, g) => sum + (Number(g.fields.approved_amount) || Number(g.fields.amount) || 0), 0);
    const totalGrantSpent = Number(expensesResult.recordset[0].total) || 0;
    const grantUtilizationPercent = totalApproved > 0 ? Math.round((totalGrantSpent / totalApproved) * 1000) / 10 : null;

    const grantsByStatus = {};
    grants.forEach(g => {
      const st = g.fields.status || 'Unknown';
      grantsByStatus[st] = (grantsByStatus[st] || 0) + 1;
    });

    // ---- Cost per beneficiary ----
    const totalBeneficiaries = projects.reduce((sum, p) => sum + (Number(p.fields.achieved_beneficiaries) || 0), 0);
    const totalSpendAllSources = totalDonationAmount + totalGrantSpent;
    const costPerBeneficiary = totalBeneficiaries > 0
      ? Math.round((totalSpendAllSources / totalBeneficiaries) * 100) / 100
      : null;

    res.json({
      donor: {
        totalDonors: Object.keys(byDonor).length,
        totalDonationAmount: Math.round(totalDonationAmount * 100) / 100,
        avgDonation,
        retentionRate,
        topDonors,
        monthlyTrend: trend
      },
      grant: {
        totalGrants: grants.length,
        totalApproved: Math.round(totalApproved * 100) / 100,
        totalSpent: Math.round(totalGrantSpent * 100) / 100,
        utilizationPercent: grantUtilizationPercent,
        byStatus: grantsByStatus
      },
      impact: {
        totalBeneficiaries,
        totalSpendAllSources: Math.round(totalSpendAllSources * 100) / 100,
        costPerBeneficiary
      }
    });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'kpiController.js' });
    res.status(500).json({ message: 'Failed to build KPI dashboard', error: err.message });
  }
}

// Per-campaign fundraising progress + ROI, plus portfolio totals.
// target_amount = fundraising goal, funds_raised = collected so far,
// budget = campaign spend/cost (these are separate fields — a campaign
// can raise money without that being the same as what it cost to run).
async function campaignKpis(req, res) {
  try {
    const pool = await getPool();
    const campaigns = await fetchModuleRecords(pool, 'campaigns');

    const list = campaigns.map(c => {
      const target = Number(c.fields.target_amount) || 0;
      const collected = Number(c.fields.funds_raised) || 0;
      const spend = Number(c.fields.budget) || 0;
      const progressPercent = target > 0 ? Math.round((collected / target) * 1000) / 10 : null;
      // ROI expressed as % return over spend: negative means the campaign
      // hasn't yet raised back what it cost to run.
      const roiPercent = spend > 0 ? Math.round(((collected - spend) / spend) * 1000) / 10 : null;
      return {
        recordId: c.recordId,
        name: c.fields.campaign_name || c.title || ('Campaign #' + c.recordId),
        status: c.fields.status || c.status || 'Unknown',
        target,
        collected,
        spend,
        reach: Number(c.fields.reach) || 0,
        progressPercent,
        roiPercent
      };
    }).sort((a, b) => (b.progressPercent ?? -1) - (a.progressPercent ?? -1));

    const totals = list.reduce((acc, c) => {
      acc.target += c.target; acc.collected += c.collected; acc.spend += c.spend; acc.reach += c.reach;
      return acc;
    }, { target: 0, collected: 0, spend: 0, reach: 0 });
    const overallProgressPercent = totals.target > 0 ? Math.round((totals.collected / totals.target) * 1000) / 10 : null;
    const overallRoiPercent = totals.spend > 0 ? Math.round(((totals.collected - totals.spend) / totals.spend) * 1000) / 10 : null;

    res.json({
      campaigns: list,
      totals: {
        totalCampaigns: list.length,
        activeCampaigns: list.filter(c => c.status === 'Active').length,
        targetAmount: Math.round(totals.target * 100) / 100,
        collectedAmount: Math.round(totals.collected * 100) / 100,
        spendAmount: Math.round(totals.spend * 100) / 100,
        totalReach: totals.reach,
        overallProgressPercent,
        overallRoiPercent
      }
    });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'kpiController.js:campaignKpis' });
    res.status(500).json({ message: 'Failed to build campaign KPIs', error: err.message });
  }
}

// Groups Impact & Outcome Indicator records into the standard NGO logframe
// chain: Input -> Activity -> Output -> Outcome -> Impact. Optional
// projectRecordId filters to a single project; otherwise every project's
// indicators are combined level-by-level, which is a useful org-wide view
// but blends different projects' targets together (each level's numbers
// are a sum across whatever indicators matched, not a single project's story).
const RESULT_LEVELS = ['Input', 'Activity', 'Output', 'Outcome', 'Impact'];

async function impactChain(req, res) {
  try {
    const pool = await getPool();
    const indicators = await fetchModuleRecords(pool, 'impact_indicators');
    const projectFilter = req.query.projectRecordId ? String(req.query.projectRecordId) : null;

    const scoped = projectFilter
      ? indicators.filter(i => String(i.fields.project) === projectFilter)
      : indicators;

    const chain = RESULT_LEVELS.map(level => {
      const atLevel = scoped.filter(i => i.fields.result_level === level);
      const target = atLevel.reduce((sum, i) => sum + (Number(i.fields.target_value) || 0), 0);
      const achieved = atLevel.reduce((sum, i) => sum + (Number(i.fields.achieved_value) || 0), 0);
      return {
        level,
        indicatorCount: atLevel.length,
        target: Math.round(target * 100) / 100,
        achieved: Math.round(achieved * 100) / 100,
        achievementPercent: target > 0 ? Math.round((achieved / target) * 1000) / 10 : null,
        indicators: atLevel.map(i => ({
          recordId: i.recordId,
          name: i.fields.indicator_name || i.title,
          unit: i.fields.unit_of_measure || '',
          target: Number(i.fields.target_value) || 0,
          achieved: Number(i.fields.achieved_value) || 0,
          achievementPercent: i.fields.target_value ? Math.round((Number(i.fields.achieved_value || 0) / Number(i.fields.target_value)) * 1000) / 10 : null,
          period: i.fields.reporting_period || ''
        }))
      };
    });

    res.json({ projectRecordId: projectFilter, chain, totalIndicators: scoped.length });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'kpiController.js:impactChain' });
    res.status(500).json({ message: 'Failed to build impact chain', error: err.message });
  }
}

module.exports = { donorGrantKpis, campaignKpis, impactChain };
