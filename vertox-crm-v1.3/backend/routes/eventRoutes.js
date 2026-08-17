const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/eventController');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { requireIntParam } = require('../middleware/validateParams');

router.use(requireAuth);
router.get('/:eventId/checkins', requireIntParam('eventId'), requirePermission('records.view'), ctrl.listCheckIns);
router.post('/:eventId/checkins', requireIntParam('eventId'), requirePermission('records.edit'), ctrl.createCheckIn);
router.delete('/checkins/:id', requireIntParam('id'), requirePermission('records.edit'), ctrl.deleteCheckIn);
router.get('/:eventId/report', requireIntParam('eventId'), requirePermission('records.view'), ctrl.eventReport);

module.exports = router;
