/** Inline SVG icon set (24px grid, stroke based). */
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
  library: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  shirt: '<path d="M8 3 3 6l2 5 3-1.5V21h8V9.5l3 1.5 2-5-5-3a4 4 0 0 1-8 0Z"/>',
  settings: '<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  play: '<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5Z" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  minus: '<path d="M5 12h14"/>',
  square: '<rect x="5" y="5" width="14" height="14" rx="1.5"/>',
  squares: '<rect x="8" y="3" width="13" height="13" rx="1.5"/><path d="M16 21H5a2 2 0 0 1-2-2V8"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 4a4 4 0 0 1 0 8"/><path d="M22 21a7 7 0 0 0-4-6.3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  chevronLeft: '<path d="m15 6-6 6 6 6"/>',
  chevronUpDown: '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
  refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M3 21v-5h5"/>',
  external: '<path d="M14 4h6v6"/><path d="M10 14 20 4"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3"/><path d="M13 15h4"/>',
  dots: '<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>',
  puzzle: '<path d="M14 4a2 2 0 1 0-4 0v2H6a1 1 0 0 0-1 1v4h2a2 2 0 1 1 0 4H5v4a1 1 0 0 0 1 1h4v-2a2 2 0 1 1 4 0v2h4a1 1 0 0 0 1-1v-4h-2a2 2 0 1 1 0-4h2V7a1 1 0 0 0-1-1h-4Z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
  sparkles: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8Z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z"/>',
  package: '<path d="M21 8 12 3 3 8v8l9 5 9-5Z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>',
  upload: '<path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M5 3h14"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  coffee: '<path d="M17 8h1a4 4 0 0 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><path d="M6 2v3M10 2v3M14 2v3"/>',
  palette: '<path d="M12 22a10 10 0 1 1 10-10c0 2.5-2 4-4.5 4H15a2 2 0 0 0-1.5 3.3A2 2 0 0 1 12 22Z"/><circle cx="7.5" cy="10.5" r="1.3" fill="currentColor"/><circle cx="12" cy="7" r="1.3" fill="currentColor"/><circle cx="16.5" cy="10.5" r="1.3" fill="currentColor"/>',
  gamepad: '<rect x="2" y="7" width="20" height="11" rx="5"/><path d="M7 11v3M5.5 12.5h3"/><circle cx="16" cy="11.5" r="1" fill="currentColor"/><circle cx="18" cy="13.5" r="1" fill="currentColor"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.3-9.3M17 6l3 3M14.5 8.5l2 2"/>',
  discord: '<path d="M19.6 5.6A16.6 16.6 0 0 0 15.4 4.3l-.5 1a15.3 15.3 0 0 0-5.8 0l-.5-1a16.6 16.6 0 0 0-4.2 1.3C1.7 9.6 1 13.5 1.3 17.3a16.8 16.8 0 0 0 5.1 2.6l1.1-1.7a10.8 10.8 0 0 1-1.7-.8l.4-.3a11.9 11.9 0 0 0 10.2 0l.4.3c-.6.3-1.1.6-1.7.8l1.1 1.7a16.8 16.8 0 0 0 5.1-2.6c.4-4.4-.7-8.3-2.7-11.7ZM8.5 15c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm7 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z" fill="currentColor" stroke="none"/>',
  hardDrive: '<path d="M22 12H2"/><path d="M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6Z"/><path d="M6 16h.01M10 16h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 0 0 0-7.8Z"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0 5 5L21 13l-8 8-3-3 6.3-6.3a4 4 0 0 1-5-5L13 5Z" /><path d="M3 21l6-6"/>',
  share: '<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/>',
  java: '<path d="M8 17s-2 1 1 1.5 7 .5 9-.5"/><path d="M7 20.5c2 1 9 1 11-.5"/><path d="M13 3c2 2-3 3.5-1 6"/><path d="M15 6c1.5 1.5-2 2.5-.5 4.5"/><path d="M6 13h11v1a4 4 0 0 1-4 4h-3a4 4 0 0 1-4-4Z"/><path d="M17 14h1a2 2 0 0 1 0 4h-1"/>',
  grid: '<path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18"/>',
  link: '<path d="M10 14a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 10a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  walk: '<circle cx="13" cy="4" r="2"/><path d="m9 21 3-7 3 3v4"/><path d="m6 12 3-4 4 1 3 3 3 1"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7Z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  rotate: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
};

/** Creates an SVG icon element. */
export function icon(name, cls = '') {
  const wrap = document.createElement('span');
  wrap.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class="${cls}">${P[name] || P.info}</svg>`;
  return wrap.firstChild;
}

/** The Obsidian app icon, in the variant that suits the current theme. */
export function logoSrc() {
  return document.documentElement.dataset.mode === 'light' ? '../../assets/logo-light.png' : '../../assets/logo.png';
}

export function logo(cls = '') {
  const img = document.createElement('img');
  img.src = logoSrc();
  img.dataset.logo = '1';
  img.alt = 'Obsidian';
  img.className = cls;
  img.draggable = false;
  return img;
}

/** Simple loader marks for Vanilla, Fabric and Forge. */
export function loaderIcon(name) {
  const wrap = document.createElement('span');
  const marks = {
    vanilla:
      '<svg viewBox="0 0 24 24"><path d="M4 7 12 3l8 4v10l-8 4-8-4Z" fill="#5fa84a"/><path d="M4 7l8 4 8-4-8-4Z" fill="#7ccf5f"/><path d="M12 11v10l-8-4V7Z" fill="#8b5a2b"/><path d="M12 11v10l8-4V7Z" fill="#6e4520"/><path d="M4 7l8 4v2L4 9Z" fill="#5fa84a"/><path d="M20 7l-8 4v2l8-4Z" fill="#4b8a39"/></svg>',
    fabric:
      '<svg viewBox="0 0 24 24"><path d="M13 2 22 11 11 22 2 13Z" fill="#dbd0b4"/><path d="M13 2 22 11 18 15 9 6Z" fill="#c6b98f"/><path d="M8 13l3 3M10 11l3 3M12 9l3 3" stroke="#38342a" stroke-width="1.4" stroke-linecap="round"/></svg>',
    forge:
      '<svg viewBox="0 0 24 24"><path d="M3 8h13c0 2 1.5 3 4 3v2h-6l-1 3 2 3H7l2-3-1-3c-3 0-5-2-5-5Z" fill="#6e86a6"/><path d="M3 8h13c0 2 1.5 3 4 3v1H8C5 12 3 10.5 3 8Z" fill="#9db2cf"/></svg>',
  };
  wrap.innerHTML = marks[name] || marks.vanilla;
  return wrap.firstChild;
}
