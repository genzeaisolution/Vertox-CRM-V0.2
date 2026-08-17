const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/approvalController');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { requireIntParam } = require('../middleware/validateParams');

router.use(requireAuth);

router.get('/my-pending', ctrl.myPendingSteps);
router.get('/record/:recordId', requireIntParam('recordId'), requirePermission('approvals.view'), ctrl.listForRecord);
router.post('/record/:recordId', requireIntParam('recordId'), requirePermission('approvals.manage'), ctrl.createRequest);
// No requirePermission on acting a step — identity (are you the assigned
// approver?) is checked inside the controller instead, since "can I
// approve" isn't a role-level permission, it's a per-step assignment.
router.post('/steps/:stepId/act', requireIntParam('stepId'), ctrl.actOnStep);
router.delete('/:requestId', requireIntParam('requestId'), ctrl.cancelRequest);

module.exports = router;
