const fs = require('fs');
const path = require('path');
const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');
const { UPLOAD_ROOT } = require('../middleware/upload');

const CATEGORIES = ['Contract', 'Receipt', 'ID Proof', 'Report', 'Photo', 'Correspondence', 'Other'];

async function assertRecordExists(pool, recordId) {
  const row = await pool.request().input('id', sql.Int, recordId).query(`
    SELECT r.RecordId, m.ModuleKey
    FROM dbo.Records r JOIN dbo.Modules m ON m.ModuleId = r.ModuleId
    WHERE r.RecordId = @id
  `);
  return row.recordset[0] || null;
}

// Groups every version of the same document together (see DocGroupKey
// comment in schema.sql) so the UI can show "Report.pdf — v3 (2 older
// versions)" instead of a flat, confusing file list.
function groupByDocument(rows) {
  const groups = {};
  rows.forEach(r => {
    if (!groups[r.DocGroupKey]) groups[r.DocGroupKey] = [];
    groups[r.DocGroupKey].push(r);
  });
  return Object.values(groups).map(versions => {
    versions.sort((a, b) => b.VersionNumber - a.VersionNumber);
    const latest = versions[0];
    return {
      docGroupKey: latest.DocGroupKey,
      originalName: latest.OriginalName,
      category: latest.Category,
      latest: {
        attachmentId: latest.AttachmentId,
        versionNumber: latest.VersionNumber,
        sizeBytes: latest.SizeBytes,
        mimeType: latest.MimeType,
        uploadedByName: latest.UploadedByName,
        createdAt: latest.CreatedAt
      },
      versions: versions.map(v => ({
        attachmentId: v.AttachmentId,
        versionNumber: v.VersionNumber,
        sizeBytes: v.SizeBytes,
        mimeType: v.MimeType,
        uploadedByName: v.UploadedByName,
        createdAt: v.CreatedAt
      }))
    };
  }).sort((a, b) => new Date(b.latest.createdAt) - new Date(a.latest.createdAt));
}

async function listForRecord(req, res) {
  try {
    const pool = await getPool();
    const recordId = Number(req.params.recordId);
    const record = await assertRecordExists(pool, recordId);
    if (!record) return res.status(404).json({ message: 'Record not found' });

    const result = await pool.request().input('recordId', sql.Int, recordId).query(`
      SELECT a.*, u.FullName AS UploadedByName
      FROM dbo.Attachments a
      LEFT JOIN dbo.Users u ON u.UserId = a.UploadedBy
      WHERE a.RecordId = @recordId
      ORDER BY a.CreatedAt DESC
    `);

    res.json({ categories: CATEGORIES, documents: groupByDocument(result.recordset) });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'attachmentController.js:listForRecord' });
    res.status(500).json({ message: 'Failed to list attachments' });
  }
}

async function uploadAttachment(req, res) {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded (field name must be "file")' });

    const pool = await getPool();
    const recordId = Number(req.params.recordId);
    const record = await assertRecordExists(pool, recordId);
    if (!record) {
      fs.unlink(req.file.path, () => {}); // don't leave an orphaned file on disk
      return res.status(404).json({ message: 'Record not found' });
    }

    const category = CATEGORIES.includes(req.body.category) ? req.body.category : 'Other';
    const docGroupKey = `${recordId}:${(req.file.originalname || '').trim().toLowerCase()}`;

    const existing = await pool.request().input('key', sql.NVarChar, docGroupKey).query(`
      SELECT ISNULL(MAX(VersionNumber), 0) AS maxVersion FROM dbo.Attachments WHERE DocGroupKey = @key
    `);
    const versionNumber = (existing.recordset[0].maxVersion || 0) + 1;

    const insertResult = await pool.request()
      .input('recordId', sql.Int, recordId)
      .input('moduleKey', sql.NVarChar, record.ModuleKey)
      .input('category', sql.NVarChar, category)
      .input('originalName', sql.NVarChar, req.file.originalname)
      .input('storedName', sql.NVarChar, req.file.filename)
      .input('mimeType', sql.NVarChar, req.file.mimetype || null)
      .input('sizeBytes', sql.Int, req.file.size || 0)
      .input('docGroupKey', sql.NVarChar, docGroupKey)
      .input('versionNumber', sql.Int, versionNumber)
      .input('uploadedBy', sql.Int, req.user.userId)
      .query(`
        INSERT INTO dbo.Attachments
          (RecordId, ModuleKey, Category, OriginalName, StoredName, MimeType, SizeBytes, DocGroupKey, VersionNumber, UploadedBy)
        OUTPUT INSERTED.AttachmentId
        VALUES (@recordId, @moduleKey, @category, @originalName, @storedName, @mimeType, @sizeBytes, @docGroupKey, @versionNumber, @uploadedBy)
      `);

    logger.audit(req.user?.userId, 'attachment.upload', {
      attachmentId: insertResult.recordset[0].AttachmentId, recordId, versionNumber, originalName: req.file.originalname
    });
    res.status(201).json({
      message: versionNumber > 1 ? `Uploaded as version ${versionNumber}` : 'File uploaded',
      attachmentId: insertResult.recordset[0].AttachmentId,
      versionNumber
    });
  } catch (err) {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'attachmentController.js:upload' });
    res.status(500).json({ message: 'Failed to upload attachment', error: err.message });
  }
}

async function downloadAttachment(req, res) {
  try {
    const pool = await getPool();
    const id = Number(req.params.id);
    const result = await pool.request().input('id', sql.Int, id)
      .query(`SELECT * FROM dbo.Attachments WHERE AttachmentId = @id`);
    const attachment = result.recordset[0];
    if (!attachment) return res.status(404).json({ message: 'Attachment not found' });

    const filePath = path.join(UPLOAD_ROOT, attachment.StoredName);
    if (!fs.existsSync(filePath)) {
      logger.error('CONTROLLER', 'Attachment row exists but file missing on disk', { file: 'attachmentController.js:download', attachmentId: id, filePath });
      return res.status(404).json({ message: 'File is missing from storage' });
    }

    logger.audit(req.user?.userId, 'attachment.download', { attachmentId: id });
    res.download(filePath, attachment.OriginalName);
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'attachmentController.js:download' });
    res.status(500).json({ message: 'Failed to download attachment' });
  }
}

async function deleteAttachment(req, res) {
  try {
    const pool = await getPool();
    const id = Number(req.params.id);
    const result = await pool.request().input('id', sql.Int, id)
      .query(`SELECT * FROM dbo.Attachments WHERE AttachmentId = @id`);
    const attachment = result.recordset[0];
    if (!attachment) return res.status(404).json({ message: 'Attachment not found' });

    await pool.request().input('id', sql.Int, id).query(`DELETE FROM dbo.Attachments WHERE AttachmentId = @id`);
    const filePath = path.join(UPLOAD_ROOT, attachment.StoredName);
    fs.unlink(filePath, () => {}); // best-effort — DB row is the source of truth, a stray file left behind isn't fatal

    logger.audit(req.user?.userId, 'attachment.delete', { attachmentId: id, originalName: attachment.OriginalName });
    res.json({ message: 'Attachment deleted' });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'attachmentController.js:delete' });
    res.status(500).json({ message: 'Failed to delete attachment' });
  }
}

module.exports = { listForRecord, uploadAttachment, downloadAttachment, deleteAttachment, CATEGORIES };
