const bcrypt = require('bcryptjs');
const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');
const { validateRequired, validateEmail, hasErrors, sendValidationError } = require('../utils/validate');

async function listUsers(req, res) {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT u.UserId, u.Username, u.Email, u.FullName, u.Status, u.Theme,
             u.LastLoginAt, u.CreatedAt, r.RoleId, r.RoleName
      FROM dbo.Users u
      JOIN dbo.Roles r ON r.RoleId = u.RoleId
      ORDER BY u.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'userController.js' });
    res.status(500).json({ message: 'Failed to fetch users' });
  }
}

// Minimal id+name list for "assign to" dropdowns (case worker, follow-up by,
// etc.) — deliberately open to any authenticated user (not gated behind
// users.view) since picking a colleague to assign work to isn't sensitive,
// unlike the full user list with email/role/login history above.
async function listAssignableUsers(req, res) {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT UserId, FullName, Username FROM dbo.Users WHERE Status = 'Active' ORDER BY FullName
    `);
    res.json(result.recordset);
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'userController.js' });
    res.status(500).json({ message: 'Failed to fetch users' });
  }
}

async function getUser(req, res) {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.Int, req.params.id)
      .query(`
        SELECT u.UserId, u.Username, u.Email, u.FullName, u.Status, u.Theme,
               r.RoleId, r.RoleName
        FROM dbo.Users u JOIN dbo.Roles r ON r.RoleId = u.RoleId
        WHERE u.UserId = @id
      `);
    if (!result.recordset[0]) return res.status(404).json({ message: 'User not found' });
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch user' });
  }
}

async function createUser(req, res) {
  try {
    const { username, email, fullName, password, roleId, status } = req.body;
    const errors = {};
    validateRequired(username, 'Username', errors, 'username');
    validateRequired(password, 'Password', errors, 'password');
    validateRequired(roleId, 'Role', errors, 'roleId');
    validateEmail(email, 'Email', errors, 'email', false);
    if (password && String(password).length < 6) errors.password = 'Password must be at least 6 characters';
    if (hasErrors(errors)) return sendValidationError(res, errors);

    const pool = await getPool();

    const dup = await pool.request().input('username', sql.NVarChar, username)
      .query(`SELECT UserId FROM dbo.Users WHERE Username = @username`);
    if (dup.recordset.length > 0) return res.status(409).json({ message: 'Username already exists' });

    const roleCheck = await pool.request().input('roleId', sql.Int, roleId)
      .query(`SELECT RoleId FROM dbo.Roles WHERE RoleId = @roleId`);
    if (roleCheck.recordset.length === 0) return res.status(400).json({ message: 'Invalid roleId' });

    const hash = await bcrypt.hash(password, 10);

    const result = await pool.request()
      .input('username', sql.NVarChar, username)
      .input('email', sql.NVarChar, email || null)
      .input('fullName', sql.NVarChar, fullName || null)
      .input('passwordHash', sql.NVarChar, hash)
      .input('roleId', sql.Int, roleId)
      .input('status', sql.NVarChar, status || 'active')
      .query(`
        INSERT INTO dbo.Users (Username, Email, FullName, PasswordHash, RoleId, Status)
        OUTPUT INSERTED.UserId
        VALUES (@username, @email, @fullName, @passwordHash, @roleId, @status)
      `);

    logger.audit(req.user?.userId, 'user.create', { newUserId: result.recordset[0].UserId, username }, req);
    res.status(201).json({ userId: result.recordset[0].UserId, message: 'User created successfully' });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'userController.js' });
    res.status(500).json({ message: 'Failed to create user', error: err.message });
  }
}

async function updateUser(req, res) {
  try {
    const { email, fullName, roleId, status, theme, password } = req.body;
    const errors = {};
    validateRequired(roleId, 'Role', errors, 'roleId');
    validateEmail(email, 'Email', errors, 'email', false);
    if (password && String(password).length < 6) errors.password = 'Password must be at least 6 characters';
    if (hasErrors(errors)) return sendValidationError(res, errors);
    const pool = await getPool();

    const roleCheck = await pool.request().input('roleId', sql.Int, roleId)
      .query(`SELECT RoleId FROM dbo.Roles WHERE RoleId = @roleId`);
    if (roleCheck.recordset.length === 0) return res.status(400).json({ message: 'Invalid roleId' });

    let passwordClause = '';
    const request = pool.request().input('id', sql.Int, req.params.id);

    if (password) {
      const hash = await bcrypt.hash(password, 10);
      request.input('passwordHash', sql.NVarChar, hash);
      passwordClause = ', PasswordHash = @passwordHash';
    }

    request
      .input('email', sql.NVarChar, email || null)
      .input('fullName', sql.NVarChar, fullName || null)
      .input('roleId', sql.Int, roleId)
      .input('status', sql.NVarChar, status || 'active')
      .input('theme', sql.NVarChar, theme || 'light');

    await request.query(`
      UPDATE dbo.Users
      SET Email = @email, FullName = @fullName, RoleId = @roleId,
          Status = @status, Theme = @theme, UpdatedAt = SYSUTCDATETIME()
          ${passwordClause}
      WHERE UserId = @id
    `);

    logger.audit(req.user?.userId, 'user.update', { targetUserId: req.params.id }, req);
    res.json({ message: 'User updated successfully' });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'userController.js' });
    res.status(500).json({ message: 'Failed to update user', error: err.message });
  }
}

async function deleteUser(req, res) {
  try {
    const pool = await getPool();
    const check = await pool.request().input('id', sql.Int, req.params.id)
      .query(`
        SELECT r.RoleName FROM dbo.Users u JOIN dbo.Roles r ON r.RoleId = u.RoleId
        WHERE u.UserId = @id
      `);
    if (check.recordset[0]?.RoleName === 'SuperAdmin') {
      return res.status(403).json({ message: 'SuperAdmin user cannot be deleted' });
    }
    await pool.request().input('id', sql.Int, req.params.id)
      .query(`DELETE FROM dbo.Users WHERE UserId = @id`);
    logger.audit(req.user?.userId, 'user.delete', { targetUserId: req.params.id }, req);
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete user', error: err.message });
  }
}

module.exports = { listUsers, listAssignableUsers, getUser, createUser, updateUser, deleteUser };
