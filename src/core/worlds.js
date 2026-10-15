'use strict';
const path = require('node:path');
const fsp = require('node:fs/promises');
const { safeJoin, exists } = require('./util');

/** Total size of a folder, stopping early on huge worlds so listing stays quick. */
async function folderSize(dir, budget = { files: 20000 }) {
  let total = 0;
  let entries = [];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    if (budget.files-- <= 0) break;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await folderSize(p, budget);
    else if (e.isFile()) total += (await fsp.stat(p).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

/** A backup folder name: the world, then a sortable timestamp. */
function backupName(world, date = new Date()) {
  const stamp = date.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  return `${world} @ ${stamp}`;
}

/**
 * Lists an instance's worlds and keeps copies of them. Backups live next to
 * the game folder (instances/<id>/backups), so a pack update or a broken mod
 * never touches them.
 */
class WorldManager {
  constructor(instances) {
    this.instances = instances;
  }

  savesDir(id) {
    return path.join(this.instances.gameDir(id), 'saves');
  }

  backupsDir(id) {
    return path.join(this.instances.dir(id), 'backups');
  }

  async list(id) {
    const saves = this.savesDir(id);
    let dirs = [];
    try {
      dirs = await fsp.readdir(saves, { withFileTypes: true });
    } catch {
      return [];
    }
    const backups = await this.backups(id);
    const out = [];
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const dir = path.join(saves, d.name);
      const level = path.join(dir, 'level.dat');
      if (!(await exists(level))) continue;
      const { mtimeMs } = await fsp.stat(level);
      let icon = null;
      try {
        const buf = await fsp.readFile(path.join(dir, 'icon.png'));
        if (buf.length < 256 * 1024) icon = `data:image/png;base64,${buf.toString('base64')}`;
      } catch {}
      out.push({
        folder: d.name,
        lastPlayed: mtimeMs,
        size: await folderSize(dir),
        icon,
        backups: backups.filter((b) => b.world === d.name).length,
      });
    }
    return out.sort((a, b) => b.lastPlayed - a.lastPlayed);
  }

  /** Copies a world into the backups folder. session.lock is held open by a running game, so it is skipped. */
  async backup(id, world) {
    const src = safeJoin(this.savesDir(id), world);
    if (!(await exists(path.join(src, 'level.dat')))) throw new Error('That world no longer exists.');
    const name = backupName(world);
    const dest = safeJoin(this.backupsDir(id), name);
    await fsp.mkdir(this.backupsDir(id), { recursive: true });
    try {
      await fsp.cp(src, dest, { recursive: true, filter: (p) => path.basename(p) !== 'session.lock' });
    } catch (err) {
      await fsp.rm(dest, { recursive: true, force: true }).catch(() => {});
      throw err;
    }
    return { name, world };
  }

  async backups(id) {
    let dirs = [];
    try {
      dirs = await fsp.readdir(this.backupsDir(id), { withFileTypes: true });
    } catch {
      return [];
    }
    const out = [];
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const at = d.name.lastIndexOf(' @ ');
      if (at === -1) continue;
      const { mtimeMs } = await fsp.stat(path.join(this.backupsDir(id), d.name));
      out.push({ name: d.name, world: d.name.slice(0, at), createdAt: mtimeMs });
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Restores a backup as a new world next to the original, so nothing is ever overwritten. */
  async restore(id, name) {
    const src = safeJoin(this.backupsDir(id), name);
    const at = name.lastIndexOf(' @ ');
    if (at === -1 || !(await exists(src))) throw new Error('That backup no longer exists.');
    const world = name.slice(0, at);
    let folder = `${world} (restored)`;
    for (let i = 2; await exists(path.join(this.savesDir(id), folder)); i++) folder = `${world} (restored ${i})`;
    await fsp.mkdir(this.savesDir(id), { recursive: true });
    await fsp.cp(src, safeJoin(this.savesDir(id), folder), { recursive: true });
    return { folder };
  }
}

module.exports = { WorldManager, backupName };
