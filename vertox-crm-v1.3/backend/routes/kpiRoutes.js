const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/kpiController');
const { requireAuth, requirePermission } = require('../middleware/auth');

router.use(requireAuth);
router.get('/donor-grant', requirePermission('records.view'), ctrl.donorGrantKpis);
router.get('/campaigns', requirePermission('records.view'), ctrl.campaignKpis);
router.get('/impact-chain', requirePermission('records.view'), ctrl.impactChain);

module.exports = router;
