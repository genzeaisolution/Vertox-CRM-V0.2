const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/ledgerController');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { requireIntParam } = require('../middleware/validateParams');

router.use(requireAuth);

router.get('/summary', requirePermission('ledger.view'), ctrl.getLedgerSummary);

router.get('/currencies', requirePermission('ledger.view'), ctrl.listCurrencies);
router.post('/currencies', requirePermission('ledger.manage'), ctrl.createCurrency);
router.put('/currencies/:code', requirePermission('ledger.manage'), ctrl.updateCurrency);
router.delete('/currencies/:code', requirePermission('ledger.manage'), ctrl.deleteCurrency);

router.get('/entries', requirePermission('ledger.view'), ctrl.listEntries);
router.post('/entries', requirePermission('ledger.manage'), ctrl.createEntry);
router.put('/entries/:id', requireIntParam('id'), requirePermission('ledger.manage'), ctrl.updateEntry);
router.delete('/entries/:id', requireIntParam('id'), requirePermission('ledger.manage'), ctrl.deleteEntry);

module.exports = router;
