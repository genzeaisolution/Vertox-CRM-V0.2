const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/grantExpenseController');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { requireIntParam } = require('../middleware/validateParams');

router.use(requireAuth);
router.get('/:grantId/budget', requireIntParam('grantId'), requirePermission('records.view'), ctrl.budgetSummary);
router.post('/:grantId/expenses', requireIntParam('grantId'), requirePermission('records.edit'), ctrl.createExpense);
router.delete('/expenses/:id', requireIntParam('id'), requirePermission('records.edit'), ctrl.deleteExpense);

module.exports = router;
