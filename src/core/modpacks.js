'use strict';
const path = require('node:path');
const fsp = require('node:fs/promises');
const modrinth = require('./mods/modrinth');
const curseforge = require('./mods/curseforge');
const { downloadAll, downloadFile } = require('./http');
const { withZip, createZip } = require('./zip');
const { safeJoin, exists } = require('./util');
const { FOLDERS } = require('./content');

const UNSUPPORTED = 'uses a mod loader Obsidian does not support yet (only Fabric and Forge are supported).';

/** Works out what kind of pack a zip is. */
function detectPack(zip) {
  if (zip.has('modrinth.index.json')) return { kind: 'mrpack' };
  if (zip.has('manifest.json')) return { kind: 'curseforge' };
  const mmc = zip.entries.find((e) => /(^|\/)mmc-pack\.json$/.test(e.name));
  if (mmc) return { kind: 'prism', prefix: mmc.name.slice(0, -'mmc-pack.json'.length) };
  return null;
}

/** Turns a Forge loader version into the full maven version used to install it. */
function forgeFull(mcVersion, forge) {
  return forge.startsWith(`${mcVersion}-`) ? forge : `${mcVersion}-${forge}`;
}

function loaderFromMrpack(deps) {
  const mcVersion = deps.minecraft;
  if (deps['fabric-loader']) return { mcVersion, loader: 'fabric', loaderVersion: deps['fabric-loader'] };
  if (deps.forge) return { mcVersion, loader: 'forge', loaderVersion: forgeFull(mcVersion, deps.forge) };
  if (deps.neoforge || deps['quilt-loader']) return { unsupported: true };
  return { mcVersion, loader: 'vanilla', loaderVersion: null };
}

function loaderFromCurseforge(manifest) {
  const mcVersion = manifest.minecraft.version;
  const loaders = manifest.minecraft.modLoaders || [];
  const primary = (loaders.find((l) => l.primary) || loaders[0] || {}).id || '';
  const [kind, ...rest] = primary.split('-');
  const version = rest.join('-');
  if (!primary) return { mcVersion, loader: 'vanilla', loaderVersion: null };
  if (kind === 'fabric') return { mcVersion, loader: 'fabric', loaderVersion: version };
  if (kind === 'forge') return { mcVersion, loader: 'forge', loaderVersion: forgeFull(mcVersion, version) };
  return { unsupported: true };
}

const PRISM_UIDS = {
  'net.fabricmc.fabric-loader': 'fabric',
  'net.minecraftforge': 'forge',
  'net.neoforged': null,
  'org.quiltmc.quilt-loader': null,
};

function loaderFromPrism(pack) {
  const comps = pack.components || [];
  const mc = comps.find((c) => c.uid === 'net.minecraft');
  if (!mc) throw new Error('This Prism/MultiMC export has no Minecraft version.');
  const mcVersion = mc.version || mc.cachedVersion;
  for (const c of comps) {
    if (!(c.uid in PRISM_UIDS)) continue;
    const loader = PRISM_UIDS[c.uid];
    if (!loader) return { unsupported: true };
    const v = c.version || c.cachedVersion;
    return { mcVersion, loader, loaderVersion: loader === 'forge' ? forgeFull(mcVersion, v) : v };
  }
  return { mcVersion, loader: 'vanilla', loaderVersion: null };
}

function parseCfg(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

class ModpackManager {
  constructor({ paths, instances, content }) {
    this.paths = paths;
    this.instances = instances;
    this.content = content;
  }

  /** Reads a pack file and returns what it would create, without installing. */
  async inspect(file) {
    return withZip(file, async (zip) => {
      const type = detectPack(zip);
      if (!type) throw new Error('This file is not a Modrinth, CurseForge, Prism or MultiMC pack.');
      if (type.kind === 'mrpack') {
        const index = await zip.readJson('modrinth.index.json');
        return { kind: type.kind, name: index.name, version: index.versionId, ...loaderFromMrpack(index.dependencies || {}) };
      }
      if (type.kind === 'curseforge') {
        const m = await zip.readJson('manifest.json');
        if (!m.minecraft) throw new Error('This CurseForge zip has no Minecraft version.');
        return { kind: type.kind, name: m.name, version: m.version, ...loaderFromCurseforge(m) };
      }
      const pack = await zip.readJson(`${type.prefix}mmc-pack.json`);
      const cfgName = `${type.prefix}instance.cfg`;
      const cfg = zip.has(cfgName) ? parseCfg(await zip.readText(cfgName)) : {};
      return { kind: type.kind, name: cfg.name || 'Imported instance', ...loaderFromPrism(pack) };
    });
  }

  /**
   * Imports a pack file as a new instance. Returns { instance, blocked } where
   * blocked lists CurseForge files that must be downloaded by hand.
   */
  async importFile(file, task, { name, icon, modpack } = {}) {
    const info = await this.inspect(file);
    if (info.unsupported) throw new Error(`${info.name || 'This pack'} ${UNSUPPORTED}`);
    const inst = await this.instances.create({
      name: name || info.name,
      icon: icon || { type: 'preset', value: 'grass' },
      mcVersion: info.mcVersion,
      loader: info.loader,
      loaderVersion: info.loaderVersion,
      modpack: modpack || (info.kind === 'prism' ? null : { source: 'file', name: info.name, versionNumber: info.version || '' }),
    });
    try {
      const result = await this._apply(file, inst, task);
      return { instance: await this.instances.get(inst.id), blocked: result.blocked };
    } catch (err) {
      await this.instances.remove(inst.id).catch(() => {});
      throw err;
    }
  }

  /** Downloads a modpack from Modrinth or CurseForge and imports it. */
  async installFromSource({ source, projectId, versionId }, task) {
    const api = source === 'curseforge' ? curseforge : modrinth;
    const project = await api.project(projectId);
    let version;
    if (versionId) version = source === 'curseforge' ? await api.version(versionId, projectId) : await api.version(versionId);
    else {
      const list = await api.versions(projectId, {});
      version = list.find((v) => v.type === 'release') || list[0];
    }
    if (!version) throw new Error(`${project.title} has no versions to install.`);
    const file = version.files.find((f) => f.primary) || version.files[0];
    if (!file.url) throw new Error(`${project.title} can only be downloaded from the CurseForge website.`);

    task.reset(`Downloading ${project.title}`);
    const local = path.join(this.paths.cache, 'packs', `${source}-${version.id}${source === 'curseforge' ? '.zip' : '.mrpack'}`);
    task.addTotal(file.size || 0);
    await downloadFile(file.url, local, { sha1: file.sha1, signal: task.signal, onBytes: (n) => task.addDone(n) });

    return this.importFile(local, task, {
      name: project.title,
      icon: project.icon ? { type: 'url', value: project.icon } : undefined,
      modpack: {
        source,
        projectId: project.id,
        versionId: version.id,
        versionNumber: version.versionNumber,
        name: project.title,
      },
    });
  }

  async _apply(file, inst, task) {
    const gameDir = this.instances.gameDir(inst.id);
    return withZip(file, async (zip) => {
      const type = detectPack(zip);
      if (type.kind === 'mrpack') return this._applyMrpack(zip, inst, gameDir, task);
      if (type.kind === 'curseforge') return this._applyCurseforge(zip, inst, gameDir, task);
      return this._applyPrism(zip, type.prefix, inst, gameDir, task);
    });
  }

  async _recordPackFiles(inst, files, entries) {
    const index = await this.content.readIndex(inst.id);
    for (const [key, e] of Object.entries(entries)) index[key] = { ...e, fromPack: true };
    await this.content.writeIndex(inst.id, index);
    const fresh = await this.instances.get(inst.id);
    await this.instances.update(inst.id, { modpack: { ...(fresh.modpack || {}), files } });
  }

  async _applyMrpack(zip, inst, gameDir, task) {
    const index = await zip.readJson('modrinth.index.json');
    const items = [];
    const files = [];
    const entries = {};
    for (const f of index.files || []) {
      if (f.env && f.env.client === 'unsupported') continue;
      const target = safeJoin(gameDir, f.path);
      items.push({ url: f.downloads[0], path: target, sha1: f.hashes && f.hashes.sha1, size: f.fileSize });
      files.push(f.path);
      entries[f.path.replace(/\\/g, '/')] = {
        source: 'modrinth-pack',
        title: path.basename(f.path).replace(/\.(jar|zip)$/i, ''),
        url: f.downloads[0],
        sha1: f.hashes && f.hashes.sha1,
        sha512: f.hashes && f.hashes.sha512,
        size: f.fileSize,
      };
    }
    task.reset(`Downloading ${items.length} pack files`);
    await downloadAll(items, task);
    task.setStage('Copying pack settings');
    files.push(...(await zip.extractTo(gameDir, { prefix: 'overrides/' })));
    files.push(...(await zip.extractTo(gameDir, { prefix: 'client-overrides/' })));
    await this._recordPackFiles(inst, files, entries);
    return { blocked: [] };
  }

  async _applyCurseforge(zip, inst, gameDir, task) {
    const manifest = await zip.readJson('manifest.json');
    const wanted = (manifest.files || []).filter((f) => f.required !== false);
    const files = [];
    const entries = {};
    const blocked = [];
    if (wanted.length) {
      task.setStage('Looking up CurseForge files');
      const cfFiles = [];
      for (let i = 0; i < wanted.length; i += 500) {
        cfFiles.push(...(await curseforge.files(wanted.slice(i, i + 500).map((f) => f.fileID))));
      }
      const projects = new Map();
      const modIds = [...new Set(cfFiles.map((f) => f.modId))];
      for (let i = 0; i < modIds.length; i += 500) {
        for (const m of await curseforge.mods(modIds.slice(i, i + 500))) projects.set(m.id, m);
      }
      const items = [];
      for (const f of cfFiles) {
        const project = projects.get(String(f.modId));
        const folder = FOLDERS[(project && project.type) || 'mod'] || 'mods';
        const rel = `${folder}/${f.fileName}`;
        if (!f.downloadUrl) {
          blocked.push({ name: (project && project.title) || f.fileName, file: f.fileName, folder, url: project ? `${project.url}/files/${f.id}` : null });
          continue;
        }
        const sha1 = (f.hashes || []).find((h) => h.algo === 1);
        items.push({ url: f.downloadUrl, path: safeJoin(gameDir, rel), sha1: sha1 && sha1.value, size: f.fileLength });
        files.push(rel);
        entries[rel] = {
          source: 'curseforge',
          projectId: String(f.modId),
          versionId: String(f.id),
          versionNumber: f.displayName,
          title: (project && project.title) || f.fileName,
          icon: project && project.icon,
          description: project && project.description,
        };
      }
      task.reset(`Downloading ${items.length} pack files`);
      await downloadAll(items, task);
    }
    task.setStage('Copying pack settings');
    files.push(...(await zip.extractTo(gameDir, { prefix: `${manifest.overrides || 'overrides'}/` })));
    await this._recordPackFiles(inst, files, entries);
    return { blocked };
  }

  async _applyPrism(zip, prefix, inst, gameDir, task) {
    task.setStage('Copying instance files');
    const mcPrefix = zip.entries.some((e) => e.name.startsWith(`${prefix}.minecraft/`)) ? `${prefix}.minecraft/` : `${prefix}minecraft/`;
    await zip.extractTo(gameDir, { prefix: mcPrefix });
    const cfgName = `${prefix}instance.cfg`;
    if (zip.has(cfgName)) {
      const cfg = parseCfg(await zip.readText(cfgName));
      const changes = {};
      if (cfg.MaxMemAlloc) changes.memory = { min: Number(cfg.MinMemAlloc) || 512, max: Number(cfg.MaxMemAlloc) };
      if (cfg.JvmArgs) changes.jvmArgs = cfg.JvmArgs;
      if (Object.keys(changes).length) await this.instances.update(inst.id, changes);
    }
    return { blocked: [] };
  }

  /** Returns the newer version of an instance's modpack, if any. */
  async checkUpdate(instanceId) {
    const inst = await this.instances.get(instanceId);
    const mp = inst.modpack;
    if (!mp || !mp.projectId || (mp.source !== 'modrinth' && mp.source !== 'curseforge')) return null;
    const api = mp.source === 'curseforge' ? curseforge : modrinth;
    const list = await api.versions(mp.projectId, {});
    const latest = list.find((v) => v.type === 'release') || list[0];
    if (!latest || latest.id === mp.versionId) return null;
    return { versionId: latest.id, versionNumber: latest.versionNumber };
  }

  /** Replaces the pack's files with a newer version, keeping worlds and anything added by hand. */
  async update(instanceId, versionId, task) {
    const inst = await this.instances.get(instanceId);
    const mp = inst.modpack;
    const api = mp.source === 'curseforge' ? curseforge : modrinth;
    const version = mp.source === 'curseforge' ? await api.version(versionId, mp.projectId) : await api.version(versionId);
    const file = version.files.find((f) => f.primary) || version.files[0];
    const local = path.join(this.paths.cache, 'packs', `${mp.source}-${version.id}${mp.source === 'curseforge' ? '.zip' : '.mrpack'}`);
    task.reset(`Downloading ${mp.name} ${version.versionNumber}`);
    task.addTotal(file.size || 0);
    await downloadFile(file.url, local, { sha1: file.sha1, signal: task.signal, onBytes: (n) => task.addDone(n) });

    const info = await this.inspect(local);
    if (info.unsupported) throw new Error(`${mp.name} ${UNSUPPORTED}`);

    // Remove files the old version of the pack installed, but never worlds.
    const gameDir = this.instances.gameDir(instanceId);
    for (const rel of mp.files || []) {
      if (/^saves\//.test(rel)) continue;
      await fsp.rm(safeJoin(gameDir, rel), { force: true });
    }
    const index = await this.content.readIndex(instanceId);
    for (const [key, e] of Object.entries(index)) if (e.fromPack) delete index[key];
    await this.content.writeIndex(instanceId, index);

    await this.instances.update(instanceId, {
      mcVersion: info.mcVersion,
      loader: info.loader,
      loaderVersion: info.loaderVersion,
      modpack: { ...mp, versionId: version.id, versionNumber: version.versionNumber, files: [] },
    });
    const result = await this._apply(local, await this.instances.get(instanceId), task);
    return { instance: await this.instances.get(instanceId), blocked: result.blocked };
  }

  /**
   * Exports an instance as a Modrinth pack. Mods from Modrinth are referenced
   * by URL; everything else goes in overrides.
   */
  async exportMrpack(instanceId, out, { include = {}, name, version = '1.0.0' } = {}) {
    const inst = await this.instances.get(instanceId);
    if (inst.loader === 'forge' && !inst.installedLoaderVersion && !inst.loaderVersion) {
      throw new Error('Play this instance once before exporting so the Forge version is known.');
    }
    const gameDir = this.instances.gameDir(instanceId);
    const index = await this.content.readIndex(instanceId);
    const files = [];
    const zipFiles = [];
    const referenced = new Set();

    for (const [rel, e] of Object.entries(index)) {
      if (!e.url || !e.sha1 || !e.sha512 || !/^https:\/\/cdn\.modrinth\.com\//.test(e.url)) continue;
      const abs = safeJoin(gameDir, rel);
      if (!(await exists(abs))) continue;
      const stat = await fsp.stat(abs);
      files.push({
        path: rel,
        hashes: { sha1: e.sha1, sha512: e.sha512 },
        env: { client: 'required', server: 'required' },
        downloads: [e.url],
        fileSize: stat.size,
      });
      referenced.add(rel);
    }

    const folders = ['mods'];
    if (include.config !== false) folders.push('config');
    if (include.resourcepacks) folders.push('resourcepacks');
    if (include.shaderpacks) folders.push('shaderpacks');
    for (const folder of folders) {
      const dir = path.join(gameDir, folder);
      let list = [];
      try {
        list = await fsp.readdir(dir, { recursive: true, withFileTypes: true });
      } catch {}
      for (const d of list) {
        if (!d.isFile()) continue;
        const abs = path.join(d.parentPath || d.path, d.name);
        const rel = path.relative(gameDir, abs).replace(/\\/g, '/');
        if (referenced.has(rel) || rel.endsWith('.disabled')) continue;
        zipFiles.push({ name: `overrides/${rel}`, data: await fsp.readFile(abs) });
      }
    }
    if (include.options && (await exists(path.join(gameDir, 'options.txt')))) {
      zipFiles.push({ name: 'overrides/options.txt', data: await fsp.readFile(path.join(gameDir, 'options.txt')) });
    }

    const dependencies = { minecraft: inst.mcVersion };
    const lv = inst.installedLoaderVersion || inst.loaderVersion;
    if (inst.loader === 'fabric') dependencies['fabric-loader'] = lv;
    if (inst.loader === 'forge') dependencies.forge = String(lv).replace(`${inst.mcVersion}-`, '');

    const manifest = {
      formatVersion: 1,
      game: 'minecraft',
      versionId: version,
      name: name || inst.name,
      files,
      dependencies,
    };
    zipFiles.unshift({ name: 'modrinth.index.json', data: JSON.stringify(manifest, null, 2) });
    await fsp.mkdir(path.dirname(out), { recursive: true });
    await fsp.writeFile(out, createZip(zipFiles));
    return out;
  }
}

module.exports = { ModpackManager, detectPack, loaderFromMrpack, loaderFromCurseforge, loaderFromPrism };
