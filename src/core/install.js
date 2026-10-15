'use strict';
const path = require('node:path');
const fsp = require('node:fs/promises');
const endpoints = require('./endpoints');
const { isAllowed } = require('./rules');
const { downloadAll, downloadFile, needsDownload } = require('./http');
const { mavenPath, readJson, exists } = require('./util');
const { withZip } = require('./zip');

function withSlash(url) {
  return url.endsWith('/') ? url : `${url}/`;
}

/** Old Forge metadata points at hosts that no longer exist. */
function fixRepoUrl(url) {
  return url
    .replace(/^https?:\/\/files\.minecraftforge\.net\/maven\/?/, withSlash(endpoints.forgeMaven))
    .replace(/^http:\/\/(?!127\.0\.0\.1|localhost)/, 'https://');
}

function nativeArch() {
  return process.arch === 'ia32' ? '32' : '64';
}

/**
 * Works out every file a version needs from its libraries.
 * Returns { classpath, downloads, natives } with absolute paths.
 */
function collectLibraries(version, env, paths) {
  const classpath = [];
  const downloads = [];
  const natives = [];
  const libDir = paths.libraries;

  for (const lib of version.libraries || []) {
    if (!isAllowed(lib.rules, env)) continue;
    if (lib.clientreq === false) continue;
    const dl = lib.downloads || {};
    const classifier = lib.natives && lib.natives[env.os];

    if (dl.artifact) {
      const rel = dl.artifact.path || mavenPath(lib.name);
      const file = path.join(libDir, rel);
      if (dl.artifact.url) downloads.push({ url: dl.artifact.url, path: file, sha1: dl.artifact.sha1, size: dl.artifact.size });
      classpath.push(file);
    } else if (!lib.natives) {
      const rel = mavenPath(lib.name);
      const file = path.join(libDir, rel);
      const base = lib.url ? fixRepoUrl(withSlash(lib.url)) : endpoints.libraries;
      downloads.push({ url: withSlash(base) + rel, path: file, sha1: lib.sha1, size: lib.size });
      classpath.push(file);
    }

    if (classifier) {
      const cls = classifier.replace('${arch}', nativeArch());
      const art = dl.classifiers && dl.classifiers[cls];
      let file;
      if (art) {
        file = path.join(libDir, art.path);
        downloads.push({ url: art.url, path: file, sha1: art.sha1, size: art.size });
      } else {
        const rel = mavenPath(`${lib.name}:${cls}`);
        file = path.join(libDir, rel);
        const base = lib.url ? fixRepoUrl(withSlash(lib.url)) : endpoints.libraries;
        downloads.push({ url: withSlash(base) + rel, path: file });
      }
      natives.push({ path: file, exclude: (lib.extract && lib.extract.exclude) || [], flatten: false });
    } else if (/:natives-/.test(lib.name)) {
      // 1.19+ style natives are normal classpath jars; extracting them too keeps java.library.path working.
      natives.push({ path: classpath[classpath.length - 1], exclude: ['META-INF/'], flatten: true });
    }
  }
  return { classpath: [...new Set(classpath)], downloads, natives };
}

async function extractNatives(natives, dir) {
  await fsp.mkdir(dir, { recursive: true });
  for (const n of natives) {
    if (!(await exists(n.path))) continue;
    await withZip(n.path, async (zip) => {
      for (const entry of zip.entries) {
        if (entry.isDirectory) continue;
        const name = entry.name;
        if (name.startsWith('META-INF/') || n.exclude.some((ex) => name.startsWith(ex))) continue;
        if (/\.(class|sha1|git|txt|md|LIST)$/i.test(name)) continue;
        if (n.flatten && !/\.(dll|so|dylib|jnilib)$/i.test(name)) continue;
        const rel = n.flatten ? path.basename(name) : name;
        const target = path.join(dir, rel);
        if (!target.startsWith(path.resolve(dir))) continue;
        if (await exists(target)) continue;
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await fsp.writeFile(target, await zip.read(entry));
      }
    });
  }
}

/** Downloads the asset index and returns asset download items plus index details. */
async function prepareAssets(version, paths, task) {
  const idx = version.assetIndex;
  if (!idx) return { id: version.assets || 'legacy', items: [], index: { objects: {} } };
  const indexFile = path.join(paths.assets, 'indexes', `${idx.id}.json`);
  if (await needsDownload({ path: indexFile, sha1: idx.sha1, size: idx.size }, true)) {
    task.setStage('Fetching asset index');
    await downloadFile(idx.url, indexFile, { sha1: idx.sha1, signal: task.signal });
  }
  const index = await readJson(indexFile);
  const items = [];
  for (const obj of Object.values(index.objects || {})) {
    const sub = `${obj.hash.slice(0, 2)}/${obj.hash}`;
    items.push({
      url: `${endpoints.resources}/${sub}`,
      path: path.join(paths.assets, 'objects', obj.hash.slice(0, 2), obj.hash),
      sha1: obj.hash,
      size: obj.size,
    });
  }
  return { id: idx.id, items, index };
}

/** Very old versions read assets from a flat folder instead of the hashed object store. */
async function layoutLegacyAssets(assets, paths, gameDir) {
  const { index, id } = assets;
  const targets = [];
  if (index.virtual) targets.push(path.join(paths.assets, 'virtual', id));
  if (index.map_to_resources) targets.push(path.join(gameDir, 'resources'));
  for (const base of targets) {
    for (const [name, obj] of Object.entries(index.objects || {})) {
      const target = path.join(base, name);
      if (!path.resolve(target).startsWith(path.resolve(base))) continue;
      if (await exists(target)) continue;
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.copyFile(path.join(paths.assets, 'objects', obj.hash.slice(0, 2), obj.hash), target);
    }
  }
  return path.join(paths.assets, 'virtual', id);
}

/**
 * Makes sure everything needed to launch a resolved version is on disk.
 * Returns what the launch step needs to build the command line.
 */
async function installVersion({ version, paths, env, task, gameDir, verify = false, concurrency = 16 }) {
  task.setStage('Checking game files');
  const libs = collectLibraries(version, env, paths);
  const items = [...libs.downloads];

  const client = version.downloads && version.downloads.client;
  const clientJar = paths.versionJar(version.jar || version.id);
  if (client) items.push({ url: client.url, path: clientJar, sha1: client.sha1, size: client.size });

  let logging = null;
  const logCfg = version.logging && version.logging.client;
  if (logCfg && logCfg.file) {
    const file = path.join(paths.assets, 'log_configs', logCfg.file.id);
    items.push({ url: logCfg.file.url, path: file, sha1: logCfg.file.sha1, size: logCfg.file.size });
    logging = logCfg.argument.replace('${path}', file);
  }

  const assets = await prepareAssets(version, paths, task);
  items.push(...assets.items);

  task.reset('Downloading game files');
  await downloadAll(items, task, { verify, concurrency });

  if (!(await exists(clientJar))) throw new Error(`Game jar is missing: ${clientJar}`);

  task.setStage('Extracting natives');
  const nativesDir = path.join(paths.natives, version.id);
  await extractNatives(libs.natives, nativesDir);

  const virtualDir = await layoutLegacyAssets(assets, paths, gameDir);

  return {
    classpath: [...libs.classpath, clientJar],
    librariesDir: paths.libraries,
    nativesDir,
    assetsRoot: paths.assets,
    assetIndex: assets.id,
    gameAssets: assets.index.virtual ? virtualDir : paths.assets,
    loggingArg: logging,
  };
}

module.exports = { installVersion, collectLibraries, extractNatives, fixRepoUrl };
