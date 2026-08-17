const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/moduleController');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { requireIntParam } = require('../middleware/validateParams');

router.use(requireAuth);
router.get('/', ctrl.listModules);
router.post('/', requirePermission('modules.manage'), ctrl.createModule);
router.delete('/:id', requireIntParam('id'), requirePermission('modules.manage'), ctrl.deleteModule);

router.post('/:moduleId/fields', requireIntParam('moduleId'), requirePermission('modules.manage'), ctrl.addField);
router.put('/fields/:fieldId', requireIntParam('fieldId'), requirePermission('modules.manage'), ctrl.updateField);
router.delete('/fields/:fieldId', requireIntParam('fieldId'), requirePermission('modules.manage'), ctrl.deleteField);

module.exports = router;
