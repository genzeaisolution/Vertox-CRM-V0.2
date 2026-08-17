const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');
const { validateRequired, hasErrors, sendValidationError } = require('../utils/validate');

async function listRoles(req, res) {
  try {
    const pool = await getPool();
    const roles = await pool.request().query(`SELECT * FROM dbo.Roles ORDER BY RoleId`);
    const perms = await pool.request().query(`
      SELECT rp.RoleId, p.PermKey FROM dbo.RolePermissions rp
      JOIN dbo.Permissions p ON p.PermissionId = rp.PermissionId
    `);
    const data = roles.recordset.map(r => ({
      ...r,
      permissions: perms.recordset.filter(p => p.RoleId === r.RoleId).map(p => p.PermKey)
    }));
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch roles' });
  }
}

async function listPermissions(req, res) {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`SELECT * FROM dbo.Permissions ORDER BY Module, Action`);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch permissions' });
  }
}

async function createRole(req, res) {
  try {
    const { roleName, description, permissionKeys = [] } = req.body;
    const errors = {};
    validateRequired(roleName, 'Role Name', errors, 'roleName');
    if (hasErrors(errors)) return sendValidationError(res, errors);

    const pool = await getPool();
    const result = await pool.request()
      .input('roleName', sql.NVarChar, roleName)
      .input('description', sql.NVarChar, description || null)
      .query(`
        INSERT INTO dbo.Roles (RoleName, Description, IsSystem)
        OUTPUT INSERTED.RoleId
        VALUES (@roleName, @description, 0)
      `);
    const roleId = result.recordset[0].RoleId;

    for (const key of permissionKeys) {
      await pool.request().input('roleId', sql.Int, roleId).input('permKey', sql.NVarChar, key)
        .query(`
          INSERT INTO dbo.RolePermissions (RoleId, PermissionId)
          SELECT @roleId, PermissionId FROM dbo.Permissions WHERE PermKey = @permKey
        `);
    }

    logger.audit(req.user?.userId, 'role.create', { roleId, roleName }, req);
    res.status(201).json({ roleId, message: 'Role created successfully' });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'roleController.js' });
    res.status(500).json({ message: 'Failed to create role', error: err.message });
  }
}

async function updateRole(req, res) {
  try {
    const { roleName, description, permissionKeys } = req.body;
    const pool = await getPool();

    const roleCheck = await pool.request().input('id', sql.Int, req.params.id)
      .query(`SELECT IsSystem, RoleName FROM dbo.Roles WHERE RoleId = @id`);
    if (!roleCheck.recordset[0]) return res.status(404).json({ message: 'Role not found' });

    if (roleCheck.recordset[0].IsSystem) {
      return res.status(403).json({ message: 'System role cannot be edited' });
    }

    await pool.request()
      .input('id', sql.Int, req.params.id)
      .input('roleName', sql.NVarChar, roleName)
      .input('description', sql.NVarChar, description || null)
      .query(`
        UPDATE dbo.Roles SET RoleName = @roleName, Description = @description, UpdatedAt = SYSUTCDATETIME()
        WHERE RoleId = @id AND IsSystem = 0
      `);

    if (Array.isArray(permissionKeys)) {
      await pool.request().input('id', sql.Int, req.params.id)
        .query(`DELETE FROM dbo.RolePermissions WHERE RoleId = @id`);
      for (const key of permissionKeys) {
        await pool.request().input('roleId', sql.Int, req.params.id).input('permKey', sql.NVarChar, key)
          .query(`
            INSERT INTO dbo.RolePermissions (RoleId, PermissionId)
            SELECT @roleId, PermissionId FROM dbo.Permissions WHERE PermKey = @permKey
          `);
      }
    }

    logger.audit(req.user?.userId, 'role.update', { roleId: req.params.id }, req);
    res.json({ message: 'Role updated successfully' });
  } catch (err) {
    logger.error('CONTROLLER', err.message, { stack: err.stack, file: 'roleController.js' });
    res.status(500).json({ message: 'Failed to update role', error: err.message });
  }
}

async function deleteRole(req, res) {
  try {
    const pool = await getPool();
    const check = await pool.request().input('id', sql.Int, req.params.id)
      .query(`SELECT IsSystem FROM dbo.Roles WHERE RoleId = @id`);
    if (!check.recordset[0]) return res.status(404).json({ message: 'Role not found' });
    if (check.recordset[0].IsSystem) return res.status(403).json({ message: 'System role cannot be deleted' });

    const inUse = await pool.request().input('id', sql.Int, req.params.id)
      .query(`SELECT COUNT(*) AS cnt FROM dbo.Users WHERE RoleId = @id`);
    if (inUse.recordset[0].cnt > 0) {
      return res.status(409).json({ message: 'Cannot delete role: users are currently assigned to it' });
    }

    await pool.request().input('id', sql.Int, req.params.id).query(`DELETE FROM dbo.Roles WHERE RoleId = @id`);
    logger.audit(req.user?.userId, 'role.delete', { roleId: req.params.id }, req);
    res.json({ message: 'Role deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete role', error: err.message });
  }
}

module.exports = { listRoles, listPermissions, createRole, updateRole, deleteRole };
