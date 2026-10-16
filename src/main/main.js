'use strict';
const path = require('node:path');
const fsp = require('node:fs/promises');
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, session } = require('electron');

const { createPaths } = require('../core/paths');
const { TaskManager } = require('../core/tasks');
const { VersionService } = require('../core/versions');
const { JavaService } = require('../core/java');
const { InstanceStore } = require('../core/instances');
const { AccountStore } = require('../core/accounts');
const { Settings } = require('../core/settings');
const { GameManager } = require('../core/game');
const { ContentManager } = require('../core/content');
const { ModpackManager } = require('../core/modpacks');
const { SkinLibrary, skinByUsername, uploadSkin, resetSkin, setCape, fetchImage, toDataUrl } = require('../core/skins');
const { DiscordPresence, buildActivity } = require('../core/discord');
const { fabricLoaderVersions } = require('../core/loaders/fabric');
const { forgeVersions } = require('../core/loaders/forge');
const { quiltLoaderVersions } = require('../core/loaders/quilt');
const { WorldManager } = require('../core/worlds');
const modrinth = require('../core/mods/modrinth');
const curseforge = require('../core/mods/curseforge');
const { setupUpdater } = require('./updater');
const { BlockTextures } = require('../core/blockTextures');
const presets = require('../core/presets');
const { safeJoin } = require('../core/util');
const axiomClient = require('../core/axiomClient');

const RELEASES_URL = 'https://github.com/Axiom-Dev123442/axiom-launcher/releases/latest';

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.setAppUserModelId('dev.axiomdev.axiom');

const paths = createPaths();
const tasks = new TaskManager();
const settings = new Settings(paths);
const versions = new VersionService(paths);
const java = new JavaService(paths);
const instances = new InstanceStore(paths);
const content = new ContentManager(instances);
const modpacks = new ModpackManager({ paths, instances, content });
const skinLibrary = new SkinLibrary(paths);
const discord = new DiscordPresence();
const blockTextures = new BlockTextures(paths, versions);
const worlds = new WorldManager(instances);

const accounts = new AccountStore(paths, {
  encrypt: (s) =>
    safeStorage.isEncryptionAvailable() ? `enc:${safeStorage.encryptString(s).toString('base64')}` : Buffer.from(s).toString('base64'),
  decrypt: (s) =>
    s.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(s.slice(4), 'base64')) : Buffer.from(s, 'base64').toString(),
  getClientId: () => settings.microsoftClientId(),
});

const game = new GameManager({
  paths,
  versions,
  java,
  instances,
  accounts,
  settings,
  tasks,
  launcherVersion: app.getVersion(),
  // The Axiom client is built in: every Fabric 26.3 instance gets it (and Fabric API) when it starts.
  beforeLaunch: async (inst, task) => {
    try {
      await axiomClient.ensure({ instances, content }, inst, task);
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      throw new Error(`Couldn't set up the Axiom Client: ${err.message} Check your connection, or turn off Axiom Client in this instance's settings.`);
    }
  },
});

let win = null;
let loginAbort = null;
let loginWindow = null;

/**
 * Shows Microsoft's sign in page in a small window and resolves with the URL it
 * redirects to after the person accepts. Uses a fresh session every time so a
 * different account can be picked.
 */
function openLoginWindow(url, redirectUri) {
  return new Promise((resolve, reject) => {
    if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
    loginWindow = new BrowserWindow({
      width: 500,
      height: 680,
      parent: win,
      modal: true,
      title: 'Sign in with Microsoft',
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
      webPreferences: { partition: `ms-login-${Date.now()}`, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    let done = false;
    const check = (event, target) => {
      if (done || !target.startsWith(redirectUri)) return;
      done = true;
      if (event && event.preventDefault) event.preventDefault();
      resolve(target);
      setImmediate(() => loginWindow && !loginWindow.isDestroyed() && loginWindow.close());
    };
    const wc = loginWindow.webContents;
    wc.on('will-redirect', (e, target) => check(e, target));
    wc.on('will-navigate', (e, target) => check(e, target));
    wc.on('did-navigate', (e, target) => check(null, target));
    wc.setWindowOpenHandler(({ url: target }) => {
      if (/^https:\/\//.test(target)) shell.openExternal(target);
      return { action: 'deny' };
    });
    loginWindow.on('closed', () => {
      loginWindow = null;
      if (!done) {
        done = true;
        reject(Object.assign(new Error('Sign in was cancelled.'), { name: 'AbortError' }));
      }
    });
    loginWindow.loadURL(url);
  });
}

function send(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

/* ---------- Discord ---------- */

async function refreshPresence() {
  const s = await settings.get();
  discord.configure({ clientId: settings.discordClientId(), enabled: s.discord.enabled });
  const running = [...game.running.values()].sort((a, b) => b.startedAt - a.startedAt)[0];
  discord.set(
    buildActivity({
      state: running ? 'playing' : 'idle',
      instance: running && running.instance,
      startedAt: running && running.startedAt,
      hideInstance: s.discord.hideInstance,
      buttonUrl: s.discord.showButton ? RELEASES_URL : null,
    }),
  );
}

/* ---------- Game events ---------- */

tasks.on('change', (list) => send('tasks', list));
game.on('log', (id, entry) => send('game-log', id, entry));
game.on('state', async (id, state) => {
  send('game-state', id, state);
  refreshPresence().catch(() => {});
  const s = await settings.get();
  if (!win || win.isDestroyed()) return;
  if (state === 'running') {
    if (s.onLaunch === 'minimize') win.minimize();
    else if (s.onLaunch === 'hide') win.hide();
  }
});
/** The crash report from each instance's last crash, so the interface can open it. */
const lastCrash = new Map();

game.on('exit', (id, info) => {
  if (info.crashReport) lastCrash.set(id, info.crashReport);
  else lastCrash.delete(id);
  send('game-exit', id, { ...info, crashReport: Boolean(info.crashReport) });
  if (win && !win.isDestroyed() && game.running.size === 0) {
    if (!win.isVisible()) win.show();
    if (win.isMinimized() && info.crashed) win.restore();
  }
});

/* ---------- Helpers ---------- */

/** Image formats Chromium can decode; the interface crops and resizes them into a PNG icon. */
const IMAGE_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  svg: 'image/svg+xml',
};

async function readImageFile(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const mime = IMAGE_TYPES[ext];
  if (!mime) throw new Error('Use a PNG, JPG, WebP, GIF, BMP, ICO, AVIF or SVG image.');
  const stat = await fsp.stat(file);
  if (stat.size > 25 * 1024 * 1024) throw new Error('That image is too large (over 25 MB).');
  return { mime, data: `data:${mime};base64,${(await fsp.readFile(file)).toString('base64')}` };
}

async function pickFile(filters, { multi = false, title } = {}) {
  const r = await dialog.showOpenDialog(win, {
    title,
    properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
    filters,
  });
  if (r.canceled || !r.filePaths.length) return null;
  return multi ? r.filePaths : r.filePaths[0];
}

const imageCache = new Map();
async function imageData(url) {
  // Mojang still hands out some texture links as http; always fetch them over https.
  url = String(url).replace(/^http:/, 'https:');
  // Only Mojang's own hosts: textures.minecraft.net, mojang.com and its subdomains.
  if (!/^https:\/\/(textures\.minecraft\.net|([a-z0-9-]+\.)*mojang\.com)\//.test(url)) {
    throw new Error('Unsupported image host');
  }
  if (!imageCache.has(url)) {
    if (imageCache.size >= 200) imageCache.delete(imageCache.keys().next().value);
    imageCache.set(url, toDataUrl(await fetchImage(url)));
  }
  return imageCache.get(url);
}

function sourceApi(name) {
  if (name === 'curseforge') return curseforge;
  if (name === 'modrinth') return modrinth;
  throw new Error('Unknown source');
}

async function vanillaVersions(snapshots) {
  const m = await versions.manifest();
  return m.versions
    .filter((v) => v.type === 'release' || (snapshots && v.type === 'snapshot'))
    .map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime }));
}

async function microsoftSkinAction(accountId, fn) {
  const token = await accounts.minecraftToken(accountId);
  await fn(token);
  return accounts.refreshProfile(accountId);
}

/* ---------- API exposed to the interface ---------- */

const api = {
  // App
  'app:info': async () => ({
    version: app.getVersion(),
    platform: process.platform,
    totalMemory: require('node:os').totalmem(),
    dataDir: paths.root,
    packaged: app.isPackaged,
    releasesUrl: RELEASES_URL,
    hasCurseforgeKey: curseforge.hasKey(),
    hasDiscordId: Boolean(settings.discordClientId()),
  }),
  'app:openExternal': async (url) => {
    if (!/^https:\/\//.test(url)) throw new Error('Only https links can be opened.');
    await shell.openExternal(url);
  },
  'app:openFolder': async (kind, id, sub) => {
    let dir = paths.root;
    if (kind === 'instance') dir = sub ? safeJoin(instances.gameDir(id), sub) : instances.gameDir(id);
    if (kind === 'backups') dir = worlds.backupsDir(id);
    await fsp.mkdir(dir, { recursive: true });
    await shell.openPath(dir);
  },

  // Real block textures for instance icons, read from the player's game files.
  'icons:blocks': async () => {
    // The first time, the game files are downloaded; show that in the downloads panel.
    const textures = (await blockTextures.cached())
      ? await blockTextures.load()
      : await tasks.run({ title: 'Block icons (Minecraft 1.21.11)', kind: 'download' }, async (task) => {
          const found = await blockTextures.load({ task });
          // Report a failure in the downloads panel instead of a misleading "Finished".
          if (!Object.keys(found).length) throw new Error("Couldn't download the Minecraft game files. Axiom tries again next start.");
          return found;
        });
    const out = {};
    for (const [key, buf] of Object.entries(textures)) out[key] = `data:image/png;base64,${buf.toString('base64')}`;
    return out;
  },

  // Settings
  'settings:get': () => settings.get(),
  'settings:update': async (changes) => {
    const s = await settings.update(changes);
    curseforge.setApiKey(s.curseforgeKey);
    refreshPresence().catch(() => {});
    return s;
  },

  // Versions and loaders
  'versions:list': (snapshots) => vanillaVersions(snapshots),
  'versions:loaders': async (loader, mcVersion) => {
    if (loader === 'fabric') return (await fabricLoaderVersions(mcVersion)).map((v) => ({ id: v.version, label: v.version, stable: v.stable }));
    if (loader === 'quilt') return (await quiltLoaderVersions(mcVersion)).map((v) => ({ id: v.version, label: v.version, stable: v.stable }));
    if (loader === 'forge') {
      return (await forgeVersions(mcVersion)).map((v) => ({
        id: v.full,
        label: v.version,
        stable: v.recommended,
        tag: v.recommended ? 'Recommended' : v.latest ? 'Latest' : '',
      }));
    }
    return [];
  },

  // Instances
  'instances:list': async () => ({ instances: await instances.list(), states: game.states() }),
  'instances:get': (id) => instances.get(id),
  'instances:create': async (opts) => {
    const s = await settings.get();
    return instances.create({ memory: { min: 512, max: s.defaultMemory }, resolution: s.defaultResolution, ...opts });
  },
  'instances:update': (id, changes) => instances.update(id, changes),
  'instances:remove': async (id) => {
    if (game.state(id) !== 'idle') throw new Error('Stop the game before deleting this instance.');
    await instances.remove(id);
  },
  'instances:duplicate': (id) => instances.duplicate(id),
  'instances:pickIcon': async () => {
    const file = await pickFile([{ name: 'Images', extensions: Object.keys(IMAGE_TYPES) }], { title: 'Choose an icon' });
    if (!file) return null;
    return readImageFile(file);
  },
  'instances:readIcon': (file) => readImageFile(file),

  // Game
  'game:launch': (id, opts) => game.launch(id, opts),
  'game:cancel': (id) => game.cancel(id),
  'game:kill': (id) => game.kill(id),
  'game:log': (id) => game.getLog(id),
  'game:clearLog': (id) => game.clearLog(id),
  'game:repair': (id) => game.repair(id),
  'game:openCrashReport': async (id) => {
    const file = lastCrash.get(id);
    if (!file) throw new Error('There is no crash report for this instance.');
    // Only ever a file inside this instance's crash-reports folder.
    await shell.openPath(safeJoin(safeJoin(instances.gameDir(id), 'crash-reports'), path.basename(file)));
  },

  // Worlds and backups
  'worlds:list': (id) => worlds.list(id),
  'worlds:backups': (id) => worlds.backups(id),
  'worlds:backup': async (id, world) => {
    const inst = await instances.get(id);
    return tasks.run({ title: `Back up ${world} (${inst.name})`, kind: 'backup', ref: id }, () => worlds.backup(id, world));
  },
  'worlds:restore': (id, name) => worlds.restore(id, name),

  // Accounts
  'accounts:list': () => accounts.list(),
  'accounts:setActive': (id) => accounts.setActive(id),
  'accounts:remove': (id) => accounts.remove(id),
  'accounts:addOffline': (name) => accounts.addOffline(name),
  'accounts:loginMicrosoft': async () => {
    if (loginAbort) loginAbort.abort();
    loginAbort = new AbortController();
    try {
      return await accounts.loginMicrosoft((code) => send('login-code', code), loginAbort.signal);
    } finally {
      loginAbort = null;
    }
  },
  'accounts:cancelLogin': () => {
    if (loginAbort) loginAbort.abort();
    if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
  },
  'accounts:loginMicrosoftBrowser': () => accounts.loginMicrosoftBrowser(openLoginWindow),
  'accounts:refresh': (id) => accounts.refreshProfile(id),

  // Ready-made instances and performance mods
  'presets:list': () => presets.listPresets(),
  'presets:install': (id) => {
    const p = presets.PRESETS[id];
    return tasks.run({ title: p ? p.name : 'Preset', kind: 'modpack' }, (task) => presets.installPreset(id, { instances, content }, task));
  },
  'presets:performance': async (id) => {
    const inst = await instances.get(id);
    return tasks.run({ title: `Performance mods → ${inst.name}`, kind: 'mod' }, (task) => presets.installPerformanceMods(id, { instances, content }, task));
  },

  // Content (mods, resource packs, shaders)
  'content:list': (id, type) => content.list(id, type),
  'content:toggle': (id, type, file, enable) => content.toggle(id, type, file, enable),
  'content:remove': (id, type, file) => content.remove(id, type, file),
  'content:install': async (opts) => {
    const inst = await instances.get(opts.instanceId);
    return tasks.run({ title: `${opts.title || 'Mod'} → ${inst.name}`, kind: 'mod', icon: opts.icon || null }, (task) =>
      content.install(opts, task),
    );
  },
  'content:addFiles': async (id, type, files) => {
    if (!files) {
      const ext = type === 'mod' ? ['jar'] : ['zip'];
      files = await pickFile([{ name: 'Files', extensions: ext }], { multi: true });
      if (!files) return false;
    }
    await content.addFiles(id, type, files);
    return true;
  },
  'content:checkUpdates': (id, type) => content.checkUpdates(id, type),

  // Browsing
  'browse:search': (source, params) => sourceApi(source).search(params),
  'browse:project': (source, id) => sourceApi(source).project(id),
  'browse:versions': (source, id, filters) => sourceApi(source).versions(id, filters || {}),

  // Modpacks
  'modpacks:import': async (file) => {
    if (!file) {
      file = await pickFile([{ name: 'Modpacks', extensions: ['mrpack', 'zip'] }], { title: 'Import a modpack or instance' });
      if (!file) return null;
    }
    return tasks.run({ title: `Import ${path.basename(file)}`, kind: 'modpack' }, (task) => modpacks.importFile(file, task));
  },
  'modpacks:install': (opts) =>
    tasks.run({ title: opts.title || 'Modpack', kind: 'modpack', icon: opts.icon || null }, (task) => modpacks.installFromSource(opts, task)),
  'modpacks:checkUpdate': (id) => modpacks.checkUpdate(id),
  'modpacks:update': async (id, versionId) => {
    const inst = await instances.get(id);
    return tasks.run({ title: `Update ${inst.name}`, kind: 'modpack' }, (task) => modpacks.update(id, versionId, task));
  },
  'modpacks:export': async (id, opts) => {
    const inst = await instances.get(id);
    const r = await dialog.showSaveDialog(win, {
      title: 'Export as Modrinth pack',
      defaultPath: `${inst.name}.mrpack`,
      filters: [{ name: 'Modrinth pack', extensions: ['mrpack'] }],
    });
    if (r.canceled || !r.filePath) return null;
    await modpacks.exportMrpack(id, r.filePath, opts);
    shell.showItemInFolder(r.filePath);
    return r.filePath;
  },

  // Skins
  'skins:library': () => skinLibrary.list(),
  'skins:addFile': async (name, variant) => {
    const file = await pickFile([{ name: 'Skin', extensions: ['png'] }], { title: 'Choose a skin' });
    if (!file) return null;
    return skinLibrary.add({ name: name || path.basename(file, '.png'), variant, data: await fsp.readFile(file) });
  },
  'skins:addUsername': async (username) => {
    const s = await skinByUsername(username);
    return skinLibrary.add({ name: s.name, variant: s.variant, data: s.data });
  },
  'skins:addCurrent': async (accountId) => {
    const list = await accounts.list();
    const acc = list.find((a) => a.id === accountId);
    if (!acc || !acc.skin) throw new Error('This account has no custom skin.');
    return skinLibrary.add({ name: `${acc.name}'s skin`, variant: acc.skin.variant, data: await fetchImage(acc.skin.url) });
  },
  'skins:update': (id, changes) => skinLibrary.update(id, changes),
  'skins:remove': (id) => skinLibrary.remove(id),
  'skins:apply': async (skinId, accountId, variant) => {
    const skin = await skinLibrary.read(skinId);
    return microsoftSkinAction(accountId, (token) => uploadSkin(token, skin.buffer, variant || skin.variant));
  },
  'skins:reset': (accountId) => microsoftSkinAction(accountId, resetSkin),
  'skins:setCape': (accountId, capeId) => microsoftSkinAction(accountId, (token) => setCape(token, capeId)),
  'skins:image': (url) => imageData(url),

  // Downloads panel
  'tasks:list': () => tasks.list(),
  'tasks:cancel': (id) => tasks.cancel(id),
  'tasks:clear': () => tasks.clearFinished(),

  // Java
  'java:installed': () => java.installedRuntimes(),
  'java:removeAll': () => java.removeRuntimes(),
  'java:pick': async () => {
    const exe = process.platform === 'win32' ? ['exe'] : ['*'];
    const file = await pickFile([{ name: 'Java', extensions: exe }], { title: 'Choose java.exe or javaw.exe' });
    if (!file) return null;
    const major = await java.probe(file);
    if (!major) throw new Error('That file is not a working Java.');
    return { path: file, major };
  },

  // Window
  'window:minimize': () => win && win.minimize(),
  'window:maximize': () => win && (win.isMaximized() ? win.unmaximize() : win.maximize()),
  'window:close': () => win && win.close(),
};

ipcMain.handle('api', async (event, method, ...args) => {
  if (!win || event.sender !== win.webContents) return { ok: false, error: { message: 'Not allowed' } };
  // Own properties only, so names like "constructor" or "toString" are never callable.
  const fn = typeof method === 'string' && Object.hasOwn(api, method) ? api[method] : null;
  if (!fn) return { ok: false, error: { message: `Unknown method ${method}` } };
  try {
    return { ok: true, data: await fn(...args) };
  } catch (err) {
    return {
      ok: false,
      error: { message: (err && err.message) || String(err), code: err && err.code, openUrl: err && err.openUrl, cancelled: err && err.name === 'AbortError' },
    };
  }
});

/* ---------- Window ---------- */

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    frame: false,
    show: false,
    backgroundColor: '#06090d',
    title: 'Axiom',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('maximize', () => send('window-state', { maximized: true }));
  win.on('unmaximize', () => send('window-state', { maximized: false }));

  // Never navigate the launcher window itself; open links in the browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) {
      e.preventDefault();
      if (/^https:\/\//.test(url)) shell.openExternal(url);
    }
  });
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

app.whenReady().then(async () => {
  // The launcher never needs the camera, microphone, location or notifications from web content.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
  const s = await settings.load();
  curseforge.setApiKey(s.curseforgeKey);
  createWindow();
  refreshPresence().catch(() => {});
  setupUpdater({ send, enabled: app.isPackaged && s.autoUpdate, api });
});

app.on('window-all-closed', () => {
  discord.destroy();
  app.quit();
});
