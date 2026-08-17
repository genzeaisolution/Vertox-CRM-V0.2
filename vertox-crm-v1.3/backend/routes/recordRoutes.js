const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/recordController');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { requireIntParam } = require('../middleware/validateParams');

router.use(requireAuth);
// NOTE: '/single/:id' routes MUST be registered before the generic '/:moduleKey'
// route. Express matches routes in declaration order, and '/:moduleKey' matches
// ANY single path segment (including the literal word "single"), so if it were
// declared first it would swallow every /single/... request and the routes
// below it would become unreachable.
router.get('/single/:id', requireIntParam('id'), requirePermission('records.view'), ctrl.getRecord);
router.put('/single/:id', requireIntParam('id'), requirePermission('records.edit'), ctrl.updateRecord);
router.delete('/single/:id', requireIntParam('id'), requirePermission('records.delete'), ctrl.deleteRecord);
router.get('/:moduleKey/export', requirePermission('records.view'), ctrl.exportRecords);
router.get('/:moduleKey', requirePermission('records.view'), ctrl.listRecords);
router.post('/:moduleKey', requirePermission('records.create'), ctrl.createRecord);

module.exports = router;
