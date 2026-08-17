const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/attachmentController');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { requireIntParam } = require('../middleware/validateParams');
const { upload } = require('../middleware/upload');

router.use(requireAuth);

router.get('/record/:recordId', requireIntParam('recordId'), requirePermission('attachments.view'), ctrl.listForRecord);

// multer runs as its own middleware step (not inside the controller) so a
// bad upload (wrong file type, too large) returns a clean 400 here instead
// of an unhandled exception reaching the controller.
router.post('/record/:recordId', requireIntParam('recordId'), requirePermission('attachments.manage'),
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) return res.status(400).json({ message: err.message || 'Upload failed' });
      next();
    });
  },
  ctrl.uploadAttachment
);

router.get('/:id/download', requireIntParam('id'), requirePermission('attachments.view'), ctrl.downloadAttachment);
router.delete('/:id', requireIntParam('id'), requirePermission('attachments.manage'), ctrl.deleteAttachment);

module.exports = router;
