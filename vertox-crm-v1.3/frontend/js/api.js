// ===== Vertox CRM - API client =====
// Frontend is now served by the SAME server as the API (see backend/server.js),
// so a plain relative path always works — same host, same port, same origin.
// This is what was breaking mobile/IP/tunnel access: it used to be hardcoded
// to 'http://localhost:6060/api', which only ever meant "the phone itself".
const API_BASE = '/api';

const Store = {
  get accessToken(){ return localStorage.getItem('vx_access'); },
  set accessToken(v){ v ? localStorage.setItem('vx_access', v) : localStorage.removeItem('vx_access'); },
  get refreshToken(){ return localStorage.getItem('vx_refresh'); },
  set refreshToken(v){ v ? localStorage.setItem('vx_refresh', v) : localStorage.removeItem('vx_refresh'); },
  get user(){ try{ return JSON.parse(localStorage.getItem('vx_user')); }catch(e){ return null; } },
  set user(v){ v ? localStorage.setItem('vx_user', JSON.stringify(v)) : localStorage.removeItem('vx_user'); },
  clear(){ localStorage.removeItem('vx_access'); localStorage.removeItem('vx_refresh'); localStorage.removeItem('vx_user'); }
};

async function api(path, { method = 'GET', body, auth = true, retry = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && Store.accessToken) headers['Authorization'] = 'Bearer ' + Store.accessToken;

  const res = await fetch(API_BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  if (res.status === 401 && auth && retry && Store.refreshToken) {
    const ok = await tryRefresh();
    if (ok) return api(path, { method, body, auth, retry: false });
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || 'Request failed');
    if (data.errors) err.errors = data.errors;
    err.status = res.status;
    throw err;
  }
  return data;
}

async function tryRefresh() {
  try {
    const res = await fetch(API_BASE + '/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: Store.refreshToken })
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    Store.accessToken = data.accessToken;
    return true;
  } catch (e) {
    Store.clear();
    window.location.href = 'login';
    return false;
  }
}

function requireAuthPage() {
  if (!Store.accessToken) window.location.href = 'login';
}

function logoutUser() {
  api('/auth/logout', { method: 'POST', body: { refreshToken: Store.refreshToken }, auth: false }).catch(() => {});
  Store.clear();
  window.location.href = 'login';
}

function toast(message, type = 'info') {
  let wrap = document.querySelector('.toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = message;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ===== Shared field-level form error handling =====
// Used by every page with a modal form (users, roles, modules, settings,
// shifts, milestones, reminders, records) so a 422 validation response
// highlights the actual input that failed instead of just a vague toast
// the person can't act on. fieldMap maps server error keys (e.g. 'roleId')
// to the DOM id of the matching input (e.g. 'f_role').
function showFieldErrors(modalOverlayId, fieldMap, e) {
  const scope = document.getElementById(modalOverlayId) || document;
  scope.querySelectorAll('.field-error').forEach(el => el.remove());
  scope.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));
  const errors = (e && e.errors) || {};
  let matched = false;
  Object.entries(errors).forEach(([key, msg]) => {
    const elId = fieldMap[key];
    const el = elId ? document.getElementById(elId) : null;
    if (el) {
      matched = true;
      el.classList.add('input-error');
      const hint = document.createElement('div');
      hint.className = 'field-error';
      hint.textContent = msg;
      el.insertAdjacentElement('afterend', hint);
    }
  });
  toast(matched ? 'Please fix the highlighted fields' : ((e && e.message) || 'Something went wrong'), 'error');
}

function clearFieldErrors(modalOverlayId) {
  const scope = document.getElementById(modalOverlayId) || document;
  scope.querySelectorAll('.field-error').forEach(el => el.remove());
  scope.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));
}

function esc(str) {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function initials(name) {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

// ===== Global error boundary =====
// Without this, a thrown error outside an explicit try/catch (a bad property
// access, a rejected promise nobody awaited) fails silently in the console
// and the page just looks frozen/blank to the user — this surfaces it as a
// toast instead so there's always visible feedback that something broke.
window.addEventListener('error', (event) => {
  console.error('Unhandled error:', event.error || event.message);
  if (typeof toast === 'function') toast('Something went wrong. Please try again.', 'error');
});
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  if (typeof toast === 'function') toast((event.reason && event.reason.message) || 'Something went wrong. Please try again.', 'error');
});

// ===== Prevent double-submit on async button actions =====
// Wrap an async handler with this so a fast double-click (or a slow network
// response) can't fire the same create/update/delete request twice.
function withBusy(button, fn) {
  return async (...args) => {
    if (!button || button.disabled) return;
    const originalText = button.textContent;
    button.disabled = true;
    try {
      await fn(...args);
    } finally {
      button.disabled = false;
      if (originalText !== undefined) button.textContent = originalText;
    }
  };
}

// ===== Multi-currency helpers =====
// SiteSettings is populated once by layout.js (applySiteSettings) right
// after login, from the real /settings row in the database — every page
// that formats a currency field reads from here instead of hard-coding a
// symbol, so a currency change in Settings instantly applies everywhere.
const SiteSettings = { currency_code: 'USD', currency_locale: 'en-US' };

function formatCurrency(value) {
  if (value === undefined || value === null || value === '') return '—';
  const num = Number(value);
  if (isNaN(num)) return esc(value);
  try {
    return new Intl.NumberFormat(SiteSettings.currency_locale || 'en-US', {
      style: 'currency',
      currency: SiteSettings.currency_code || 'USD',
      maximumFractionDigits: 2
    }).format(num);
  } catch (e) {
    return num.toFixed(2) + ' ' + (SiteSettings.currency_code || '');
  }
}
