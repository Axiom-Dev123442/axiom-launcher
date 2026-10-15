/** Theme definitions. Every colour in the interface comes from these tokens. */
export const THEMES = {
  axiom: {
    name: 'Axiom',
    dark: true,
    bg: '#09080e',
    elev: 'rgba(20, 16, 31, 0.72)',
    surface: 'rgba(255, 255, 255, 0.035)',
    surface2: 'rgba(255, 255, 255, 0.06)',
    surface3: 'rgba(255, 255, 255, 0.09)',
    border: 'rgba(255, 255, 255, 0.07)',
    borderStrong: 'rgba(255, 255, 255, 0.13)',
    text: '#f4f2fa',
    text2: '#b7b2c8',
    text3: '#7d7792',
    accent: '#7b61d1',
    accent2: '#a58bf0',
    glow1: 'rgba(98, 70, 180, 0.30)',
    glow2: 'rgba(54, 33, 110, 0.38)',
  },
  midnight: {
    name: 'Midnight',
    dark: true,
    bg: '#060a13',
    elev: 'rgba(12, 19, 35, 0.74)',
    surface: 'rgba(255, 255, 255, 0.035)',
    surface2: 'rgba(255, 255, 255, 0.06)',
    surface3: 'rgba(255, 255, 255, 0.09)',
    border: 'rgba(255, 255, 255, 0.07)',
    borderStrong: 'rgba(255, 255, 255, 0.13)',
    text: '#eef3fb',
    text2: '#aab6cb',
    text3: '#6f7c93',
    accent: '#3b82f6',
    accent2: '#22d3ee',
    glow1: 'rgba(37, 99, 235, 0.28)',
    glow2: 'rgba(8, 145, 178, 0.22)',
  },
  ember: {
    name: 'Ember',
    dark: true,
    bg: '#0d0806',
    elev: 'rgba(28, 16, 11, 0.74)',
    surface: 'rgba(255, 255, 255, 0.035)',
    surface2: 'rgba(255, 255, 255, 0.06)',
    surface3: 'rgba(255, 255, 255, 0.09)',
    border: 'rgba(255, 255, 255, 0.07)',
    borderStrong: 'rgba(255, 255, 255, 0.13)',
    text: '#fbf3ee',
    text2: '#cbb3a6',
    text3: '#8d766a',
    accent: '#f97316',
    accent2: '#f43f5e',
    glow1: 'rgba(234, 88, 12, 0.26)',
    glow2: 'rgba(190, 18, 60, 0.24)',
  },
  forest: {
    name: 'Forest',
    dark: true,
    bg: '#060c09',
    elev: 'rgba(12, 24, 18, 0.74)',
    surface: 'rgba(255, 255, 255, 0.035)',
    surface2: 'rgba(255, 255, 255, 0.06)',
    surface3: 'rgba(255, 255, 255, 0.09)',
    border: 'rgba(255, 255, 255, 0.07)',
    borderStrong: 'rgba(255, 255, 255, 0.13)',
    text: '#eef8f1',
    text2: '#a9c4b2',
    text3: '#6b8774',
    accent: '#22c55e',
    accent2: '#a3e635',
    glow1: 'rgba(22, 163, 74, 0.24)',
    glow2: 'rgba(77, 124, 15, 0.22)',
  },
  nether: {
    name: 'Nether',
    dark: true,
    bg: '#100506',
    elev: 'rgba(32, 10, 12, 0.74)',
    surface: 'rgba(255, 255, 255, 0.035)',
    surface2: 'rgba(255, 255, 255, 0.06)',
    surface3: 'rgba(255, 255, 255, 0.09)',
    border: 'rgba(255, 255, 255, 0.07)',
    borderStrong: 'rgba(255, 255, 255, 0.13)',
    text: '#fdf1f1',
    text2: '#d0a9aa',
    text3: '#936a6c',
    accent: '#ef4444',
    accent2: '#fb923c',
    glow1: 'rgba(220, 38, 38, 0.28)',
    glow2: 'rgba(124, 45, 18, 0.30)',
  },
  end: {
    name: 'The End',
    dark: true,
    bg: '#07080e',
    elev: 'rgba(16, 15, 30, 0.74)',
    surface: 'rgba(255, 255, 255, 0.035)',
    surface2: 'rgba(255, 255, 255, 0.06)',
    surface3: 'rgba(255, 255, 255, 0.09)',
    border: 'rgba(255, 255, 255, 0.07)',
    borderStrong: 'rgba(255, 255, 255, 0.13)',
    text: '#f1f0fb',
    text2: '#b2b0cc',
    text3: '#74728f',
    accent: '#a855f7',
    accent2: '#2dd4bf',
    glow1: 'rgba(147, 51, 234, 0.26)',
    glow2: 'rgba(13, 148, 136, 0.22)',
  },
  frost: {
    name: 'Frost',
    dark: false,
    bg: '#eef2f8',
    elev: 'rgba(255, 255, 255, 0.72)',
    surface: 'rgba(255, 255, 255, 0.66)',
    surface2: 'rgba(15, 23, 42, 0.05)',
    surface3: 'rgba(15, 23, 42, 0.08)',
    border: 'rgba(15, 23, 42, 0.08)',
    borderStrong: 'rgba(15, 23, 42, 0.15)',
    text: '#0f172a',
    text2: '#475569',
    text3: '#7c8aa0',
    accent: '#2563eb',
    accent2: '#06b6d4',
    glow1: 'rgba(59, 130, 246, 0.20)',
    glow2: 'rgba(6, 182, 212, 0.16)',
  },
};

export const ACCENT_SWATCHES = ['#7b61d1', '#3f7fe0', '#1f9fb5', '#3a9d57', '#c99a2e', '#dd7232', '#d2493f', '#c9508a'];

function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s * 100, l * 100];
}

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Applies a theme (and optional custom accent) to the document. */
export function applyTheme(name, accent, animations = true) {
  const t = THEMES[name] || THEMES.axiom;
  const root = document.documentElement;
  const a = accent && /^#[0-9a-f]{6}$/i.test(accent) ? accent : t.accent;
  let a2 = t.accent2;
  if (accent && a !== t.accent) {
    const [h, s, l] = hexToHsl(a);
    a2 = `hsl(${(h + 38) % 360} ${Math.min(100, s + 5)}% ${Math.min(72, l + 8)}%)`;
  }
  const vars = {
    '--bg': t.bg,
    '--elev': t.elev,
    '--surface': t.surface,
    '--surface-2': t.surface2,
    '--surface-3': t.surface3,
    '--border': t.border,
    '--border-strong': t.borderStrong,
    '--text': t.text,
    '--text-2': t.text2,
    '--text-3': t.text3,
    '--accent': a,
    '--accent-2': a2,
    '--accent-soft': rgba(a, t.dark ? 0.16 : 0.12),
    '--accent-ring': rgba(a, 0.45),
    '--glow-1': accent ? rgba(a, t.dark ? 0.26 : 0.18) : t.glow1,
    '--glow-2': t.glow2,
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.dataset.mode = t.dark ? 'dark' : 'light';
  const logo = t.dark ? '../../assets/logo.png' : '../../assets/logo-light.png';
  for (const img of document.querySelectorAll('img[data-logo]')) img.src = logo;
  root.dataset.animations = animations ? 'on' : 'off';
}
