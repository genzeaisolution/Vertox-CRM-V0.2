const bcrypt = require('bcryptjs');
const { sql, getPool } = require('../config/db');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const logger = require('../utils/logger');

async function login(req, res) {
  try {
    const { username, password } = req.body;
    logger.auth('Login attempt', { username });
    if (!username || !password) {
      logger.authWarn('Login rejected: missing fields', { username });
      return res.status(400).json({ message: 'Username and password are required' });
    }

    const pool = await getPool();
    const result = await pool.request()
      .input('username', sql.NVarChar, username)
      .query(`
        SELECT u.UserId, u.Username, u.Email, u.FullName, u.PasswordHash, u.Status,
               u.Theme, r.RoleId, r.RoleName
        FROM dbo.Users u
        JOIN dbo.Roles r ON r.RoleId = u.RoleId
        WHERE u.Username = @username
      `);

    const user = result.recordset[0];
    if (!user) {
      logger.authWarn('Login failed: username not found', { username });
      // No matching UserId to attach this to, so it's logged with userId=null —
      // still shows up in Login History (filterable by username in Details)
      // for spotting brute-force/guessing attempts against unknown accounts.
      logger.audit(null, 'login.failed', { username, reason: 'username_not_found' }, req);
      return res.status(401).json({ message: 'Invalid username or password' });
    }
    if (user.Status !== 'active') {
      logger.authWarn('Login failed: account not active', { username, status: user.Status });
      logger.audit(user.UserId, 'login.failed', { username, reason: 'account_inactive', status: user.Status }, req);
      return res.status(403).json({ message: 'Your account is not active' });
    }

    const match = await bcrypt.compare(password, user.PasswordHash);
    if (!match) {
      logger.authWarn('Login failed: wrong password', { username });
      logger.audit(user.UserId, 'login.failed', { username, reason: 'wrong_password' }, req);
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    const payload = { userId: user.UserId, username: user.Username, roleId: user.RoleId, roleName: user.RoleName };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);

    const expires = new Date();
    expires.setDate(expires.getDate() + 7);
    await pool.request()
      .input('userId', sql.Int, user.UserId)
      .input('token', sql.NVarChar, refreshToken)
      .input('expiresAt', sql.DateTime2, expires)
      .query(`INSERT INTO dbo.RefreshTokens (UserId, Token, ExpiresAt) VALUES (@userId, @token, @expiresAt)`);

    await pool.request().input('userId', sql.Int, user.UserId)
      .query(`UPDATE dbo.Users SET LastLoginAt = SYSUTCDATETIME() WHERE UserId = @userId`);

    logger.auth('Login successful', { userId: user.UserId, username: user.Username, role: user.RoleName });
    logger.audit(user.UserId, 'login', { username: user.Username }, req);

    res.json({
      accessToken,
      refreshToken,
      user: {
        userId: user.UserId,
        username: user.Username,
        email: user.Email,
        fullName: user.FullName,
        role: user.RoleName,
        theme: user.Theme
      }
    });
  } catch (err) {
    logger.error('AUTH', 'Login threw exception: ' + err.message, { stack: err.stack });
    res.status(500).json({ message: 'Login failed', error: err.message });
  }
}

async function refresh(req, res) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ message: 'Refresh token required' });

    const decoded = verifyRefreshToken(refreshToken);
    const pool = await getPool();
    const result = await pool.request()
      .input('token', sql.NVarChar, refreshToken)
      .query(`SELECT * FROM dbo.RefreshTokens WHERE Token = @token AND Revoked = 0`);

    if (result.recordset.length === 0) return res.status(401).json({ message: 'Refresh token invalid or revoked' });

    const payload = { userId: decoded.userId, username: decoded.username, roleId: decoded.roleId, roleName: decoded.roleName };
    const accessToken = signAccessToken(payload);
    res.json({ accessToken });
  } catch (err) {
    res.status(401).json({ message: 'Invalid refresh token' });
  }
}

async function logout(req, res) {
  try {
    const { refreshToken } = req.body;
    let userId = null;
    if (refreshToken) {
      const pool = await getPool();
      await pool.request().input('token', sql.NVarChar, refreshToken)
        .query(`UPDATE dbo.RefreshTokens SET Revoked = 1 WHERE Token = @token`);
      // Logout isn't behind requireAuth (a stale/expired access token
      // shouldn't block revoking the refresh token), so the user is
      // recovered from the refresh token itself for the audit entry.
      try { userId = verifyRefreshToken(refreshToken).userId; } catch (e) { /* token invalid/expired — log anonymously */ }
    }
    logger.auth('Logout', { hadToken: !!refreshToken });
    logger.audit(userId, 'logout', { hadToken: !!refreshToken }, req);
    res.json({ message: 'Logged out' });
  } catch (err) {
    logger.error('AUTH', 'Logout failed: ' + err.message, { stack: err.stack });
    res.status(500).json({ message: 'Logout failed' });
  }
}

async function me(req, res) {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('userId', sql.Int, req.user.userId)
      .query(`
        SELECT u.UserId, u.Username, u.Email, u.FullName, u.Theme, u.Avatar, r.RoleName, r.RoleId
        FROM dbo.Users u JOIN dbo.Roles r ON r.RoleId = u.RoleId
        WHERE u.UserId = @userId
      `);
    if (!result.recordset[0]) return res.status(404).json({ message: 'User not found' });

    const permResult = await pool.request()
      .input('roleId', sql.Int, req.user.roleId)
      .query(`
        SELECT p.PermKey FROM dbo.RolePermissions rp
        JOIN dbo.Permissions p ON p.PermissionId = rp.PermissionId
        WHERE rp.RoleId = @roleId
      `);

    res.json({
      ...result.recordset[0],
      permissions: permResult.recordset.map(p => p.PermKey)
    });
  } catch (err) {
    logger.error('AUTH', 'Failed to fetch profile: ' + err.message, { stack: err.stack });
    res.status(500).json({ message: 'Failed to fetch profile' });
  }
}

module.exports = { login, refresh, logout, me };
