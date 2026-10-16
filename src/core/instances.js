'use strict';
const path = require('node:path');
const fsp = require('node:fs/promises');
const { readJson, writeJson, exists, slugify, withLock, lockKey } = require('./util');

const DEFAULTS = {
  icon: { type: 'preset', value: 'diamond' },
  loader: 'vanilla',
  loaderVersion: null,
  versionId: null,
  memory: { min: 512, max: 4096 },
  jvmArgs: '',
  resolution: { width: 0, height: 0 },
  fullscreen: false,
  javaPath: '',
  playtime: 0,
  lastPlayed: 0,
  modpack: null,
};

class InstanceStore {
  constructor(paths) {
    this.paths = paths;
  }

  dir(id) {
    if (!/^[a-z0-9-]+$/.test(id)) throw new Error('Invalid instance id');
    return path.join(this.paths.instances, id);
  }

  gameDir(id) {
    return path.join(this.dir(id), 'minecraft');
  }

  file(id) {
    return path.join(this.dir(id), 'instance.json');
  }

  async list() {
    let ids = [];
    try {
      ids = await fsp.readdir(this.paths.instances);
    } catch {}
    const out = [];
    for (const id of ids) {
      if (!/^[a-z0-9-]+$/.test(id)) continue;
      const inst = await readJson(this.file(id), null);
      if (inst) out.push({ ...DEFAULTS, ...inst, id });
    }
    return out.sort((a, b) => (b.lastPlayed || b.created || 0) - (a.lastPlayed || a.created || 0));
  }

  async get(id) {
    const inst = await readJson(this.file(id), null);
    if (!inst) throw new Error('That instance no longer exists.');
    return { ...DEFAULTS, ...inst, id };
  }

  async _uniqueId(name) {
    const base = slugify(name);
    let id = base;
    for (let i = 2; await exists(this.dir(id)); i++) id = `${base}-${i}`;
    return id;
  }

  async create(opts) {
    const name = String(opts.name || '').trim() || `Minecraft ${opts.mcVersion}`;
    if (!opts.mcVersion) throw new Error('Pick a Minecraft version.');
    const id = await this._uniqueId(name);
    const inst = {
      ...DEFAULTS,
      ...opts,
      id,
      name: name.slice(0, 48),
      created: Date.now(),
    };
    await fsp.mkdir(this.gameDir(id), { recursive: true });
    await writeJson(this.file(id), inst);
    return inst;
  }

  /**
   * Saves changes to an instance. changes may be a function of the current
   * instance, for updates that build on its latest saved values.
   */
  async update(id, changes) {
    return withLock(lockKey(this.file(id)), () => this._update(id, changes));
  }

  async _update(id, changeArg) {
    const inst = await this.get(id);
    const changes = typeof changeArg === 'function' ? changeArg(inst) : changeArg;
    const next = { ...inst, ...changes, id };
    // Changing version or loader means the installed loader profile no longer applies.
    if (
      ('mcVersion' in changes && changes.mcVersion !== inst.mcVersion) ||
      ('loader' in changes && changes.loader !== inst.loader) ||
      ('loaderVersion' in changes && changes.loaderVersion !== inst.loaderVersion)
    ) {
      next.versionId = null;
    }
    if (next.name) next.name = String(next.name).slice(0, 48);
    await writeJson(this.file(id), next);
    return next;
  }

  async remove(id) {
    await fsp.rm(this.dir(id), { recursive: true, force: true });
  }

  async duplicate(id) {
    const inst = await this.get(id);
    const newId = await this._uniqueId(`${inst.name} copy`);
    await fsp.cp(this.dir(id), this.dir(newId), { recursive: true });
    const copy = { ...inst, id: newId, name: `${inst.name} (copy)`.slice(0, 48), created: Date.now(), playtime: 0, lastPlayed: 0 };
    await writeJson(this.file(newId), copy);
    return copy;
  }
}

module.exports = { InstanceStore, INSTANCE_DEFAULTS: DEFAULTS };
