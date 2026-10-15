'use strict';
const path = require('node:path');
const fsp = require('node:fs/promises');
const { spawn } = require('node:child_process');
const endpoints = require('./endpoints');
const { getJson, downloadAll } = require('./http');
const { readJson, writeJson, exists, safeJoin } = require('./util');

/** Mojang's platform names for its Java runtime manifest. */
function runtimePlatform() {
  const arch = process.arch;
  if (process.platform === 'win32') return arch === 'ia32' ? 'windows-x86' : arch === 'arm64' ? 'windows-arm64' : 'windows-x64';
  if (process.platform === 'darwin') return arch === 'arm64' ? 'mac-os-arm64' : 'mac-os';
  return arch === 'ia32' ? 'linux-i386' : 'linux';
}

/** Which Java a version wants. Versions without javaVersion predate it and use Java 8. */
function requiredJava(version) {
  const jv = version.javaVersion;
  return {
    component: (jv && jv.component) || 'jre-legacy',
    majorVersion: (jv && jv.majorVersion) || 8,
  };
}

function javaBinary(home, { console = false } = {}) {
  if (process.platform === 'win32') return path.join(home, 'bin', console ? 'java.exe' : 'javaw.exe');
  if (process.platform === 'darwin') return path.join(home, 'jre.bundle', 'Contents', 'Home', 'bin', 'java');
  return path.join(home, 'bin', 'java');
}

const MARKER = '.axiom-runtime.json';
/** Written by versions released as Obsidian; still read so their Java is not downloaded again. */
const LEGACY_MARKER = '.obsidian-runtime.json';

async function readMarker(home) {
  return (await readJson(path.join(home, MARKER), null)) || readJson(path.join(home, LEGACY_MARKER), null);
}

class JavaService {
  constructor(paths) {
    this.paths = paths;
    this._index = null;
  }

  async index() {
    if (!this._index) this._index = await getJson(endpoints.javaRuntimes);
    return this._index;
  }

  runtimeHome(component) {
    return path.join(this.paths.runtimes, component);
  }

  /**
   * Ensures Mojang's Java runtime for component is installed and returns the
   * path of the java executable. Already installed runtimes are reused offline.
   */
  async ensureRuntime(component, task, { console: wantConsole = false } = {}) {
    const home = this.runtimeHome(component);
    const marker = path.join(home, MARKER);
    const installed = await readMarker(home);

    let index;
    try {
      index = await this.index();
    } catch (err) {
      if (installed && (await exists(javaBinary(home)))) return javaBinary(home, { console: wantConsole });
      throw err;
    }

    let platform = runtimePlatform();
    let entries = index[platform] && index[platform][component];
    // Windows on ARM can run x64 Java through emulation when no native build exists.
    if ((!entries || !entries.length) && platform === 'windows-arm64') {
      platform = 'windows-x64';
      entries = index[platform] && index[platform][component];
    }
    if (!entries || !entries.length) {
      throw new Error(`Mojang has no Java runtime "${component}" for ${platform}. Set a custom Java path in Settings.`);
    }
    const entry = entries[0];
    if (installed && installed.version === entry.version.name && (await exists(javaBinary(home)))) {
      return javaBinary(home, { console: wantConsole });
    }

    task.setStage(`Downloading Java ${entry.version.name}`);
    const manifest = await getJson(entry.manifest.url, { signal: task.signal });
    const items = [];
    const executables = [];
    const links = [];
    for (const [rel, info] of Object.entries(manifest.files)) {
      const target = safeJoin(home, rel);
      if (info.type === 'directory') {
        await fsp.mkdir(target, { recursive: true });
      } else if (info.type === 'file') {
        const raw = info.downloads.raw;
        items.push({ url: raw.url, path: target, sha1: raw.sha1, size: raw.size });
        if (info.executable) executables.push(target);
      } else if (info.type === 'link') {
        links.push({ target, to: info.target });
      }
    }
    task.reset(`Downloading Java ${entry.version.name}`);
    await downloadAll(items, task, { verify: false });

    if (process.platform !== 'win32') {
      for (const f of executables) await fsp.chmod(f, 0o755).catch(() => {});
      for (const l of links) {
        await fsp.rm(l.target, { force: true });
        await fsp.symlink(l.to, l.target).catch(() => {});
      }
    }
    await writeJson(marker, { component, version: entry.version.name, platform });
    return javaBinary(home, { console: wantConsole });
  }

  /** Runs `java -version` and returns the major version, or null if it fails. */
  async probe(javaPath) {
    const exe = process.platform === 'win32' ? javaPath.replace(/javaw\.exe$/i, 'java.exe') : javaPath;
    return new Promise((resolve) => {
      let out = '';
      let child;
      try {
        child = spawn(exe, ['-version'], { windowsHide: true });
      } catch {
        return resolve(null);
      }
      child.stderr.on('data', (d) => (out += d));
      child.stdout.on('data', (d) => (out += d));
      child.on('error', () => resolve(null));
      child.on('close', () => {
        const m = out.match(/version "(\d+)(?:\.(\d+))?/);
        if (!m) return resolve(null);
        const major = Number(m[1]) === 1 ? Number(m[2]) : Number(m[1]);
        resolve(major);
      });
    });
  }

  async installedRuntimes() {
    try {
      const out = [];
      for (const name of await fsp.readdir(this.paths.runtimes)) {
        const info = await readMarker(this.runtimeHome(name));
        if (info) out.push(info);
      }
      return out;
    } catch {
      return [];
    }
  }

  async removeRuntimes() {
    await fsp.rm(this.paths.runtimes, { recursive: true, force: true });
  }
}

module.exports = { JavaService, requiredJava, runtimePlatform, javaBinary };
