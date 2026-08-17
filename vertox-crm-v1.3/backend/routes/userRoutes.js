const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/userController');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { requireIntParam } = require('../middleware/validateParams');

router.use(requireAuth);
router.get('/assignable', ctrl.listAssignableUsers);
router.get('/', requirePermission('users.view'), ctrl.listUsers);
router.get('/:id', requireIntParam('id'), requirePermission('users.view'), ctrl.getUser);
router.post('/', requirePermission('users.create'), ctrl.createUser);
router.put('/:id', requireIntParam('id'), requirePermission('users.edit'), ctrl.updateUser);
router.delete('/:id', requireIntParam('id'), requirePermission('users.delete'), ctrl.deleteUser);

module.exports = router;
