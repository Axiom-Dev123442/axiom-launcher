'use strict';
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { currentEnv } = require('./rules');
const { installVersion } = require('./install');
const { requiredJava } = require('./java');
const { buildLaunchArgs, spawnGame, redactArgs } = require('./launch');
const { installFabric } = require('./loaders/fabric');
const { installForge } = require('./loaders/forge');
const { exists } = require('./util');

const LOG_LIMIT = 5000;

/**
 * Prepares and launches instances, and keeps track of running games.
 * Emits: 'log' (id, line), 'state' (id, state), 'exit' (id, info).
 */
class GameManager extends EventEmitter {
  constructor({ paths, versions, java, instances, accounts, settings, tasks, launcherVersion }) {
    super();
    Object.assign(this, { paths, versions, java, instances, accounts, settings, tasks, launcherVersion });
    this.running = new Map();
    this.preparing = new Map();
    this.logs = new Map();
  }

  state(id) {
    if (this.running.has(id)) return 'running';
    if (this.preparing.has(id)) return 'preparing';
    return 'idle';
  }

  states() {
    const out = {};
    for (const id of this.preparing.keys()) out[id] = 'preparing';
    for (const id of this.running.keys()) out[id] = 'running';
    return out;
  }

  getLog(id) {
    return this.logs.get(id) || [];
  }

  clearLog(id) {
    this.logs.set(id, []);
  }

  _log(id, text, kind = 'out') {
    const lines = this.logs.get(id) || [];
    for (const line of String(text).split(/\r?\n/)) {
      if (!line) continue;
      lines.push({ t: Date.now(), kind, line });
      this.emit('log', id, { kind, line });
    }
    if (lines.length > LOG_LIMIT) lines.splice(0, lines.length - LOG_LIMIT);
    this.logs.set(id, lines);
  }

  /** Makes sure the loader profile for an instance exists and returns the version id to launch. */
  async _ensureLoader(inst, task) {
    if (inst.loader === 'vanilla') return inst.mcVersion;
    if (inst.versionId && (await exists(this.paths.versionJson(inst.versionId)))) return inst.versionId;

    let versionId;
    let installedLoaderVersion;
    if (inst.loader === 'fabric') {
      task.setStage('Installing Fabric');
      versionId = await installFabric({ mcVersion: inst.mcVersion, loaderVersion: inst.loaderVersion, paths: this.paths, task });
      installedLoaderVersion = versionId.replace(/^fabric-loader-/, '').replace(new RegExp(`-${inst.mcVersion.replace(/\./g, '\\.')}$`), '');
    } else if (inst.loader === 'forge') {
      task.setStage('Installing Forge');
      versionId = await installForge({
        mcVersion: inst.mcVersion,
        forgeVersion: inst.loaderVersion,
        paths: this.paths,
        versions: this.versions,
        java: this.java,
        task,
        onLog: (s) => this._log(inst.id, s, 'installer'),
      });
      const m = versionId.match(/forge-?(.+)$/i);
      installedLoaderVersion = m ? m[1].replace(new RegExp(`-${inst.mcVersion.replace(/\./g, '\\.')}$`), '') : null;
    } else {
      throw new Error(`Unsupported loader ${inst.loader}`);
    }
    await this.instances.update(inst.id, { versionId, installedLoaderVersion });
    return versionId;
  }

  /** Installs everything an instance needs without starting it. Returns what launch needs. */
  async prepare(id, task, { verify = false } = {}) {
    const inst = await this.instances.get(id);
    const settings = await this.settings.get();
    const gameDir = this.instances.gameDir(id);

    try {
      await this.versions.manifest();
    } catch {
      // Offline: already installed versions still work from disk.
    }
    const versionId = await this._ensureLoader(inst, task);
    task.setStage('Reading version info');
    const version = await this.versions.resolve(versionId, task);

    let javaPath = inst.javaPath || settings.javaPath;
    let javaMajor = 8;
    if (javaPath) {
      javaMajor = (await this.java.probe(javaPath)) || 8;
    } else {
      const req = requiredJava(version);
      javaPath = await this.java.ensureRuntime(req.component, task);
      javaMajor = req.majorVersion;
    }

    const install = await installVersion({
      version,
      paths: this.paths,
      env: currentEnv(),
      task,
      gameDir,
      verify,
      concurrency: settings.concurrency,
    });
    return { inst: await this.instances.get(id), version, install, javaPath, javaMajor, gameDir };
  }

  async launch(id, { accountId, joinServer } = {}) {
    if (this.running.has(id)) throw new Error('This instance is already running.');
    if (this.preparing.has(id)) throw new Error('This instance is already starting.');
    const inst0 = await this.instances.get(id);
    const task = this.tasks.create({ title: inst0.name, kind: 'launch', ref: id });
    this.preparing.set(id, task);
    this.emit('state', id, 'preparing');
    this.clearLog(id);
    try {
      task.setStage('Signing in');
      const account = await this.accounts.launchAccount(accountId);
      const prepared = await this.prepare(id, task);
      const { inst, version, install, javaPath, javaMajor, gameDir } = prepared;

      const args = buildLaunchArgs({
        version,
        install,
        account,
        instance: { ...inst, joinServer },
        gameDir,
        env: currentEnv(),
        launcherVersion: this.launcherVersion,
      });

      task.setStage('Starting Minecraft');
      this._log(id, `Obsidian ${this.launcherVersion} launching ${version.id} as ${account.name} (${account.type})`, 'launcher');
      this._log(id, `Java: ${javaPath}`, 'launcher');
      this._log(id, `Command: ${redactArgs(args, account).join(' ').slice(0, 4000)}`, 'launcher');

      const child = await spawnGame({ javaPath, args, cwd: gameDir, javaMajor, tempDir: path.join(this.paths.cache, 'launch') });
      const startedAt = Date.now();
      this.running.set(id, { child, startedAt, instance: inst });
      this.preparing.delete(id);
      task.finish('Running');
      this.emit('state', id, 'running', { startedAt, instance: inst });

      child.stdout.on('data', (d) => this._log(id, d.toString(), 'out'));
      child.stderr.on('data', (d) => this._log(id, d.toString(), 'err'));
      child.on('error', (err) => this._log(id, `Failed to start Java: ${err.message}`, 'launcher'));
      child.on('close', async (code) => {
        this.running.delete(id);
        const seconds = Math.round((Date.now() - startedAt) / 1000);
        try {
          const cur = await this.instances.get(id);
          await this.instances.update(id, { playtime: (cur.playtime || 0) + seconds, lastPlayed: Date.now() });
        } catch {}
        this._log(id, `Minecraft exited with code ${code}`, 'launcher');
        this.emit('state', id, 'idle');
        this.emit('exit', id, { code, seconds, crashed: code !== 0 && code !== null && seconds > 0 });
      });

      await this.instances.update(id, { lastPlayed: Date.now() });
      await this.settings.update({ lastInstance: id });
      return { startedAt };
    } catch (err) {
      this.preparing.delete(id);
      task.fail(err);
      this._log(id, `Launch failed: ${err.message}`, 'launcher');
      this.emit('state', id, 'idle');
      throw err;
    }
  }

  cancel(id) {
    const task = this.preparing.get(id);
    if (task) task.cancel();
  }

  kill(id) {
    const run = this.running.get(id);
    if (run) run.child.kill();
  }

  /** Re-checks every file of an instance against its checksum. */
  async repair(id) {
    const inst = await this.instances.get(id);
    return this.tasks.run({ title: `Repair ${inst.name}`, kind: 'repair', ref: id }, async (task) => {
      await this.instances.update(id, { versionId: null });
      await this.prepare(id, task, { verify: true });
    });
  }
}

module.exports = { GameManager };
