const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/shiftController');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { requireIntParam } = require('../middleware/validateParams');

router.use(requireAuth);
router.get('/volunteers', requirePermission('shifts.view'), ctrl.listVolunteerOptions);
router.get('/summary/:id', requireIntParam('id'), requirePermission('shifts.view'), ctrl.volunteerSummary);
router.get('/', requirePermission('shifts.view'), ctrl.listShifts);
router.post('/', requirePermission('shifts.manage'), ctrl.createShift);
router.put('/:id', requireIntParam('id'), requirePermission('shifts.manage'), ctrl.updateShift);
router.delete('/:id', requireIntParam('id'), requirePermission('shifts.manage'), ctrl.deleteShift);

module.exports = router;
