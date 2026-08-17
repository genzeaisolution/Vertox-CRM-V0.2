const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/reportController');
const { requireAuth, requirePermission } = require('../middleware/auth');

router.use(requireAuth);
router.get('/summary', requirePermission('records.view'), ctrl.getSummaryReport);
router.get('/timeseries', requirePermission('records.view'), ctrl.getTimeseries);
router.get('/records', requirePermission('records.view'), ctrl.getFilteredRecords);
router.get('/upcoming', requirePermission('records.view'), ctrl.getUpcomingDates);
router.get('/donor-grant-kpis', requirePermission('records.view'), ctrl.getDonorGrantKpis);
router.get('/:moduleKey', requirePermission('records.view'), ctrl.getModuleReport);

module.exports = router;
