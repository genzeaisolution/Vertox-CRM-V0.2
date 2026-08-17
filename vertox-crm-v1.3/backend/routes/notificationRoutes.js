const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/notificationController');
const { requireAuth } = require('../middleware/auth');
const { requireIntParam } = require('../middleware/validateParams');

router.use(requireAuth);
router.get('/', ctrl.listNotifications);
router.get('/unread-count', ctrl.unreadCount);
router.put('/:id/read', requireIntParam('id'), ctrl.markRead);
router.put('/read-all', ctrl.markAllRead);
router.delete('/:id', requireIntParam('id'), ctrl.deleteNotification);

module.exports = router;
