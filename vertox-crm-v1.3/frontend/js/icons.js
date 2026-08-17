// ===== Vertox CRM - shared line-icon set (replaces emoji everywhere) =====
// Single-color stroke icons, 20x20 viewBox, inherit currentColor so they
// pick up whatever color the surrounding .stat-icon / .ic wrapper sets.
const ICONS = {
  users:      '<path d="M7 9a2.6 2.6 0 1 0 0-5.2A2.6 2.6 0 0 0 7 9Zm7 0a2.6 2.6 0 1 0 0-5.2A2.6 2.6 0 0 0 14 9Zm-7 2c-2.5 0-5 1.2-5 3.4V16h8v-1.6c0-.9.3-1.7.9-2.4A6.9 6.9 0 0 0 7 11Zm7 0c-.7 0-1.4.1-2 .4.8.9 1.2 1.9 1.2 3v1.6h6.8v-1.6c0-2.2-2.5-3.4-6-3.4Z"/>',
  user:       '<path d="M10 10a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 10 10Zm0 2c-3.3 0-7 1.6-7 4.5V17h14v-.5c0-2.9-3.7-4.5-7-4.5Z"/>',
  file:       '<path d="M6 2.5h5.5L16 7v10.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1Zm5 0V7h4.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
  target:     '<circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="10" cy="10" r="3.8" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="10" cy="10" r="1"/>',
  briefcase:  '<rect x="3" y="7" width="14" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7.5 7V5.5a1.5 1.5 0 0 1 1.5-1.5h2a1.5 1.5 0 0 1 1.5 1.5V7" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3 11.5h14" stroke="currentColor" stroke-width="1.5"/>',
  heart:      '<path d="M10 17S2.8 12.6 2.8 7.6a4 4 0 0 1 7.2-2.4A4 4 0 0 1 17.2 7.6C17.2 12.6 10 17 10 17Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  gift:       '<rect x="3" y="8.5" width="14" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3 8.5h14v3H3z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 8.5V17M10 8.5C8.5 8.5 6.5 7.7 6.5 5.8A2 2 0 0 1 10 4.4M10 8.5c1.5 0 3.5-.8 3.5-2.7A2 2 0 0 0 10 4.4" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  hand:       '<path d="M6 11V5a1.3 1.3 0 0 1 2.6 0v4.5M8.6 9V4a1.3 1.3 0 0 1 2.6 0v5M11.2 9V4.6a1.3 1.3 0 0 1 2.6 0V10M13.8 8.2a1.3 1.3 0 0 1 2.6 0V12c0 3-2.2 5-5 5H10c-2 0-3-.7-4-2l-2.2-3.4c-.5-.8.4-1.7 1.2-1.1L6 11.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
  folder:     '<path d="M3 5.5A1.5 1.5 0 0 1 4.5 4H8l1.5 2H15.5A1.5 1.5 0 0 1 17 7.5v7A1.5 1.5 0 0 1 15.5 16h-11A1.5 1.5 0 0 1 3 14.5v-9Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  calendar:   '<rect x="3" y="4.5" width="14" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3 8h14M6.5 3v3M13.5 3v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  award:      '<circle cx="10" cy="7.5" r="4.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7.3 11 6 17l4-2 4 2-1.3-6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  clipboard:  '<rect x="4.5" y="4" width="11" height="13" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="7.5" y="2.5" width="5" height="3" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7 9.5h6M7 12.5h6M7 15.5h3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  wallet:     '<rect x="2.5" y="5.5" width="15" height="10" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M2.5 8.5h15" stroke="currentColor" stroke-width="1.5"/><circle cx="13.7" cy="12" r="1.1"/>',
  box:        '<path d="M3 6.5 10 3l7 3.5-7 3.5-7-3.5Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M3 6.5v7L10 17l7-3.5v-7M10 10v7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  handshake:  '<path d="M2.5 9.5 6 6l3 2 2-1.5 3.2 3M2.5 9.5l3 3.2a1.5 1.5 0 0 0 2.2-.1M12.2 9.5l1.6 1.7a1.4 1.4 0 0 1-2 2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/><path d="M14 6.5 17.5 9l-3.6 4-2-1.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
  alert:      '<path d="M10 3 18 16H2L10 3Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 8.3v3.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="10" cy="13.6" r="1"/>',
  book:       '<path d="M4 4.5c0-.8.7-1.3 1.5-1.2C7 3.5 8.7 4 10 5c1.3-1 3-1.5 4.5-1.7.8-.1 1.5.4 1.5 1.2v9.7c0 .7-.6 1.1-1.3 1.2-1.7.2-3.7.8-4.7 1.6-1-.8-3-1.4-4.7-1.6-.7-.1-1.3-.5-1.3-1.2V4.5Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M10 5v9.7" stroke="currentColor" stroke-width="1.3"/>',
  megaphone:  '<path d="M3 8v4l3 .7v2.3a1 1 0 0 0 1.7.7L9.5 14 15 16V4L9.5 6 3 8Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M15 7v6" stroke="currentColor" stroke-width="1.4"/>',
  landmark:   '<path d="M3 8h14M4 8v7M8 8v7M12 8v7M16 8v7M2.5 17h15M10 2.5 17 6H3l7-3.5Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
  key:        '<circle cx="7" cy="13" r="3.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M9.3 10.7 16 4M13.4 7.6 15.4 9.6M15.6 5.4l1.8 1.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  gear:       '<circle cx="10" cy="10" r="2.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 2.8v2M10 15.2v2M17.2 10h-2M4.8 10h-2M15 5l-1.4 1.4M6.4 13.6 5 15M15 15l-1.4-1.4M6.4 6.4 5 5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  home:       '<path d="M3 9.5 10 3l7 6.5M5 8.5V17h10V8.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 17v-4.5h4V17" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  chart:      '<path d="M3 17V3M3 17h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M6 14v-4M9.5 14V7M13 14v-6.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  bell:       '<path d="M6 8.2a4 4 0 0 1 8 0c0 3.2 1.2 4.3 1.2 4.3H4.8S6 11.4 6 8.2Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8.3 15.3a1.8 1.8 0 0 0 3.4 0" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  scroll:     '<path d="M5.5 3.5h9v11a2 2 0 0 1-2 2H7.5a2 2 0 0 1-2-2v-11Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M7.5 7.5h5M7.5 10.5h5M7.5 13.5h3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  check:      '<path d="M4 10.5 8 14.5 16 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  clock:      '<circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 6v4.3l3 1.7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  square:     '<rect x="4" y="4" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  dot:        '<circle cx="10" cy="10" r="3" fill="currentColor"/>',
  logout:     '<path d="M8 17H4.5A1.5 1.5 0 0 1 3 15.5v-11A1.5 1.5 0 0 1 4.5 3H8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M12.5 13.5 17 10l-4.5-3.5M17 10H8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  menu:       '<path d="M3 5.5h14M3 10h14M3 14.5h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  chevron:    '<path d="M7 4.5 13 10l-6 5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  search:     '<circle cx="8.7" cy="8.7" r="5.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m16 16-3.6-3.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  trend:      '<path d="M3 14l5-5 3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 5h4v4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
};

// Returns an inline <svg> string, sized to fill its wrapper via CSS.
function icon(name, size) {
  const body = ICONS[name] || ICONS.dot;
  const s = size || 18;
  return `<svg width="${s}" height="${s}" viewBox="0 0 20 20" fill="currentColor">${body}</svg>`;
}
