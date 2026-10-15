'use strict';
const path = require('node:path');
const fsp = require('node:fs/promises');
const { spawn } = require('node:child_process');
const endpoints = require('../endpoints');
const { request, getJson, downloadFile, downloadAll } = require('../http');
const { writeJson, exists, mavenPath, sha1File, compareVersions } = require('../util');
const { withZip } = require('../zip');
const { requiredJava } = require('../java');
const { fixRepoUrl } = require('../install');

let metadataCache = null;

async function allForgeVersions() {
  if (metadataCache) return metadataCache;
  const res = await request(`${endpoints.forgeMaven}/net/minecraftforge/forge/maven-metadata.xml`);
  const xml = await res.text();
  metadataCache = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);
  return metadataCache;
}

/**
 * Forge builds for a Minecraft version, newest first. Each has the full maven
 * version (used to install) and the short Forge number (shown to people).
 */
async function forgeVersions(mcVersion) {
  const all = await allForgeVersions();
  let promos = {};
  try {
    promos = (await getJson(endpoints.forgePromotions, { retries: 1 })).promos || {};
  } catch {}
  const recommended = promos[`${mcVersion}-recommended`];
  const latest = promos[`${mcVersion}-latest`];
  return all
    .filter((v) => v.startsWith(`${mcVersion}-`))
    .map((full) => {
      const forge = full.slice(mcVersion.length + 1).replace(new RegExp(`-${mcVersion.replace(/\./g, '\\.')}$`), '');
      return { full, version: forge, recommended: forge === recommended, latest: forge === latest };
    })
    .sort((a, b) => compareVersions(b.version, a.version));
}

async function pickForgeVersion(mcVersion) {
  const list = await forgeVersions(mcVersion);
  if (!list.length) throw new Error(`Forge does not support Minecraft ${mcVersion}`);
  return (list.find((v) => v.recommended) || list.find((v) => v.latest) || list[0]).full;
}

function libPath(paths, coord) {
  return path.join(paths.libraries, mavenPath(coord));
}

async function mainClassOf(jar) {
  return withZip(jar, async (zip) => {
    const mf = await zip.readText('META-INF/MANIFEST.MF');
    const m = mf.match(/^Main-Class:\s*(.+?)\s*$/m);
    if (!m) throw new Error(`No Main-Class in ${jar}`);
    return m[1];
  });
}

function runJava(javaPath, args, { cwd, signal, onLog }) {
  return new Promise((resolve, reject) => {
    const child = spawn(javaPath, args, { cwd, windowsHide: true });
    let tail = '';
    const onData = (d) => {
      const s = d.toString();
      tail = (tail + s).slice(-4000);
      if (onLog) onLog(s);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const abort = () => child.kill();
    if (signal) signal.addEventListener('abort', abort, { once: true });
    child.on('error', reject);
    child.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', abort);
      if (signal && signal.aborted) return reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' }));
      if (code === 0) resolve();
      else reject(new Error(`Forge installer step failed (exit ${code}):\n${tail}`));
    });
  });
}

/**
 * Installs Forge for an instance and returns the version id to launch.
 * forgeVersion is the full maven version such as "1.20.1-47.2.0".
 */
async function installForge({ mcVersion, forgeVersion, paths, versions, java, task, onLog }) {
  if (!forgeVersion) forgeVersion = await pickForgeVersion(mcVersion);

  const installer = path.join(paths.cache, 'forge', `forge-${forgeVersion}-installer.jar`);
  if (!(await exists(installer))) {
    task.setStage('Downloading Forge installer');
    await downloadFile(
      `${endpoints.forgeMaven}/net/minecraftforge/forge/${forgeVersion}/forge-${forgeVersion}-installer.jar`,
      installer,
      { signal: task.signal },
    );
  }

  return withZip(installer, async (zip) => {
    const profile = await zip.readJson('install_profile.json');
    if (zip.has('version.json')) {
      return installModern({ zip, profile, installer, mcVersion, paths, versions, java, task, onLog });
    }
    return installLegacy({ zip, profile, mcVersion, paths });
  });
}

async function installLegacy({ zip, profile, mcVersion, paths }) {
  const info = profile.versionInfo;
  if (!info || !profile.install) throw new Error('Unsupported Forge installer format');
  const json = { ...info };
  if (!json.inheritsFrom) json.inheritsFrom = mcVersion;
  if (!json.jar) json.jar = mcVersion;
  json.libraries = (json.libraries || []).map((lib) => (lib.url ? { ...lib, url: fixRepoUrl(lib.url) } : lib));

  const target = libPath(paths, profile.install.path);
  if (!(await exists(target))) {
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, await zip.read(profile.install.filePath));
  }
  await writeJson(paths.versionJson(json.id), json);
  return json.id;
}

async function installModern({ zip, profile, installer, mcVersion, paths, versions, java, task, onLog }) {
  const versionJson = await zip.readJson('version.json');
  const id = versionJson.id;

  task.setStage('Preparing Minecraft');
  const vanilla = await versions.resolve(mcVersion, task);
  const vanillaJar = paths.versionJar(mcVersion);
  const client = vanilla.downloads.client;

  // Files bundled inside the installer (the Forge jars themselves).
  await zip.extractTo(paths.libraries, { prefix: 'maven/', overwrite: false });

  const items = [{ url: client.url, path: vanillaJar, sha1: client.sha1, size: client.size }];
  for (const lib of [...(profile.libraries || []), ...(versionJson.libraries || [])]) {
    const art = lib.downloads && lib.downloads.artifact;
    const file = path.join(paths.libraries, (art && art.path) || mavenPath(lib.name));
    if (art && art.url) items.push({ url: art.url, path: file, sha1: art.sha1, size: art.size });
  }
  task.reset('Downloading Forge libraries');
  await downloadAll(items, task);

  const tmp = path.join(paths.cache, 'forge', `tmp-${Date.now()}`);
  try {
    const data = {
      SIDE: 'client',
      MINECRAFT_JAR: vanillaJar,
      MINECRAFT_VERSION: mcVersion,
      ROOT: paths.root,
      INSTALLER: installer,
      LIBRARY_DIR: paths.libraries,
    };
    for (const [key, value] of Object.entries(profile.data || {})) {
      const v = value.client;
      if (v == null) continue;
      if (v.startsWith('[') && v.endsWith(']')) {
        data[key] = libPath(paths, v.slice(1, -1));
      } else if (v.startsWith("'") && v.endsWith("'")) {
        data[key] = v.slice(1, -1);
      } else if (v.startsWith('/')) {
        const out = path.join(tmp, v.slice(1));
        await fsp.mkdir(path.dirname(out), { recursive: true });
        await fsp.writeFile(out, await zip.read(v.slice(1)));
        data[key] = out;
      } else {
        data[key] = v;
      }
    }

    const resolveArg = (a) => {
      if (a.startsWith('[') && a.endsWith(']')) return libPath(paths, a.slice(1, -1));
      return a.replace(/\{(\w+)\}/g, (whole, key) => (key in data ? data[key] : whole));
    };
    const unquote = (s) => (s.startsWith("'") && s.endsWith("'") ? s.slice(1, -1) : s);

    const processors = (profile.processors || []).filter((p) => !p.sides || p.sides.includes('client'));
    if (processors.length) {
      const { component } = requiredJava(vanilla);
      const javaPath = await java.ensureRuntime(component, task, { console: true });
      task.reset('Running Forge installer');
      task.addTotal(processors.length);
      for (const p of processors) {
        task.throwIfCancelled();
        const outputs = Object.entries(p.outputs || {}).map(([f, h]) => [resolveArg(f), unquote(resolveArg(h))]);
        let upToDate = outputs.length > 0;
        for (const [file, hash] of outputs) {
          if (!(await exists(file)) || (await sha1File(file)) !== hash) {
            upToDate = false;
            break;
          }
        }
        if (!upToDate) {
          const jar = libPath(paths, p.jar);
          const cp = [jar, ...(p.classpath || []).map((c) => libPath(paths, c))];
          const mainClass = await mainClassOf(jar);
          const args = (p.args || []).map(resolveArg);
          const sep = process.platform === 'win32' ? ';' : ':';
          await runJava(javaPath, ['-cp', cp.join(sep), mainClass, ...args], { cwd: tmp, signal: task.signal, onLog });
          for (const [file, hash] of outputs) {
            if ((await sha1File(file)) !== hash) throw new Error(`Forge produced a corrupt file: ${path.basename(file)}`);
          }
        }
        task.addDone(1);
      }
    }
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }

  await writeJson(paths.versionJson(id), versionJson);
  return id;
}

module.exports = { forgeVersions, pickForgeVersion, installForge };
