// ===== Vertox CRM - shared layout (sidebar + topbar) =====

// Groups the (currently 27+) dynamic modules into collapsible sidebar
// categories instead of one long flat list. A module not listed in any
// group below just falls into "Other". Add new ModuleKeys here as new
// modules get created (e.g. the Phase-1 beneficiary/household set).
const MODULE_CATEGORY_MAP = {
  'Fundraising': ['donors', 'donations', 'pledges', 'campaigns', 'sponsorships'],
  'Beneficiary Management': ['beneficiaries', 'households', 'beneficiary_cases', 'case_followups', 'case_assistance', 'referrals'],
  'Programs & Grants': ['projects', 'grants'],
  'People & Volunteers': ['volunteers', 'staff', 'payroll', 'training'],
  'Engagement': ['events', 'complaints', 'surveys', 'meetings'],
  'Operations': ['inventory', 'fleet', 'vendors', 'branches', 'partners', 'governance', 'compliance'],
  'Sales': ['contacts', 'leads', 'deals'],
};

function renderLayout(activeKey, pageTitle, pageSub) {
  const user = Store.user || {};
  const perms = user.permissions || [];
  const isSuper = user.role === 'SuperAdmin';
  const can = (p) => isSuper || perms.includes(p);

  const navHtml = `
    <div class="nav-label">Main</div>
    <a class="nav-item ${activeKey==='dashboard'?'active':''}" href="dashboard"><span class="ic">${icon('square')}</span> Dashboard</a>

    <div class="nav-label">CRM Modules</div>
    <div id="dynamicModuleNav"></div>

    <div class="nav-label">Operations</div>
    ${can('shifts.view') ? `<a class="nav-item ${activeKey==='shifts'?'active':''}" href="shifts"><span class="ic">${icon('calendar')}</span> Volunteer Shifts</a>` : ''}
    ${can('milestones.view') ? `<a class="nav-item ${activeKey==='milestones'?'active':''}" href="milestones"><span class="ic">${icon('target')}</span> Grant Milestones</a>` : ''}
    ${can('reminders.view') ? `<a class="nav-item ${activeKey==='reminders'?'active':''}" href="reminders"><span class="ic">${icon('bell')}</span> Recurring Donations</a>` : ''}

    <div class="nav-label">Insights</div>
    <a class="nav-item ${activeKey==='reports'?'active':''}" href="reports"><span class="ic">${icon('chart')}</span> Reports</a>
    <a class="nav-item ${activeKey==='kpi-dashboard'?'active':''}" href="kpi-dashboard"><span class="ic">${icon('trend')}</span> Donor &amp; Grant KPIs</a>
    ${can('ledger.view') ? `<a class="nav-item ${activeKey==='ledger'?'active':''}" href="ledger"><span class="ic">${icon('wallet')}</span> Financial Ledger</a>` : ''}

    <div class="nav-label">Administration</div>
    ${can('users.view') ? `<a class="nav-item ${activeKey==='users'?'active':''}" href="users"><span class="ic">${icon('user')}</span> Users</a>` : ''}
    <a class="nav-item ${activeKey==='roles'?'active':''}" href="roles"><span class="ic">${icon('key')}</span> Roles &amp; Permissions</a>
    ${can('modules.manage') ? `<a class="nav-item ${activeKey==='modules'?'active':''}" href="modules"><span class="ic">${icon('gear')}</span> Modules &amp; Fields</a>` : ''}
    ${can('audit.view') ? `<a class="nav-item ${activeKey==='audit'?'active':''}" href="audit-logs"><span class="ic">${icon('scroll')}</span> Audit Trail</a>` : ''}
    ${can('settings.manage') ? `<a class="nav-item ${activeKey==='settings'?'active':''}" href="settings"><span class="ic">${icon('home')}</span> Settings</a>` : ''}
  `;

  document.body.insertAdjacentHTML('afterbegin', `
    <div class="app">
      <aside class="sidebar" id="sidebar">
        <div class="brand">
          <div class="brand-mark">V</div>
          <div>
            <div class="brand-name" id="siteNameLabel">Vertox CRM</div>
            <div class="brand-sub">Management Suite</div>
          </div>
        </div>
        <nav class="nav-scroll">${navHtml}</nav>
        <div class="user-mini">
          <div class="avatar">${initials(user.fullName || user.username)}</div>
          <div style="flex:1">
            <div class="name">${user.fullName || user.username || 'User'}</div>
            <div class="role">${user.role || ''}</div>
          </div>
          <button class="btn-icon" title="Logout" onclick="logoutUser()">${icon('logout')}</button>
        </div>
        <footer class="app-footer"><span class="app-footer-brand">Powered by <strong>GenZe Automation</strong></span></footer>
      </aside>
      <div class="main">
        <div class="topbar">
          <div>
            <div class="page-title">${pageTitle}</div>
            <div class="page-sub">${pageSub || ''}</div>
          </div>
          <div class="topbar-tools">
            <div class="gs-wrap">
              <span class="gs-icon">${icon('search', 16)}</span>
              <input class="gs-input" id="globalSearchInput" placeholder="Search everything..." autocomplete="off"
                oninput="onGlobalSearchInput()" onfocus="if(this.value.trim().length>=2) onGlobalSearchInput()">
              <div class="gs-dropdown hidden" id="globalSearchDropdown"></div>
            </div>
            <div class="bell-wrap">
              <button class="btn-icon" id="bellBtn" onclick="toggleBellDropdown()" style="position:relative;">
                ${icon('bell')}<span class="bell-dot hidden" id="bellDotCount">0</span>
              </button>
              <div class="bell-dropdown hidden" id="bellDropdown"></div>
            </div>
            <button class="btn-icon" onclick="document.getElementById('sidebar').classList.toggle('open')" style="display:none" id="mobileToggle">${icon('menu')}</button>
          </div>
        </div>
        <div class="content" id="pageContent"></div>
      </div>
    </div>
  `);

  loadModuleNav(activeKey);
  applySiteSettings();
  initNotificationBell();
  initGlobalClickCloser();
}

// ===== Notifications bell =====
// Polls unread count every 30s so the badge stays roughly current without
// needing a websocket. The full list is only fetched when the bell is
// actually opened, to keep the periodic poll cheap.
let bellPollTimer = null;

function initNotificationBell() {
  refreshUnreadCount();
  if (bellPollTimer) clearInterval(bellPollTimer);
  bellPollTimer = setInterval(refreshUnreadCount, 30000);
}

async function refreshUnreadCount() {
  try {
    const { count } = await api('/notifications/unread-count');
    const dot = document.getElementById('bellDotCount');
    if (!dot) return;
    if (count > 0) { dot.textContent = count > 99 ? '99+' : count; dot.classList.remove('hidden'); }
    else dot.classList.add('hidden');
  } catch (e) { /* silent */ }
}

function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  return Math.floor(hrs / 24) + 'd ago';
}

async function toggleBellDropdown() {
  const dd = document.getElementById('bellDropdown');
  const searchDd = document.getElementById('globalSearchDropdown');
  if (searchDd) searchDd.classList.add('hidden');
  if (!dd.classList.contains('hidden')) { dd.classList.add('hidden'); return; }

  dd.classList.remove('hidden');
  dd.innerHTML = '<div class="bell-empty">Loading...</div>';
  try {
    const items = await api('/notifications');
    if (!items.length) { dd.innerHTML = '<div class="bell-empty">No notifications yet</div>'; return; }
    dd.innerHTML = `
      <div class="bell-head"><strong>Notifications</strong><button onclick="markAllNotificationsRead()">Mark all read</button></div>
      ${items.map(n => `
        <div class="bell-item ${n.IsRead ? '' : 'unread'}" onclick="openNotification(${n.NotificationId}, '${esc(n.Link || '')}')">
          <div class="bell-item-title">${esc(n.Title)}</div>
          ${n.Message ? `<div class="bell-item-msg">${esc(n.Message)}</div>` : ''}
          <div class="bell-item-time">${timeAgo(n.CreatedAt)}</div>
        </div>
      `).join('')}
    `;
  } catch (e) {
    dd.innerHTML = '<div class="bell-empty">Failed to load notifications</div>';
  }
}

async function openNotification(id, link) {
  try { await api('/notifications/' + id + '/read', { method: 'PUT' }); } catch (e) { /* ignore */ }
  refreshUnreadCount();
  if (link) window.location.href = link;
}

async function markAllNotificationsRead() {
  try {
    await api('/notifications/read-all', { method: 'PUT' });
    toggleBellDropdown(); toggleBellDropdown(); // close then reopen to refresh list
    refreshUnreadCount();
  } catch (e) { toast(e.message || 'Failed to update', 'error'); }
}

// ===== Global search (topbar) =====
let gsDebounceTimer = null;

function onGlobalSearchInput() {
  const q = document.getElementById('globalSearchInput').value.trim();
  const dd = document.getElementById('globalSearchDropdown');
  clearTimeout(gsDebounceTimer);
  if (q.length < 2) { dd.classList.add('hidden'); return; }
  gsDebounceTimer = setTimeout(() => runGlobalSearch(q), 300);
}

async function runGlobalSearch(q) {
  const dd = document.getElementById('globalSearchDropdown');
  const bellDd = document.getElementById('bellDropdown');
  if (bellDd) bellDd.classList.add('hidden');
  dd.classList.remove('hidden');
  dd.innerHTML = '<div class="gs-empty">Searching...</div>';
  try {
    const results = await api('/search?q=' + encodeURIComponent(q));
    if (!results.length) { dd.innerHTML = '<div class="gs-empty">No matches found</div>'; return; }
    dd.innerHTML = results.map(r => `
      <div class="gs-item" onclick="window.location.href='records?module=${esc(r.moduleKey)}'">
        <div class="gs-item-title">${esc(r.title)}</div>
        <div class="gs-item-meta">${esc(r.moduleLabel)}${r.status ? ' · ' + esc(r.status) : ''}</div>
      </div>
    `).join('');
  } catch (e) {
    dd.innerHTML = '<div class="gs-empty">Search failed</div>';
  }
}

function initGlobalClickCloser() {
  document.addEventListener('click', (ev) => {
    const bellWrap = ev.target.closest('.bell-wrap');
    const gsWrap = ev.target.closest('.gs-wrap');
    if (!bellWrap) { const dd = document.getElementById('bellDropdown'); if (dd) dd.classList.add('hidden'); }
    if (!gsWrap) { const dd = document.getElementById('globalSearchDropdown'); if (dd) dd.classList.add('hidden'); }
  });
}

function toggleNavCategory(catId) {
  const el = document.getElementById(catId);
  if (!el) return;
  el.classList.toggle('open');
  try {
    const closed = JSON.parse(localStorage.getItem('navCatClosed') || '{}');
    closed[catId] = !el.classList.contains('open');
    localStorage.setItem('navCatClosed', JSON.stringify(closed));
  } catch (e) { /* ignore storage errors */ }
}

async function loadModuleNav(activeKey) {
  try {
    const modules = await api('/modules');
    const nav = document.getElementById('dynamicModuleNav');
    if (!nav) return;

    // Group modules by category, preserving MODULE_CATEGORY_MAP's order;
    // anything not listed there lands in "Other" at the end.
    const byKey = Object.fromEntries(modules.map(m => [m.ModuleKey, m]));
    const used = new Set();
    const groups = [];
    Object.entries(MODULE_CATEGORY_MAP).forEach(([catName, keys]) => {
      const mods = keys.map(k => byKey[k]).filter(Boolean);
      mods.forEach(m => used.add(m.ModuleKey));
      if (mods.length) groups.push([catName, mods]);
    });
    const rest = modules.filter(m => !used.has(m.ModuleKey));
    if (rest.length) groups.push(['Other', rest]);

    let closed = {};
    try { closed = JSON.parse(localStorage.getItem('navCatClosed') || '{}'); } catch (e) { /* ignore */ }

    nav.innerHTML = groups.map(([catName, mods], i) => {
      const catId = 'navcat_' + catName.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
      const hasActive = mods.some(m => activeKey === 'module-' + m.ModuleKey);
      // Default: first two categories open, rest collapsed — keeps the
      // sidebar short on first login while keeping common stuff visible.
      // A saved localStorage preference (or the category containing the
      // active page) always wins over that default.
      const isOpen = hasActive || (closed[catId] === undefined ? i < 2 : !closed[catId]);
      return `
        <div class="nav-cat ${isOpen ? 'open' : ''}" id="${catId}">
          <div class="nav-cat-head" onclick="toggleNavCategory('${catId}')">
            <span class="cat-label">${esc(catName)}</span>
            <span class="cat-count">${mods.length}</span>
            <span class="chev">${icon('chevron', 14)}</span>
          </div>
          <div class="nav-cat-body">
            ${mods.map(m => `
              <a class="nav-item ${activeKey==='module-'+m.ModuleKey?'active':''}" href="records?module=${m.ModuleKey}">
                <span class="ic">${icon(m.Icon || 'dot')}</span> ${esc(m.Label)}
              </a>
            `).join('')}
          </div>
        </div>
      `;
    }).join('');
  } catch (e) { /* silent */ }
}

async function applySiteSettings() {
  try {
    const settings = await api('/settings');
    const nameEl = document.getElementById('siteNameLabel');
    if (nameEl && settings.site_name) {
      nameEl.textContent = settings.site_name;
      document.title = document.title.replace(/Vertox CRM/, settings.site_name);
    }
    if (settings.theme_color === 'white') {
      document.body.classList.add('theme-white');
    }
    SiteSettings.currency_code = settings.currency_code || 'USD';
    SiteSettings.currency_locale = settings.currency_locale || 'en-US';
    document.dispatchEvent(new CustomEvent('siteSettingsReady'));
  } catch (e) { /* silent - fall back to defaults */ }
}
