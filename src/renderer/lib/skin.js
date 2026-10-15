/** Skin helpers: a built-in default skin, avatar heads, 2D previews and the 3D viewer. */
import { call } from './store.js';

let defaultSkinUrl = null;

/**
 * Draws an original default character skin (64×64) with pixel shading, so
 * nothing depends on Mojang art.
 */
export function defaultSkin() {
  if (defaultSkinUrl) return defaultSkinUrl;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // Fills a rectangle with slightly varied shades of a base colour.
  const fill = (rgb, x, y, w, h, vary = 10) => {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const d = Math.round((rand() - 0.5) * vary);
        g.fillStyle = `rgb(${rgb[0] + d},${rgb[1] + d},${rgb[2] + d})`;
        g.fillRect(xx, yy, 1, 1);
      }
    }
  };
  const px = (rgb, x, y) => fill(rgb, x, y, 1, 1, 0);
  const SKIN = [198, 146, 112];
  const SKIN_D = [176, 124, 92];
  const HAIR = [58, 40, 26];
  const HAIR_L = [78, 55, 36];
  const HOOD = [74, 58, 150];
  const HOOD_D = [56, 43, 118];
  const TRIM = [150, 132, 226];
  const PANTS = [44, 48, 66];
  const PANTS_D = [34, 37, 52];
  const BOOTS = [30, 28, 34];

  // Head: skin all round, hair on top, back and upper sides
  fill(SKIN, 0, 8, 32, 8);
  fill(HAIR, 8, 0, 8, 8);
  fill(SKIN_D, 16, 0, 8, 8);
  fill(HAIR, 0, 8, 8, 3);
  fill(HAIR, 16, 8, 8, 3);
  fill(HAIR, 24, 8, 8, 7);
  fill(HAIR, 8, 8, 8, 2);
  fill(HAIR_L, 9, 8, 3, 1, 4);
  px(HAIR, 8, 10);
  px(HAIR, 15, 10);
  // Face
  fill([255, 255, 255], 9, 12, 2, 1, 0);
  fill([255, 255, 255], 13, 12, 2, 1, 0);
  px([70, 58, 170], 10, 12);
  px([70, 58, 170], 13, 12);
  fill(SKIN_D, 11, 13, 2, 1, 4);
  fill([130, 80, 62], 11, 14, 2, 1, 0);
  fill(SKIN_D, 8, 15, 8, 1, 4);
  // Hat layer: hood rim around the back of the head
  fill(HOOD, 56, 8, 8, 8, 8);
  fill(HOOD, 32, 8, 8, 8, 8);
  fill(HOOD, 48, 8, 8, 8, 8);
  fill(HOOD, 40, 0, 8, 8, 8);
  fill(HOOD_D, 48, 0, 8, 8, 6);
  fill(HOOD, 40, 8, 8, 1, 8);
  // Body: hoodie with zip and pocket
  fill(HOOD, 16, 16, 24, 16, 10);
  fill(HOOD_D, 28, 16, 8, 4, 6);
  fill(TRIM, 23, 20, 2, 12, 6);
  fill(HOOD_D, 20, 27, 8, 3, 6);
  fill(HOOD_D, 20, 31, 8, 1, 4);
  // Arms
  for (const [ax, ay] of [
    [40, 16],
    [32, 48],
  ]) {
    fill(HOOD, ax, ay, 16, 16, 10);
    fill(HOOD_D, ax, ay + 14, 16, 1, 4);
    fill(SKIN, ax, ay + 15, 16, 1, 6);
    fill(SKIN_D, ax + 8, ay, 4, 4, 4);
  }
  // Legs
  for (const [lx, ly] of [
    [0, 16],
    [16, 48],
  ]) {
    fill(PANTS, lx, ly, 16, 16, 8);
    fill(PANTS_D, lx, ly + 4, 16, 1, 4);
    fill(BOOTS, lx, ly + 13, 16, 3, 6);
    fill(BOOTS, lx + 8, ly, 4, 4, 4);
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
export function createViewer({ width, height, src, variant = 'classic', cape = null, animation = 'idle', zoom = 0.9, rotate = false, nameTag = null }) {
  const lib = window.skinview3d;
  if (!lib) return null;
  const canvas = document.createElement('canvas');
  let viewer;
  try {
    viewer = new lib.SkinViewer({ canvas, width, height, zoom, enableControls: true, pixelRatio: 'match-device' });
  } catch {
    return null;
  }
  viewer.fov = 38;
  viewer.zoom = zoom;
  viewer.globalLight.intensity = 2.6;
  viewer.cameraLight.intensity = 0.9;
  viewer.autoRotate = rotate;
  viewer.autoRotateSpeed = 0.7;
  viewer.playerWrapper.rotation.y = -0.4;
  if (viewer.controls) {
    viewer.controls.enableZoom = true;
    viewer.controls.minDistance = 30;
    viewer.controls.maxDistance = 110;
    viewer.controls.enablePan = false;
    viewer.controls.enableDamping = true;
  }
  if (nameTag && lib.NameTagObject) {
    viewer.nameTag = new lib.NameTagObject(nameTag, { textStyle: 'white', backgroundStyle: 'rgba(0,0,0,0.35)', font: '48px Minecraft, Segoe UI, sans-serif' });
  }
  setAnimation(viewer, animation);
  viewer.loadSkin(src || defaultSkin(), { model: variant === 'slim' ? 'slim' : 'default' });
  if (cape) viewer.loadCape(cape);
  return { canvas, viewer };
}

export function setAnimation(viewer, name) {
  const lib = window.skinview3d;
  if (!lib || !viewer) return;
  const anims = {
    idle: lib.IdleAnimation,
    walk: lib.WalkingAnimation,
    run: lib.RunningAnimation,
    wave: lib.WaveAnimation,
    fly: lib.FlyingAnimation,
    crouch: lib.CrouchAnimation,
  };
  const Anim = anims[name];
  viewer.animation = Anim ? new Anim() : null;
  if (viewer.animation && name === 'walk') viewer.animation.speed = 0.7;
  if (!viewer.animation) {
    for (const part of ['leftArm', 'rightArm', 'leftLeg', 'rightLeg', 'head', 'body']) {
      const p = viewer.playerObject.skin[part];
      if (p) p.rotation.set(0, 0, 0);
    }
  }
}

/* 3D thumbnails: one hidden viewer renders posed snapshots, so a page full of
   skins costs a single WebGL context. */
let thumbViewer = null;
let thumbQueue = Promise.resolve();
const thumbCache = new Map();

function poseThumb(viewer) {
  const s = viewer.playerObject.skin;
  viewer.playerObject.rotation.set(0, 0, 0);
  viewer.playerWrapper.rotation.set(0, -0.55, 0);
  s.head.rotation.set(0.08, 0.25, 0);
  s.rightArm.rotation.set(-0.45, 0, 0.06);
  s.leftArm.rotation.set(0.45, 0, -0.06);
  s.rightLeg.rotation.set(0.4, 0, 0);
  s.leftLeg.rotation.set(-0.4, 0, 0);
}

/** Renders a posed, lit 3D snapshot of a skin and returns it as a PNG data URL. */
export function skinThumb(src, variant = 'classic') {
  const key = `${variant}:${src}`;
  if (thumbCache.has(key)) return thumbCache.get(key);
  const job = (thumbQueue = thumbQueue.then(async () => {
    const lib = window.skinview3d;
    if (!lib) throw new Error('3D unavailable');
    if (!thumbViewer) {
      thumbViewer = new lib.SkinViewer({
        canvas: document.createElement('canvas'),
        width: 240,
        height: 360,
        renderPaused: true,
        preserveDrawingBuffer: true,
        pixelRatio: 1,
      });
      thumbViewer.fov = 34;
      thumbViewer.zoom = 0.86;
      thumbViewer.globalLight.intensity = 2.6;
      thumbViewer.cameraLight.intensity = 1;
    }
    await thumbViewer.loadSkin(src, { model: variant === 'slim' ? 'slim' : 'default' });
    poseThumb(thumbViewer);
    thumbViewer.render();
    return thumbViewer.canvas.toDataURL('image/png');
  }));
  thumbQueue = job.catch(() => {});
  thumbCache.set(key, job);
  return job;
}

/** An <img> that shows a 3D thumbnail once rendered (flat preview until then). */
export function skinThumbImg(src, variant = 'classic', cls = 'skin-thumb') {
  const img = document.createElement('img');
  img.className = cls;
  img.alt = '';
  img.draggable = false;
  skinThumb(src, variant).then(
    (url) => (img.src = url),
    () => img.replaceWith(frontView(src, variant)),
  );
  return img;
}
