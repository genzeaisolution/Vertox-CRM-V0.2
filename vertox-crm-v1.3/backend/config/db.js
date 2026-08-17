const sql = require('mssql');
const logger = require('../utils/logger');
require('dotenv').config();

function buildConfig() {
  const server = process.env.DB_SERVER && process.env.DB_SERVER.trim() ? process.env.DB_SERVER.trim() : 'localhost';
  const database = process.env.DB_NAME && process.env.DB_NAME.trim() ? process.env.DB_NAME.trim() : 'VertoxCRM';
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const port = parseInt(process.env.DB_PORT || '1433', 10);

  const missing = [];
  if (!user) missing.push('DB_USER');
  if (!password) missing.push('DB_PASSWORD');

  if (missing.length) {
    logger.error('DB_CONFIG', `Missing required .env values: ${missing.join(', ')}. Did you copy .env.example to .env and fill it in?`);
  }

  logger.db('Building MSSQL config', { server, database, port, user: user ? '(set)' : '(MISSING)' });

  return {
    user,
    password,
    server,
    database,
    port,
    options: {
      encrypt: process.env.DB_ENCRYPT === 'true',
      trustServerCertificate: process.env.DB_TRUST_CERT !== 'false'
    },
    // Pool size: raised from the previous default of 10. A single Node
    // process can still only usefully hold a few dozen live DB connections
    // (SQL Server, not concurrent HTTP users, is the real limit here) — the
    // fix for thousands of concurrent *users* is pagination + indexes +
    // running multiple app instances behind a load balancer, not an
    // unbounded pool. Configurable via .env so it can be tuned per box.
    pool: {
      max: parseInt(process.env.DB_POOL_MAX || '50', 10),
      min: parseInt(process.env.DB_POOL_MIN || '5', 10),
      idleTimeoutMillis: 30000
    }
  };
}

let poolPromise;

function getPool() {
  if (!poolPromise) {
    const config = buildConfig();

    if (!config.user || !config.password) {
      const err = new Error(
        'Database is not configured. Open backend/.env and set DB_USER, DB_PASSWORD, DB_SERVER, DB_NAME correctly, then restart the server.'
      );
      logger.dbError('Refusing to connect: incomplete config', { hasUser: !!config.user, hasPassword: !!config.password });
      return Promise.reject(err);
    }

    logger.db('Attempting MSSQL connection...', { server: config.server, database: config.database, port: config.port });

    poolPromise = new sql.ConnectionPool(config)
      .connect()
      .then(pool => {
        logger.db('MSSQL connection established successfully', { database: config.database });
        pool.on('error', (err) => {
          logger.dbError('Pool runtime error', { message: err.message, stack: err.stack });
        });
        return pool;
      })
      .catch(err => {
        logger.dbError('MSSQL connection FAILED', {
          message: err.message,
          code: err.code,
          server: config.server,
          database: config.database,
          hint: 'Check: SQL Server is running, TCP/IP enabled, DB_SERVER/DB_PORT correct, SQL auth enabled, firewall allows port ' + config.port
        });
        poolPromise = null;
        throw err;
      });
  }
  return poolPromise;
}

module.exports = { sql, getPool };
