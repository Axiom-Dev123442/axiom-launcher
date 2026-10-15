'use strict';
/**
 * Regenerates docs/screenshots. Starts Axiom against a throwaway data folder
 * filled with demo instances, clicks through the pages and saves each one.
 * Run: npm run screenshots   (downloads Minecraft's block textures once per run)
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-shots-'));
process.env.AXIOM_HOME = data;

const { createZip } = require('../src/core/zip');
const { offlineUuid } = require('../src/core/auth/offline');

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

function write(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

function seed() {
  const now = Date.now();
  write(path.join(data, 'settings.json'), JSON.stringify({ theme: 'axiom', autoUpdate: false, discord: { enabled: false } }));
  const name = 'axiomdev';
  write(
    path.join(data, 'accounts.json'),
    JSON.stringify({ active: 'demo', accounts: [{ id: 'demo', type: 'offline', name, uuid: offlineUuid(name), addedAt: now }] }),
  );

  const instances = [
    { id: 'survival-smp', name: 'Survival SMP', icon: 'grass', mcVersion: '1.21.1', loader: 'fabric', loaderVersion: '0.16.9', playtime: 51600, lastPlayed: now - HOUR, max: 6144 },
    { id: 'create-above-beyond', name: 'Create: Above & Beyond', icon: 'gold', mcVersion: '1.20.1', loader: 'forge', loaderVersion: '1.20.1-47.3.0', playtime: 144000, lastPlayed: now - 2 * DAY, pack: true },
    { id: 'quilted-skies', name: 'Quilted Skies', icon: 'amethyst', mcVersion: '1.20.1', loader: 'quilt', loaderVersion: '0.26.4', playtime: 9000, lastPlayed: now - 4 * DAY },
    { id: 'vanilla-1-21-4', name: 'Vanilla 1.21.4', icon: 'diamond', mcVersion: '1.21.4', loader: 'vanilla', playtime: 600, lastPlayed: now - 6 * DAY },
    { id: 'pvp-practice', name: 'PvP Practice', icon: 'redstone', mcVersion: '1.8.9', loader: 'forge', loaderVersion: '1.8.9-11.15.1.2318', playtime: 21000, lastPlayed: now - 31 * DAY },
    { id: 'hardcore-run', name: 'Hardcore run', icon: 'netherrack', mcVersion: '1.21.1', loader: 'vanilla', playtime: 0, lastPlayed: 0 },
  ];
  instances.forEach((i, n) => {
    const dir = path.join(data, 'instances', i.id);
    write(
      path.join(dir, 'instance.json'),
      JSON.stringify({
        name: i.name,
        icon: { type: 'preset', value: i.icon },
        mcVersion: i.mcVersion,
        loader: i.loader,
        loaderVersion: i.loaderVersion || null,
        memory: { min: 512, max: i.max || 4096 },
        playtime: i.playtime,
        lastPlayed: i.lastPlayed,
        created: now - (40 - n) * DAY,
        modpack: i.pack ? { source: 'file', name: i.name, versionNumber: '1.4' } : null,
      }),
    );
    fs.mkdirSync(path.join(dir, 'minecraft'), { recursive: true });
  });

  // Mods and worlds for the instance the screenshots open.
  const game = path.join(data, 'instances', 'survival-smp', 'minecraft');
  for (const [id, title, version] of [['sodium', 'Sodium', '0.6.0'], ['lithium', 'Lithium', '0.14.3'], ['iris', 'Iris Shaders', '1.8.1'], ['modmenu', 'Mod Menu', '11.0.3']]) {
    write(path.join(game, 'mods', `${id}-${version}.jar`), createZip([{ name: 'fabric.mod.json', data: JSON.stringify({ id, name: title, version }) }]));
  }
  const worlds = [['New World', 3 * 1024 * 1024, now - HOUR], ['Creative Build', 18 * 1024 * 1024, now - 5 * DAY], ['Island Challenge', 7 * 1024 * 1024, now - 12 * DAY]];
  for (const [world, size, played] of worlds) {
    const dir = path.join(game, 'saves', world);
    write(path.join(dir, 'level.dat'), 'level');
    write(path.join(dir, 'region', 'r.0.0.mca'), Buffer.alloc(size));
    const at = new Date(played);
    fs.utimesSync(path.join(dir, 'level.dat'), at, at);
  }
  const backup = path.join(data, 'instances', 'survival-smp', 'backups', 'New World @ 2026-10-14_18-30-00');
  write(path.join(backup, 'level.dat'), 'level');
  const at = new Date(now - 2 * DAY);
  fs.utimesSync(backup, at, at);
}

seed();

const { app } = require('electron');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Runs in the page: clicks the first element matching selector whose text contains text. */
const HELPERS = `
window.__shot = {
  click(selector, text) {
    const el = [...document.querySelectorAll(selector)].find((e) => !text || e.textContent.trim().includes(text));
    if (!el) throw new Error('Nothing to click: ' + selector + ' ' + (text || ''));
    el.click();
    return true;
  },
  idle() {
    return !document.querySelector('.titlebar .badge') && !document.querySelector('.main .spinner, .modal .spinner');
  },
  why() {
    const badge = document.querySelector('.titlebar .badge');
    const spin = document.querySelector('.main .spinner, .modal .spinner');
    return [badge ? 'downloads running: ' + badge.textContent : '', spin ? 'spinner in ' + (spin.parentElement && spin.parentElement.className) : ''].filter(Boolean).join(', ');
  },
};
true;
`;

async function run(win) {
  const wc = win.webContents;
  const js = (code) => wc.executeJavaScript(code);
  const settle = async (ms = 1200, timeout = 20000) => {
    const end = Date.now() + timeout;
    await wait(400);
    while (Date.now() < end && !(await js('window.__shot.idle()'))) await wait(300);
    if (Date.now() >= end) console.log(`  still busy after ${timeout / 1000}s: ${await js('window.__shot.why()')}`);
    await wait(ms);
  };
  const shot = async (name) => {
    let image = await wc.capturePage();
    const { width } = image.getSize();
    if (width !== 1280) image = image.resize({ width: 1280, height: 800, quality: 'best' });
    fs.writeFileSync(path.join(OUT, `${name}.png`), image.toPNG());
    console.log(`saved ${name}.png`);
  };
  const click = (selector, text) => console.log(`click ${text || selector}`) || js(`window.__shot.click(${JSON.stringify(selector)}, ${JSON.stringify(text || '')})`);
  const page = async (label) => {
    await click('.nav-items .nav-item', label);
    await settle();
  };
  const boot = async () => {
    await js(HELPERS);
    // The first start downloads real block textures for the instance icons.
    await settle(2500, 120000);
  };

  await boot();
  await shot('home');
  await page('Library');
  await shot('library');
  await click('.icard .name', 'Survival SMP');
  await settle();
  await shot('instance');
  await click('.tabs .tab', 'Worlds');
  await settle();
  await shot('worlds');
  await page('Browse');
  await settle(3000);
  await shot('browse');
  await page('Skins');
  await settle(2500);
  await shot('skins');
  await page('Settings');
  await shot('settings');
  await page('Home');
  await click('.main .page-head button, .main button', 'New instance');
  await settle(600);
  await click('.modal .segmented button', 'Presets');
  await settle(2500);
  await shot('presets');

  // The same home page in the Frost theme.
  await js(`window.axiom.call('settings:update', { theme: 'frost' })`);
  wc.reload();
  await new Promise((r) => wc.once('did-finish-load', r));
  await boot();
  await shot('home-frost');
}

const finish = (code) => {
  fs.rmSync(data, { recursive: true, force: true });
  app.exit(code);
};

// Never leave a window behind, even if a page never finishes loading.
setTimeout(() => {
  console.error('Screenshots took longer than 5 minutes; giving up.');
  finish(1);
}, 5 * 60 * 1000).unref();

let started = false;
app.on('browser-window-created', (_e, win) => {
  if (started) return;
  started = true;
  // The window is driven by this script; clicks from a person would only get in the way.
  console.log('window created');
  win.setTitle('Axiom (taking screenshots, closes by itself)');
  win.webContents.once('did-finish-load', () => {
    console.log('page loaded');
    run(win).then(
      () => finish(0),
      (err) => {
        console.error(err);
        finish(1);
      },
    );
  });
});

console.log('starting Axiom with demo data in', data);
app.on('will-quit', () => console.log('quitting'));
require('../src/main/main.js');
