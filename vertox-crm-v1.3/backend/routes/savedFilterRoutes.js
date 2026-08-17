const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/savedFilterController');
const { requireAuth } = require('../middleware/auth');
const { requireIntParam } = require('../middleware/validateParams');

router.use(requireAuth);
router.get('/:moduleKey', ctrl.listFilters);
router.post('/:moduleKey', ctrl.createFilter);
router.delete('/single/:id', requireIntParam('id'), ctrl.deleteFilter);

module.exports = router;
