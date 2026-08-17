const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/milestoneController');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { requireIntParam } = require('../middleware/validateParams');

router.use(requireAuth);
router.get('/grants', requirePermission('milestones.view'), ctrl.listGrantOptions);
router.get('/', requirePermission('milestones.view'), ctrl.listMilestones);
router.post('/', requirePermission('milestones.manage'), ctrl.createMilestone);
router.put('/:id', requireIntParam('id'), requirePermission('milestones.manage'), ctrl.updateMilestone);
router.delete('/:id', requireIntParam('id'), requirePermission('milestones.manage'), ctrl.deleteMilestone);

module.exports = router;
