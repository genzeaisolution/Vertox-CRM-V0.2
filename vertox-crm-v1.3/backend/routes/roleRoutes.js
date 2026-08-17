const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/roleController');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { requireIntParam } = require('../middleware/validateParams');

router.use(requireAuth);
router.get('/', ctrl.listRoles);
router.get('/permissions/all', ctrl.listPermissions);
router.post('/', requirePermission('roles.manage'), ctrl.createRole);
router.put('/:id', requireIntParam('id'), requirePermission('roles.manage'), ctrl.updateRole);
router.delete('/:id', requireIntParam('id'), requirePermission('roles.manage'), ctrl.deleteRole);

module.exports = router;
