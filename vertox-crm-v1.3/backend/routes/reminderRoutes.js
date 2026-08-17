const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/reminderController');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { requireIntParam } = require('../middleware/validateParams');

router.use(requireAuth);
router.get('/schedules', requirePermission('reminders.view'), ctrl.listSchedules);
router.post('/schedules', requirePermission('reminders.manage'), ctrl.createSchedule);
router.put('/schedules/:id', requireIntParam('id'), requirePermission('reminders.manage'), ctrl.updateSchedule);
router.delete('/schedules/:id', requireIntParam('id'), requirePermission('reminders.manage'), ctrl.deleteSchedule);

router.get('/', requirePermission('reminders.view'), ctrl.listReminders);
router.put('/:id/action', requireIntParam('id'), requirePermission('reminders.manage'), ctrl.actionReminder);
router.post('/run-sweep', requirePermission('reminders.manage'), ctrl.runSweepNow);

module.exports = router;
