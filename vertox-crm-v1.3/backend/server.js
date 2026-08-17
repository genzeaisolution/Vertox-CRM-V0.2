const fs = require('fs');
const path = require('path');

// ---- Ensure .env exists BEFORE anything else loads it ----
const envPath = path.join(__dirname, '.env');
const envExamplePath = path.join(__dirname, '.env.example');
if (!fs.existsSync(envPath) && fs.existsSync(envExamplePath)) {
  fs.copyFileSync(envExamplePath, envPath);
  console.warn('[SETUP] .env was missing — auto-created from .env.example.');
  console.warn('[SETUP] IMPORTANT: open backend/.env and set your real DB_USER / DB_PASSWORD / DB_SERVER, then restart.');
}

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const logger = require('./utils/logger');

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const roleRoutes = require('./routes/roleRoutes');
const moduleRoutes = require('./routes/moduleRoutes');
const recordRoutes = require('./routes/recordRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const reportRoutes = require('./routes/reportRoutes');
const auditRoutes = require('./routes/auditRoutes');
const ledgerRoutes = require('./routes/ledgerRoutes');
const shiftRoutes = require('./routes/shiftRoutes');
const milestoneRoutes = require('./routes/milestoneRoutes');
const reminderRoutes = require('./routes/reminderRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const searchRoutes = require('./routes/searchRoutes');
const savedFilterRoutes = require('./routes/savedFilterRoutes');
const eventRoutes = require('./routes/eventRoutes');
const donationRoutes = require('./routes/donationRoutes');
const grantExpenseRoutes = require('./routes/grantExpenseRoutes');
const kpiRoutes = require('./routes/kpiRoutes');
const attachmentRoutes = require('./routes/attachmentRoutes');
const approvalRoutes = require('./routes/approvalRoutes');
const { startReminderScheduler } = require('./utils/reminderScheduler');

const app = express();

logger.info('BOOT', 'Starting Vertox CRM backend...', {
  node: process.version,
  env: process.env.NODE_ENV || 'development',
  cwd: __dirname
});

// ---- CORS: supports '*', a single origin, or a comma-separated list ----
// Every allow/deny decision is written to logs/cors.log so nothing is silent.
const rawOrigins = (process.env.CLIENT_ORIGIN || '*').trim();
const allowAll = rawOrigins === '*' || rawOrigins === '';
const allowedOrigins = allowAll ? [] : rawOrigins.split(',').map(o => o.trim()).filter(Boolean);

logger.info('CORS', `CORS configured: ${allowAll ? 'ALL origins allowed (*)' : allowedOrigins.join(', ')}`);

app.use(cors({
  origin: (origin, callback) => {
    // origin is undefined for same-origin/non-browser requests (curl, mobile apps, server-to-server)
    if (!origin || allowAll || allowedOrigins.includes(origin)) {
      logger.cors(`Allowed request from origin: ${origin || '(no origin header)'}`);
      return callback(null, true);
    }
    logger.corsBlocked(`Blocked request from origin: ${origin}`, {
      allowedOrigins: allowAll ? '*' : allowedOrigins,
      hint: 'Add this origin to CLIENT_ORIGIN in backend/.env (comma-separated) or set CLIENT_ORIGIN=* for local dev, then restart the server.'
    });
    return callback(new Error('Not allowed by CORS: ' + origin));
  },
  credentials: true
}));
// gzip/br every response over the wire — JSON dashboards and large CSV
// exports both shrink drastically, so the same connection carries more
// data per second and pages/exports feel fast even under heavy load.
// Exports stream row-by-row anyway, but compression still shrinks each
// chunk on its way to the client.
app.use(compression());
app.use(express.json({ limit: '5mb' }));

// ---- Request logging middleware: logs EVERY request, even 404s/favicon/static ----
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    logger.request(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`, {
      ip: req.ip,
      status: res.statusCode,
      durationMs: ms,
      body: req.method !== 'GET' ? sanitizeBody(req.body) : undefined
    });
  });
  next();
});

function sanitizeBody(body) {
  if (!body || typeof body !== 'object') return body;
  const clone = { ...body };
  if (clone.password) clone.password = '***';
  if (clone.passwordHash) clone.passwordHash = '***';
  if (clone.refreshToken) clone.refreshToken = '***';
  return clone;
}

app.get('/favicon.ico', (req, res) => res.status(204).end());

// Root URL -> login. Nobody should have to type a filename to get in.
app.get('/', (req, res) => res.redirect('/login'));

// ---- Force clean URLs (no ".html" in the address bar, ever) ----
// Typing/bookmarking /login.html (or any other page) now 301-redirects to
// the extensionless version (/login) and stays there. express.static below
// still resolves /login -> frontend/login.html on disk via 'extensions',
// the visitor just never sees ".html" in the URL.
app.get(/\.html$/, (req, res) => {
  const clean = req.path.replace(/\.html$/, '') || '/';
  res.redirect(301, clean === '/index' ? '/login' : clean + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''));
});

// ---- Serve the frontend from this SAME server/port ----
// This is what makes the app work over a phone/IP/tunnel with only ONE
// port exposed: no separate frontend server, no cross-origin call, no
// second port to forward.
const frontendPath = path.join(__dirname, '..', 'frontend');
if (fs.existsSync(frontendPath)) {
  // 'extensions' lets a clean URL like /dashboard resolve to dashboard.html —
  // without this, express.static only matches exact filenames and every
  // extensionless link (dashboard, records, modules...) 404s as "Route not
  // found". Combined with the redirect above, the actual .html file is an
  // implementation detail the visitor never has to type or see.
  app.use(express.static(frontendPath, {
    extensions: ['html'],
    // Cache static JS/CSS/fonts in the browser for a day so repeat visits
    // (and every teammate hitting the same LAN URL) don't re-download the
    // whole app shell on every page navigation — only page HTML itself
    // (which is small) is re-fetched fresh each time.
    maxAge: '1d',
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    }
  }));
  logger.info('BOOT', `Serving frontend statically from ${frontendPath}`);
}

app.get('/api/health', async (req, res) => {
  const { getPool } = require('./config/db');
  let dbStatus = 'not_checked';
  try {
    await getPool();
    dbStatus = 'connected';
  } catch (e) {
    dbStatus = 'error: ' + e.message;
  }
  res.json({ status: 'ok', name: 'Vertox CRM API', database: dbStatus, time: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/modules', moduleRoutes);
app.use('/api/records', recordRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/ledger', ledgerRoutes);
app.use('/api/shifts', shiftRoutes);
app.use('/api/milestones', milestoneRoutes);
app.use('/api/reminders', reminderRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/saved-filters', savedFilterRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/donations', donationRoutes);
app.use('/api/grants', grantExpenseRoutes);
app.use('/api/kpi', kpiRoutes);
app.use('/api/attachments', attachmentRoutes);
app.use('/api/approvals', approvalRoutes);

app.use((req, res) => {
  logger.warn('ROUTE', `404 Not Found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ message: 'Route not found' });
});

app.use((err, req, res, next) => {
  logger.error('EXPRESS', `Unhandled error on ${req.method} ${req.originalUrl}: ${err.message}`, { stack: err.stack });
  res.status(500).json({ message: 'Internal server error' });
});

const PORT = process.env.PORT || 3300;
const HTTPS_ENABLED = process.env.ENABLE_HTTPS === 'true';
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;

if (HTTPS_ENABLED) {
  const https = require('https');
  const http = require('http');
  const { getOrCreateCert, localIPs } = require('./utils/certGen');
  const { key, cert } = getOrCreateCert();

  https.createServer({ key, cert }, app).listen(HTTPS_PORT, '0.0.0.0', () => {
    const ips = localIPs();
    logger.info('BOOT', `Vertox CRM (HTTPS) running on port ${HTTPS_PORT}`);
    console.log(`\nVertox CRM secure (HTTPS) running:`);
    console.log(`  https://localhost:${HTTPS_PORT}`);
    ips.forEach(ip => console.log(`  https://${ip}:${HTTPS_PORT}  (LAN / phone)`));
    console.log(`\nFirst visit on each device will show a certificate warning —`);
    console.log(`this is a self-signed cert. See README "Custom Domain + HTTPS"`);
    console.log(`for how to install backend/certs/server.crt as trusted, or move`);
    console.log(`to a real public domain + Let's Encrypt for a clean padlock.\n`);
  });

  // Plain HTTP still listens (useful for LAN devices that haven't trusted the
  // cert yet) but every request is redirected straight to the HTTPS port
  // instead of serving the app insecurely once HTTPS is turned on.
  http.createServer((req, res) => {
    const host = (req.headers.host || 'localhost').split(':')[0];
    res.writeHead(301, { Location: `https://${host}:${HTTPS_PORT}${req.url}` });
    res.end();
  }).listen(PORT, '0.0.0.0', () => {
    logger.info('BOOT', `HTTP->HTTPS redirect listening on port ${PORT}`);
  });
} else {
  // '0.0.0.0' explicitly binds all network interfaces, not just loopback —
  // this is required for phones/other devices on the same WiFi/LAN, or a
  // tunnel service, to reach the server via the PC's IP address.
  app.listen(PORT, '0.0.0.0', () => {
    logger.info('BOOT', `Vertox CRM running on http://localhost:${PORT} (and on your LAN IP)`);
    console.log(`\nVertox CRM running on http://localhost:${PORT}`);
    console.log(`On your phone (same WiFi): http://<this-PC's-IP>:${PORT}/login`);
    console.log(`Logs folder: ${path.join(__dirname, 'logs')}`);
    console.log(`\nTip: set ENABLE_HTTPS=true in backend/.env for a secure https:// URL.\n`);
  });
}

{
  // Try connecting to DB immediately at boot so problems show up right away
  const { getPool } = require('./config/db');
  getPool()
    .then(() => logger.info('BOOT', 'Startup DB check: OK'))
    .catch(err => logger.error('BOOT', 'Startup DB check FAILED: ' + err.message,
      { hint: 'Server will keep running, but every DB-dependent request will fail until backend/.env is fixed and server restarted.' }));

  // Recurring-donation reminder engine: runs an immediate catch-up sweep,
  // then re-checks every 24h for the lifetime of this process. See
  // backend/utils/reminderScheduler.js for details.
  startReminderScheduler();
}
