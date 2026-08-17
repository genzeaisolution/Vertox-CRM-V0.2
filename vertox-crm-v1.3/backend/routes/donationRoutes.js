const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/donationController');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { requireIntParam } = require('../middleware/validateParams');

router.use(requireAuth);
router.put('/:id/acknowledge', requireIntParam('id'), requirePermission('records.edit'), ctrl.acknowledgeDonation);
router.put('/:id/refund', requireIntParam('id'), requirePermission('records.edit'), ctrl.refundDonation);
router.put('/:id/cancel', requireIntParam('id'), requirePermission('records.edit'), ctrl.cancelDonation);

module.exports = router;
