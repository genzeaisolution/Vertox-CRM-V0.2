const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

// Files live outside the frontend static folder on purpose — see the
// comment above the Attachments table in database/schema.sql. Nothing
// under here is ever reachable except through the authenticated
// download route in attachmentController.js.
const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_ROOT)) fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

// Conservative allow-list: covers the document/image/spreadsheet types an
// NGO CRM actually needs (receipts, ID scans, reports, photos), and
// deliberately excludes anything executable (.exe/.js/.sh/.bat/.php...).
const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.ppt', '.pptx',
  '.txt', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.zip'
]);
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB per file

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_ROOT),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    // Random name on disk — the human-readable OriginalName is kept only
    // in the Attachments row, so a filename can never be used to guess or
    // overwrite another record's file, and duplicate uploads never collide.
    const randomName = crypto.randomBytes(24).toString('hex') + ext;
    cb(null, randomName);
  }
});

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return cb(new Error(`File type "${ext || 'unknown'}" is not allowed`));
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 1 }
});

module.exports = { upload, UPLOAD_ROOT, MAX_FILE_SIZE_BYTES };
