const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const FILES = {
  app: path.join(LOG_DIR, 'app.log'),
  error: path.join(LOG_DIR, 'error.log'),
  db: path.join(LOG_DIR, 'db.log'),
  auth: path.join(LOG_DIR, 'auth.log'),
  requests: path.join(LOG_DIR, 'requests.log'),
  audit: path.join(LOG_DIR, 'audit.log'),
  cors: path.join(LOG_DIR, 'cors.log')
};

function ts() {
  return new Date().toISOString();
}

function write(file, level, category, message, meta) {
  const line = `[${ts()}] [${level}] [${category}] ${message}` +
    (meta !== undefined ? ' ' + safeStringify(meta) : '') + '\n';
  try {
    fs.appendFileSync(file, line);
  } catch (e) {
    // if even logging fails, at least print to console
    console.error('LOGGER WRITE FAILED:', e.message);
  }
  // Always mirror to console too, so nothing is silent
  const consoleFn = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
  consoleFn(line.trim());
}

// Prefers X-Forwarded-For (first hop) when the app sits behind a proxy/tunnel,
// falls back to the raw socket address otherwise. Returns null (not '') when
// nothing is available so the DB column stays clean.
function extractIp(req) {
  if (!req) return null;
  const fwd = req.headers && req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.ip || (req.connection && req.connection.remoteAddress) || null;
}

function safeStringify(obj) {
  try {
    return typeof obj === 'string' ? obj : JSON.stringify(obj);
  } catch (e) {
    return '[unserializable meta]';
  }
}

const logger = {
  info(category, message, meta) { write(FILES.app, 'INFO', category, message, meta); },
  warn(category, message, meta) { write(FILES.app, 'WARN', category, message, meta); },
  error(category, message, meta) { write(FILES.error, 'ERROR', category, message, meta); },
  db(message, meta) { write(FILES.db, 'INFO', 'DB', message, meta); },
  dbError(message, meta) { write(FILES.db, 'ERROR', 'DB', message, meta); write(FILES.error, 'ERROR', 'DB', message, meta); },
  auth(message, meta) { write(FILES.auth, 'INFO', 'AUTH', message, meta); },
  authWarn(message, meta) { write(FILES.auth, 'WARN', 'AUTH', message, meta); },
  request(message, meta) { write(FILES.requests, 'INFO', 'HTTP', message, meta); },
  cors(message, meta) { write(FILES.cors, 'INFO', 'CORS', message, meta); },
  corsBlocked(message, meta) { write(FILES.cors, 'WARN', 'CORS', message, meta); },
  // `req` is optional (4th arg) so every existing call site keeps working
  // unchanged. When it IS passed, we capture the caller's IP address and
  // browser/device (User-Agent) alongside the action — this is what powers
  // "Login History" and the IP/Device columns on the Audit Trail screen.
  audit(userId, action, details, req) {
    const ip = extractIp(req);
    const userAgent = req && req.headers ? req.headers['user-agent'] || null : null;
    write(FILES.audit, 'INFO', 'AUDIT', `user=${userId || 'anonymous'} action=${action}`,
      { ...details, ip: ip || undefined, userAgent: userAgent || undefined });
    // Best-effort DB mirror so the Audit Trail UI can query real history
    // straight from the database. Lazy-require avoids a circular import
    // with db.js (which itself requires this logger), and any DB failure
    // here must never break the request that triggered the audit event.
    try {
      const { sql, getPool } = require('../config/db');
      const module = details && details.module ? String(details.module) : (action.includes('.') ? action.split('.')[0] : null);
      const recordId = details && (details.recordId ?? details.moduleId ?? details.fieldId ?? details.roleId ?? details.newUserId ?? details.targetUserId);
      getPool()
        .then(pool => pool.request()
          .input('userId', sql.Int, userId || null)
          .input('action', sql.NVarChar, action)
          .input('module', sql.NVarChar, module)
          .input('recordId', sql.NVarChar, recordId !== undefined && recordId !== null ? String(recordId) : null)
          .input('details', sql.NVarChar, safeStringify(details || {}))
          .input('ip', sql.NVarChar, ip)
          .input('userAgent', sql.NVarChar, userAgent ? String(userAgent).slice(0, 500) : null)
          .query(`INSERT INTO dbo.AuditLogs (UserId, Action, Module, RecordId, Details, IpAddress, UserAgent) VALUES (@userId, @action, @module, @recordId, @details, @ip, @userAgent)`))
        .catch(err => write(FILES.error, 'ERROR', 'AUDIT_DB', 'Failed to persist audit log to DB: ' + err.message));
    } catch (err) {
      write(FILES.error, 'ERROR', 'AUDIT_DB', 'Failed to persist audit log to DB: ' + err.message);
    }
  },
  fatal(category, message, meta) {
    write(FILES.error, 'FATAL', category, message, meta);
  }
};

// Catch anything that would otherwise crash silently
process.on('uncaughtException', (err) => {
  logger.fatal('PROCESS', 'Uncaught exception: ' + err.message, { stack: err.stack });
});
process.on('unhandledRejection', (reason) => {
  logger.fatal('PROCESS', 'Unhandled promise rejection', { reason: reason?.message || reason, stack: reason?.stack });
});

module.exports = logger;
