/** Skin helpers: a built-in default skin, avatar heads, 2D previews and the 3D viewer. */
import { call } from './store.js';

let defaultSkinUrl = null;

/** Draws a simple original default character skin (64×64) so nothing depends on Mojang art. */
export function defaultSkin() {
  if (defaultSkinUrl) return defaultSkinUrl;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  const fill = (color, x, y, w, h) => {
    g.fillStyle = color;
    g.fillRect(x, y, w, h);
  };
  const SKIN = '#c58f6d';
  const SKIN_D = '#b07a5a';
  const HAIR = '#3a2716';
  const SHIRT = '#5b3fd0';
  const SHIRT_D = '#4a31b0';
  const PANTS = '#2a2f45';
  const SHOES = '#1a1b22';

  // Head
  fill(SKIN, 0, 8, 32, 8);
  fill(HAIR, 8, 0, 8, 8);
  fill(SKIN_D, 16, 0, 8, 8);
  fill(HAIR, 0, 8, 32, 2);
  fill(HAIR, 24, 8, 8, 6);
  fill(HAIR, 0, 10, 2, 2);
  fill(HAIR, 22, 10, 2, 2);
  // Face
  fill('#ffffff', 9, 12, 2, 1);
  fill('#ffffff', 13, 12, 2, 1);
  fill('#4b3cc4', 10, 12, 1, 1);
  fill('#4b3cc4', 13, 12, 1, 1);
  fill('#7a4a36', 11, 14, 2, 1);
  fill(SKIN_D, 11, 13, 2, 1);
  // Body
  fill(SHIRT, 16, 16, 24, 16);
  fill(SHIRT_D, 20, 16, 16, 4);
  fill('#8b74ff', 23, 20, 2, 12);
  // Arms (right at 40,16; left at 32,48)
  for (const [ax, ay] of [
    [40, 16],
    [32, 48],
  ]) {
    fill(SHIRT, ax, ay, 16, 16);
    fill(SKIN, ax, ay + 10, 16, 6);
    fill(SKIN, ax + 8, ay, 4, 4);
  }
  // Legs (right at 0,16; left at 16,48)
  for (const [lx, ly] of [
    [0, 16],
    [16, 48],
  ]) {
    fill(PANTS, lx, ly, 16, 16);
    fill(SHOES, lx, ly + 13, 16, 3);
    fill(SHOES, lx + 8, ly, 4, 4);
  }
  defaultSkinUrl = c.toDataURL();
  return defaultSkinUrl;
}

const imgCache = new Map();
export function loadImage(src) {
  if (!imgCache.has(src)) {
    imgCache.set(
      src,
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      }),
    );
  }
  return imgCache.get(src);
}

/** Resolves an account's skin to a data URL (remote skins go through the main process). */
export async function accountSkin(account) {
  if (!account || !account.skin || !account.skin.url) return { src: defaultSkin(), variant: 'classic' };
  try {
    return { src: await call('skins:image', account.skin.url), variant: account.skin.variant || 'classic' };
  } catch {
    return { src: defaultSkin(), variant: 'classic' };
  }
}

/** A canvas showing the face (with hat layer) of a skin. */
export function headCanvas(src, cls = 'head') {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 8;
  c.className = cls;
  loadImage(src || defaultSkin())
    .then((img) => {
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(img, 8, 8, 8, 8, 0, 0, 8, 8);
      g.drawImage(img, 40, 8, 8, 8, 0, 0, 8, 8);
    })
    .catch(() => {});
  return c;
}

export function accountHead(account, cls) {
  const c = headCanvas(defaultSkin(), cls);
  if (account && account.skin) {
    accountSkin(account).then(({ src }) =>
      loadImage(src).then((img) => {
        const g = c.getContext('2d');
        g.imageSmoothingEnabled = false;
        g.clearRect(0, 0, 8, 8);
        g.drawImage(img, 8, 8, 8, 8, 0, 0, 8, 8);
        g.drawImage(img, 40, 8, 8, 8, 0, 0, 8, 8);
      }),
    );
  }
  return c;
}

/** A flat front view of a whole skin (16×32), for skin library cards. */
export function frontView(src, variant = 'classic') {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 32;
  loadImage(src)
    .then((img) => {
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      const legacy = img.height === 32;
      const aw = variant === 'slim' ? 3 : 4;
      const part = (sx, sy, w, hgt, dx, dy, flip) => {
        if (flip) {
          g.save();
          g.translate(dx + w, dy);
          g.scale(-1, 1);
          g.drawImage(img, sx, sy, w, hgt, 0, 0, w, hgt);
          g.restore();
        } else {
          g.drawImage(img, sx, sy, w, hgt, dx, dy, w, hgt);
        }
      };
      const ax = 4 - aw;
      part(8, 8, 8, 8, 4, 0);
      part(20, 20, 8, 12, 4, 8);
      part(44, 20, aw, 12, ax, 8);
      if (legacy) part(44, 20, aw, 12, 12, 8, true);
      else part(36, 52, aw, 12, 12, 8);
      part(4, 20, 4, 12, 4, 20);
      if (legacy) part(4, 20, 4, 12, 8, 20, true);
      else part(20, 52, 4, 12, 8, 20);
      // Second layer
      part(40, 8, 8, 8, 4, 0);
      if (!legacy) {
        part(20, 36, 8, 12, 4, 8);
        part(44, 36, aw, 12, ax, 8);
        part(52, 52, aw, 12, 12, 8);
        part(4, 36, 4, 12, 4, 20);
        part(4, 52, 4, 12, 8, 20);
      }
    })
    .catch(() => {});
  return c;
}

/** A small front view of a cape texture. */
export function capeView(src) {
  const c = document.createElement('canvas');
  c.width = 10;
  c.height = 16;
  loadImage(src)
    .then((img) => {
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      const scale = img.width / 64;
      g.drawImage(img, 1 * scale, 1 * scale, 10 * scale, 16 * scale, 0, 0, 10, 16);
    })
    .catch(() => {});
  return c;
}

/**
 * Creates an interactive 3D skin viewer (skinview3d), or null when WebGL or
 * the library is unavailable.
 */
export function createViewer({ width, height, src, variant = 'classic', cape = null, animation = 'idle', zoom = 0.9, rotate = false }) {
  const lib = window.skinview3d;
  if (!lib) return null;
  const canvas = document.createElement('canvas');
  let viewer;
  try {
    viewer = new lib.SkinViewer({ canvas, width, height, zoom, enableControls: true });
  } catch {
    return null;
  }
  viewer.fov = 40;
  viewer.zoom = zoom;
  viewer.globalLight.intensity = 3;
  viewer.cameraLight.intensity = 0.6;
  viewer.autoRotate = rotate;
  viewer.autoRotateSpeed = 0.6;
  viewer.playerObject.rotation.y = -0.35;
  if (viewer.controls) {
    viewer.controls.enableZoom = false;
    viewer.controls.enablePan = false;
  }
  setAnimation(viewer, animation);
  viewer.loadSkin(src || defaultSkin(), { model: variant === 'slim' ? 'slim' : 'default' });
  if (cape) viewer.loadCape(cape);
  return { canvas, viewer };
}

export function setAnimation(viewer, name) {
  const lib = window.skinview3d;
  if (!lib || !viewer) return;
  const anims = { idle: lib.IdleAnimation, walk: lib.WalkingAnimation, run: lib.RunningAnimation, wave: lib.WaveAnimation, fly: lib.FlyingAnimation };
  const Anim = anims[name];
  viewer.animation = Anim ? new Anim() : null;
  if (viewer.animation && name === 'walk') viewer.animation.speed = 0.7;
}
