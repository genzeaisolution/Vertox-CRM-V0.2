// ===== Vertox CRM - self-signed HTTPS certificate =====
// Generates (once) a self-signed cert covering localhost + the server's
// LAN IP(s) + any hostnames listed in CERT_DOMAINS, and caches it on disk
// so it's reused on every restart instead of regenerating.
//
// IMPORTANT — what "self-signed" means in practice:
// Browsers will show a "Not secure" / certificate-warning page the FIRST
// time each device visits, because this cert isn't signed by a public
// Certificate Authority the browser already trusts (Let's Encrypt certs
// only exist for a real public domain name, which an internal LAN IP/name
// can never have). Two ways to remove that warning, see README:
//   1) Install certs/ca.crt as a trusted root cert on each device (one-time,
//      per device) — after that this exact cert shows a clean padlock.
//   2) Get a real public domain and point it at this server, and re-run
//      with Caddy/nginx + Let's Encrypt instead of this self-signed cert.
const fs = require('fs');
const path = require('path');
const os = require('os');
const selfsigned = require('selfsigned');
const logger = require('./logger');

const CERT_DIR = path.join(__dirname, '..', 'certs');
const KEY_PATH = path.join(CERT_DIR, 'server.key');
const CERT_PATH = path.join(CERT_DIR, 'server.crt');

function localIPs() {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}

// Checks whether an existing cert's Subject Alternative Names already cover
// every IP this machine currently has. If the machine's IP changed since the
// cert was generated (new WiFi, DHCP renewal, different network, etc.), this
// returns false so we know to regenerate instead of silently serving a cert
// that no longer matches — which is what causes "IP keeps needing to be
// reset" / browser connection errors after a network change.
function certCoversCurrentIPs(certPem, currentIPs) {
  try {
    const { X509Certificate } = require('crypto');
    const cert = new X509Certificate(certPem);
    const san = cert.subjectAltName || '';
    return currentIPs.every(ip => san.includes(`IP Address:${ip}`));
  } catch (err) {
    // If we can't parse it for any reason, be safe and regenerate.
    logger.warn && logger.warn('HTTPS', 'Could not verify existing certificate coverage, regenerating', { error: err.message });
    return false;
  }
}

function writeCert(ips, extraDomains) {
  const altNames = [
    { type: 2, value: 'localhost' },                         // DNS
    ...extraDomains.map(d => ({ type: 2, value: d })),        // DNS
    { type: 7, ip: '127.0.0.1' },                             // IP
    ...ips.map(ip => ({ type: 7, ip }))                       // IP
  ];

  const pems = selfsigned.generate(
    [{ name: 'commonName', value: extraDomains[0] || ips[0] || 'localhost' }],
    { days: 3650, keySize: 2048, extensions: [{ name: 'subjectAltName', altNames }] }
  );

  if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true });
  fs.writeFileSync(KEY_PATH, pems.private);
  fs.writeFileSync(CERT_PATH, pems.cert);
  logger.info('HTTPS', 'Self-signed certificate generated and saved to backend/certs/', {
    validFor: [...ips, 'localhost', ...extraDomains]
  });

  return { key: pems.private, cert: pems.cert };
}

function getOrCreateCert() {
  const extraDomains = (process.env.CERT_DOMAINS || '').split(',').map(d => d.trim()).filter(Boolean);
  const ips = localIPs();

  if (fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH)) {
    const existingCert = fs.readFileSync(CERT_PATH);
    if (certCoversCurrentIPs(existingCert, ips)) {
      logger.info('HTTPS', 'Using existing self-signed certificate from backend/certs/');
      return { key: fs.readFileSync(KEY_PATH), cert: existingCert };
    }
    logger.info('HTTPS', 'Machine IP changed since certificate was generated — regenerating', { ips });
    return writeCert(ips, extraDomains);
  }

  logger.info('HTTPS', 'No certificate found — generating a self-signed one', { ips, extraDomains });
  return writeCert(ips, extraDomains);
}

module.exports = { getOrCreateCert, localIPs, CERT_DIR };
