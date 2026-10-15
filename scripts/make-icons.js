'use strict';
/**
 * Renders the app icon, Windows .ico, installer sidebar and Discord art from
 * the logo SVG. Run with: npx electron scripts/make-icons.js
 */
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const A1 = '#a58bf0';
const A2 = '#7b61d1';

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${A1}"/><stop offset="1" stop-color="${A2}"/></linearGradient>
  <linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
  <path d="M32 3 55 17v30L32 61 9 47V17Z" fill="url(#a)"/>
  <path d="M32 3 55 17 32 29 9 17Z" fill="url(#b)" opacity=".55"/>
  <path d="M32 29v32L9 47V17Z" fill="#000" opacity=".28"/>
  <path d="M32 29 55 17v30L32 61Z" fill="#000" opacity=".1"/>
  <path d="M32 14 43 21 32 28 21 21Z" fill="#fff" opacity=".35"/>
</svg>`;

function page(body, w, h) {
  return `data:text/html;base64,${Buffer.from(`<!doctype html><html><body style="margin:0;width:${w}px;height:${h}px;overflow:hidden;background:transparent">${body}</body></html>`).toString('base64')}`;
}

async function render(win, html, w, h) {
  win.setContentSize(w, h);
  await win.loadURL(page(html, w, h));
  await new Promise((r) => setTimeout(r, 200));
  return win.webContents.capturePage({ x: 0, y: 0, width: w, height: h });
}

function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

/** 24-bit bottom-up BMP, which is what NSIS wants for installer images. */
function bmp(image) {
  const { width, height } = image.getSize();
  const bgra = image.toBitmap();
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const out = Buffer.alloc(54 + rowSize * height);
  out.write('BM', 0);
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(width, 18);
  out.writeInt32LE(height, 22);
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  out.writeUInt32LE(rowSize * height, 34);
  for (let y = 0; y < height; y++) {
    const dst = 54 + (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      out[dst + x * 3] = bgra[s];
      out[dst + x * 3 + 1] = bgra[s + 1];
      out[dst + x * 3 + 2] = bgra[s + 2];
    }
  }
  return out;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } });
  fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'assets', 'discord'), { recursive: true });

  const logoAt = (s, pad = 0.06) => `<div style="width:${s}px;height:${s}px;display:grid;place-items:center"><img style="width:${s * (1 - pad * 2)}px;height:${s * (1 - pad * 2)}px" src="data:image/svg+xml;base64,${Buffer.from(LOGO).toString('base64')}"></div>`;

  const big = await render(win, logoAt(512), 512, 512);
  fs.writeFileSync(path.join(ROOT, 'build', 'icon.png'), big.toPNG());
  fs.writeFileSync(path.join(ROOT, 'assets', 'icon.png'), big.resize({ width: 256, height: 256, quality: 'best' }).toPNG());

  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = [];
  for (const size of sizes) {
    const img = await render(win, logoAt(size, size <= 32 ? 0.02 : 0.06), size, size);
    pngs.push({ size, data: img.toPNG() });
  }
  fs.writeFileSync(path.join(ROOT, 'build', 'icon.ico'), ico(pngs));

  const sidebar = await render(
    win,
    `<div style="width:164px;height:314px;background:linear-gradient(180deg,#151020,#0a0810);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;font-family:'Segoe UI',sans-serif">
      ${logoAt(84)}
      <div style="color:#f1eefa;font-weight:700;letter-spacing:.22em;font-size:14px">OBSIDIAN</div>
      <div style="color:#8f88a6;font-size:11px">Minecraft launcher</div>
    </div>`,
    164,
    314,
  );
  fs.writeFileSync(path.join(ROOT, 'build', 'installerSidebar.bmp'), bmp(sidebar));

  const discord = await render(win, `<div style="width:1024px;height:1024px;background:#0e0b16;display:grid;place-items:center">${logoAt(760)}</div>`, 1024, 1024);
  fs.writeFileSync(path.join(ROOT, 'assets', 'discord', 'obsidian.png'), discord.toPNG());

  app.quit();
});
