const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/settingsController');
const { requireAuth, requirePermission } = require('../middleware/auth');

router.use(requireAuth);
router.get('/', ctrl.getSettings);
router.put('/', requirePermission('settings.manage'), ctrl.updateSettings);
router.get('/dashboard/stats', ctrl.getDashboardStats);

module.exports = router;
