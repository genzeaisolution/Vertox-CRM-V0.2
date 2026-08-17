const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/auditController');
const { requireAuth, requirePermission } = require('../middleware/auth');

router.use(requireAuth);
router.get('/filters', requirePermission('audit.view'), ctrl.listAuditFilters);
router.get('/login-history', requirePermission('audit.view'), ctrl.listLoginHistory);
router.get('/', requirePermission('audit.view'), ctrl.listAuditLogs);

module.exports = router;
