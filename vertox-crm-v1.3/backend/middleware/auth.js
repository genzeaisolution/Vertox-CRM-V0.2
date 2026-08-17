const { verifyAccessToken } = require('../utils/jwt');
const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      logger.authWarn('Request with no token', { path: req.originalUrl });
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = verifyAccessToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    logger.authWarn('Invalid or expired token rejected', { path: req.originalUrl, error: err.message });
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

function requirePermission(permKey) {
  return async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ message: 'Unauthorized' });
      if (req.user.roleName === 'SuperAdmin') return next();

      const pool = await getPool();
      const result = await pool.request()
        .input('roleId', sql.Int, req.user.roleId)
        .input('permKey', sql.NVarChar, permKey)
        .query(`
          SELECT rp.RoleId
          FROM dbo.RolePermissions rp
          JOIN dbo.Permissions p ON p.PermissionId = rp.PermissionId
          WHERE rp.RoleId = @roleId AND p.PermKey = @permKey
        `);

      if (result.recordset.length === 0) {
        logger.authWarn('Permission denied', { userId: req.user.userId, username: req.user.username, permKey, path: req.originalUrl });
        return res.status(403).json({ message: 'You do not have permission to perform this action' });
      }
      next();
    } catch (err) {
      logger.error('AUTH', 'Permission check failed with exception: ' + err.message, { stack: err.stack, permKey, path: req.originalUrl });
      res.status(500).json({ message: 'Permission check failed' });
    }
  };
}

module.exports = { requireAuth, requirePermission };
