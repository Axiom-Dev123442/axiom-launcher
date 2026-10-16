/**
 * Procedurally drawn 16×16 block textures used as instance icons, so the
 * launcher ships no copyrighted game art.
 */

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const pick = (r, list) => list[Math.floor(r() * list.length)];

function noise(px, r, palette) {
  for (let i = 0; i < 256; i++) px[i] = pick(r, palette);
}

function ore(px, r, base, ore, count = 5) {
  noise(px, r, base);
  for (let n = 0; n < count; n++) {
    const x = 1 + Math.floor(r() * 13);
    const y = 1 + Math.floor(r() * 13);
    const shape = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
      [r() > 0.5 ? 2 : -1, 0],
    ];
    for (const [dx, dy] of shape) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx >= 0 && xx < 16 && yy >= 0 && yy < 16) px[yy * 16 + xx] = pick(r, ore);
    }
  }
}

const STONE = ['#7f7f7f', '#747474', '#8a8a8a', '#6c6c6c', '#7a7a7a'];

const BLOCKS = {
  obsidian: (px, r) => {
    noise(px, r, ['#120d1e', '#160f24', '#0f0b18', '#1a1229', '#140e21']);
    for (let n = 0; n < 22; n++) px[Math.floor(r() * 256)] = pick(r, ['#3b2a5c', '#5b3e8c', '#2c1f45', '#47336e']);
  },
  grass: (px, r) => {
    noise(px, r, ['#866043', '#79553a', '#966c4a', '#6c4b31', '#8f6646']);
    for (let x = 0; x < 16; x++) {
      const depth = 3 + Math.floor(r() * 3);
      for (let y = 0; y < depth; y++) px[y * 16 + x] = pick(r, ['#5d9b3a', '#6bb043', '#4f8a31', '#73b84a']);
    }
  },
  dirt: (px, r) => noise(px, r, ['#866043', '#79553a', '#966c4a', '#6c4b31', '#8f6646']),
  stone: (px, r) => noise(px, r, STONE),
  diamond: (px, r) => ore(px, r, STONE, ['#5decf5', '#2cc6d4', '#a1fbe8', '#1aa8b5']),
  emerald: (px, r) => ore(px, r, STONE, ['#17dd62', '#0fb04b', '#7cf5a4'], 4),
  gold: (px, r) => ore(px, r, STONE, ['#fcee4b', '#e8c22c', '#fff7a8']),
  redstone: (px, r) => ore(px, r, STONE, ['#ff1a1a', '#c40000', '#ff6363'], 6),
  lapis: (px, r) => ore(px, r, STONE, ['#2547a8', '#1b3787', '#4a72d9']),
  netherrack: (px, r) => noise(px, r, ['#6f2222', '#7d2a2a', '#5e1b1b', '#8a3232', '#672020']),
  endstone: (px, r) => noise(px, r, ['#dbdea0', '#e6e8b0', '#cfd293', '#f0f1c2', '#d4d79a']),
  glowstone: (px, r) => {
    noise(px, r, ['#a77b3d', '#c99a4a', '#f2d17a', '#fff0a8', '#8e6630']);
  },
  amethyst: (px, r) => {
    noise(px, r, ['#8d6acc', '#7a55b8', '#a989e0', '#6542a1', '#c7a8f5']);
  },
  ice: (px, r) => noise(px, r, ['#9cc4ff', '#8ab7f7', '#b5d4ff', '#7aa8ee', '#a8cbff']),
  sculk: (px, r) => {
    noise(px, r, ['#0d1e24', '#0a171c', '#10262e', '#071116']);
    for (let n = 0; n < 14; n++) px[Math.floor(r() * 256)] = pick(r, ['#29dfeb', '#1a9fa8', '#0e5f66']);
  },
  cherry: (px, r) => noise(px, r, ['#f2b4cf', '#e89bbd', '#f7c8dc', '#d98aac', '#eaa7c4']),
  planks: (px, r) => {
    for (let y = 0; y < 16; y++) {
      const row = Math.floor(y / 4);
      for (let x = 0; x < 16; x++) {
        let c = pick(r, ['#a2834f', '#9c7b49', '#ad8b57', '#94744a']);
        if (y % 4 === 3) c = '#6b5332';
        if ((x === 3 && row % 2 === 0) || (x === 11 && row % 2 === 1)) c = '#7a5f38';
        px[y * 16 + x] = c;
      }
    }
  },
  tnt: (px, r) => {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        let c = x % 4 === 0 ? '#a72616' : pick(r, ['#db441a', '#c9371a', '#e14f22']);
        if (y >= 5 && y <= 10) c = '#e8e8e8';
        px[y * 16 + x] = c;
      }
    }
    const T = [
      [3, 6], [4, 6], [5, 6], [4, 7], [4, 8], [4, 9],
      [7, 6], [7, 7], [7, 8], [7, 9], [8, 7], [9, 8], [10, 6], [10, 7], [10, 8], [10, 9],
      [12, 6], [13, 6], [14, 6], [13, 7], [13, 8], [13, 9],
    ];
    for (const [x, y] of T) px[y * 16 + x] = '#1b1b1b';
  },
};

/** Icons offered in the picker. Names without a drawn fallback only show once real textures are loaded. */
const ALL_NAMES = [
  'obsidian', 'grass', 'dirt', 'stone', 'deepslate', 'diamond', 'emerald', 'gold', 'redstone', 'lapis',
  'netherrack', 'endstone', 'glowstone', 'amethyst', 'ice', 'sculk', 'cherry', 'planks', 'log', 'tnt',
  'crafting', 'furnace', 'bookshelf', 'pumpkin', 'diamondblock', 'goldblock', 'netherite', 'debris', 'crying',
  'honey', 'slime', 'magma', 'prismarine', 'sealantern', 'moss', 'bricks', 'sand', 'command', 'spawner', 'beacon',
];

export let BLOCK_NAMES = Object.keys(BLOCKS);

const cache = new Map();
const real = new Map();

/**
 * Switches icons to the real block textures from the player's game files.
 * Animated textures are vertical strips, so only the first frame is used.
 */
export async function useRealTextures(textures) {
  for (const [name, src] of Object.entries(textures)) {
    const img = await new Promise((resolve) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => resolve(null);
      i.src = src;
    });
    if (!img) continue;
    const size = img.width;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    c.getContext('2d').drawImage(img, 0, 0, size, size, 0, 0, size, size);
    real.set(name, c.toDataURL());
  }
  BLOCK_NAMES = ALL_NAMES.filter((n) => real.has(n) || BLOCKS[n]);
}

/** Returns a PNG data URL for a block icon. */
export function blockIcon(name) {
  if (real.has(name)) return real.get(name);
  if (!BLOCKS[name]) name = 'stone';
  if (cache.has(name)) return cache.get(name);
  const px = new Array(256);
  BLOCKS[name](px, rng(hashStr(name)));
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 16;
  const ctx = c.getContext('2d');
  for (let i = 0; i < 256; i++) {
    ctx.fillStyle = px[i];
    ctx.fillRect(i % 16, Math.floor(i / 16), 1, 1);
  }
  // Soft bevel so the icon reads as a block.
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(0, 0, 16, 1);
  ctx.fillRect(0, 0, 1, 16);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(0, 15, 16, 1);
  ctx.fillRect(15, 0, 1, 16);
  const url = c.toDataURL();
  cache.set(name, url);
  return url;
}

/** The image source for an instance's icon setting. */
export function iconSrc(icon) {
  if (!icon) return blockIcon('diamond');
  if (icon.type === 'image' || icon.type === 'url') return icon.value;
  return blockIcon(icon.value);
}

export function iconIsPixel(icon) {
  return !icon || icon.type === 'preset';
}

/**
 * Turns any image the browser can decode (PNG, JPG, WebP, GIF, BMP, ICO, AVIF,
 * SVG) into a 128×128 PNG icon, cropped to the centre square.
 */
export async function imageToIcon(src) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('That image could not be read.'));
    i.src = src;
  });
  const w = img.naturalWidth || 128;
  const h = img.naturalHeight || 128;
  const side = Math.min(w, h);
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  // Keep pixel art crisp when scaling small images up.
  g.imageSmoothingEnabled = side >= 128;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, 128, 128);
  return { type: 'image', value: c.toDataURL('image/png') };
}

const blurCache = new Map();

/**
 * A 4×4 version of an icon. Stretched with smooth scaling it looks like a
 * heavy blur but costs nothing to draw, which matters on low-end PCs.
 */
export function blurSrc(icon) {
  const src = iconSrc(icon);
  if (blurCache.has(src)) return Promise.resolve(blurCache.get(src));
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 4;
      c.height = 4;
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = true;
      g.drawImage(img, 0, 0, 4, 4);
      const url = c.toDataURL();
      blurCache.set(src, url);
      resolve(url);
    };
    img.onerror = () => resolve(src);
    img.src = src;
  });
}

/** Sets an element's background to the blurred version of an icon. */
export function blurBackground(el, icon) {
  blurSrc(icon).then((url) => (el.style.backgroundImage = `url("${url}")`));
  return el;
}
