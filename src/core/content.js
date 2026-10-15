'use strict';
const path = require('node:path');
const fsp = require('node:fs/promises');
const modrinth = require('./mods/modrinth');
const curseforge = require('./mods/curseforge');
const { downloadFile } = require('./http');
const { readJson, writeJson, safeJoin, withLock, lockKey } = require('./util');
const { withZip } = require('./zip');

const FOLDERS = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' };
const EXTENSIONS = { mod: ['.jar'], resourcepack: ['.zip'], shader: ['.zip'] };
const SOURCES = { modrinth, curseforge };

function source(name) {
  const s = SOURCES[name];
  if (!s) throw new Error(`Unknown source ${name}`);
  return s;
}

/** The loader to ask a mod site for, given the instance and kind of content. */
function loaderFilter(instance, type) {
  if (type !== 'mod') return undefined;
  if (instance.loader === 'vanilla') {
    throw new Error('Vanilla instances can’t use mods. Switch this instance to Fabric, Quilt or Forge first.');
  }
  return instance.loader;
}

/** Picks the newest stable version, falling back to betas when that's all there is. */
function pickVersion(list) {
  return list.find((v) => v.type === 'release') || list.find((v) => v.type === 'beta') || list[0];
}

const metaCache = new Map();

/** Reads a mod jar's own name, version and icon for mods not installed through the launcher. */
async function readModMeta(file) {
  const stat = await fsp.stat(file);
  const key = `${file}:${stat.size}:${stat.mtimeMs}`;
  if (metaCache.has(key)) return metaCache.get(key);
  let meta = {};
  try {
    meta = await withZip(file, async (zip) => {
      const iconData = async (p) => {
        if (!p || !zip.has(p)) return null;
        const buf = await zip.read(p);
        return buf.length < 512 * 1024 ? `data:image/png;base64,${buf.toString('base64')}` : null;
      };
      if (zip.has('fabric.mod.json')) {
        const j = await zip.readJson('fabric.mod.json');
        const icon = typeof j.icon === 'string' ? j.icon : j.icon && Object.values(j.icon).pop();
        return { title: j.name || j.id, version: j.version, description: j.description, icon: await iconData(icon) };
      }
      if (zip.has('META-INF/mods.toml')) {
        const t = await zip.readText('META-INF/mods.toml');
        const get = (k) => {
          const m = t.match(new RegExp(`^\\s*${k}\\s*=\\s*["']([^"']*)["']`, 'm'));
          return m ? m[1] : undefined;
        };
        let version = get('version');
        if (version === '${file.jarVersion}') version = undefined;
        return { title: get('displayName'), version, description: get('description'), icon: await iconData(get('logoFile')) };
      }
      if (zip.has('mcmod.info')) {
        const j = JSON.parse((await zip.readText('mcmod.info')).replace(/^﻿/, ''));
        const m = Array.isArray(j) ? j[0] : (j.modList || [])[0];
        if (m) return { title: m.name, version: m.version, description: m.description };
      }
      return {};
    });
  } catch {}
  metaCache.set(key, meta);
  return meta;
}

class ContentManager {
  constructor(instances) {
    this.instances = instances;
  }

  indexFile(id) {
    return path.join(this.instances.dir(id), 'content.json');
  }

  async readIndex(id) {
    return readJson(this.indexFile(id), {});
  }

  async writeIndex(id, index) {
    await writeJson(this.indexFile(id), index);
  }

  /** Reads, changes and saves the index as one step, so parallel installs never lose entries. */
  async updateIndex(id, change) {
    const file = this.indexFile(id);
    return withLock(lockKey(file), async () => {
      const index = await readJson(file, {});
      const result = await change(index);
      await writeJson(file, index);
      return result;
    });
  }

  folder(id, type) {
    const f = FOLDERS[type];
    if (!f) throw new Error(`Unknown content type ${type}`);
    return path.join(this.instances.gameDir(id), f);
  }

  async list(id, type) {
    const dir = this.folder(id, type);
    const index = await this.readIndex(id);
    let names = [];
    try {
      names = await fsp.readdir(dir, { withFileTypes: true });
    } catch {}
    const out = [];
    for (const d of names) {
      const enabled = !d.name.endsWith('.disabled');
      const file = enabled ? d.name : d.name.slice(0, -'.disabled'.length);
      const isDirPack = d.isDirectory() && type !== 'mod';
      if (!isDirPack && !EXTENSIONS[type].some((e) => file.toLowerCase().endsWith(e))) continue;
      const entry = index[`${FOLDERS[type]}/${file}`] || null;
      let meta = {};
      if (!entry && type === 'mod') meta = await readModMeta(path.join(dir, d.name));
      out.push({
        file,
        enabled,
        title: (entry && entry.title) || meta.title || file.replace(/\.(jar|zip)$/i, ''),
        version: (entry && entry.versionNumber) || meta.version || '',
        description: (entry && entry.description) || meta.description || '',
        icon: (entry && entry.icon) || meta.icon || null,
        source: entry ? entry.source : null,
        projectId: entry ? entry.projectId : null,
        versionId: entry ? entry.versionId : null,
        fromPack: Boolean(entry && entry.fromPack),
      });
    }
    return out.sort((a, b) => a.title.localeCompare(b.title));
  }

  async toggle(id, type, file, enable) {
    const dir = this.folder(id, type);
    const on = safeJoin(dir, file);
    const off = `${on}.disabled`;
    if (enable) await fsp.rename(off, on);
    else await fsp.rename(on, off);
  }

  async remove(id, type, file) {
    const dir = this.folder(id, type);
    const target = safeJoin(dir, file);
    await fsp.rm(target, { recursive: true, force: true });
    await fsp.rm(`${target}.disabled`, { recursive: true, force: true });
    await this.updateIndex(id, (index) => {
      delete index[`${FOLDERS[type]}/${file}`];
    });
  }

  /** Copies files the person picked into the instance (drag and drop). */
  async addFiles(id, type, files) {
    const dir = this.folder(id, type);
    // Only files of the right kind, so a stray drop never lands in the mods folder.
    const wanted = files.filter((f) => EXTENSIONS[type].some((e) => String(f).toLowerCase().endsWith(e)));
    if (!wanted.length) throw new Error(`Drop ${EXTENSIONS[type].join(' or ')} files here.`);
    await fsp.mkdir(dir, { recursive: true });
    for (const f of wanted) await fsp.copyFile(f, path.join(dir, path.basename(f)));
  }

  /**
   * Installs a project (and its required dependencies) into an instance.
   * Returns the titles of everything installed.
   */
  async install({ instanceId, source: src, projectId, versionId, type = 'mod' }, task, depth = 0) {
    const instance = await this.instances.get(instanceId);
    const api = source(src);
    const loader = loaderFilter(instance, type);

    let version;
    if (versionId) {
      version = src === 'curseforge' ? await api.version(versionId, projectId) : await api.version(versionId);
    } else {
      const list = await api.versions(projectId, { loader, gameVersion: instance.mcVersion });
      version = pickVersion(list);
      if (!version) {
        const what = loader ? `Minecraft ${instance.mcVersion} with ${loader}` : `Minecraft ${instance.mcVersion}`;
        throw new Error(`No compatible version for ${what}.`);
      }
    }
    projectId = version.projectId || projectId;

    const info = await api.project(projectId).catch(() => null);
    const title = (info && info.title) || version.name;
    const file = version.files.find((f) => f.primary) || version.files[0];
    if (!file) throw new Error(`${title} has no downloadable file.`);
    if (!file.url) {
      const err = new Error(`${title}'s author only allows downloads from the CurseForge website.`);
      err.openUrl = info && info.url ? `${info.url}/files/${version.id}` : null;
      throw err;
    }

    const index = await this.readIndex(instanceId);
    const folderName = FOLDERS[type];

    // Replace any older file of the same project.
    for (const [key, e] of Object.entries(index)) {
      if (e.projectId === projectId && e.source === src && key.startsWith(`${folderName}/`)) {
        const old = key.slice(folderName.length + 1);
        if (old !== file.filename) await this.remove(instanceId, type, old);
      }
    }

    task.setStage(`Downloading ${title}`);
    const target = safeJoin(this.folder(instanceId, type), file.filename);
    if (!file.size) task.addTotal(0);
    else task.addTotal(file.size);
    await downloadFile(file.url, target, {
      sha1: file.sha1,
      signal: task.signal,
      onBytes: (n) => task.addDone(n),
    });

    await this.updateIndex(instanceId, (fresh) => {
      fresh[`${folderName}/${file.filename}`] = {
        source: src,
        projectId,
        versionId: version.id,
        versionNumber: version.versionNumber,
        title,
        description: info ? info.description : '',
        icon: info ? info.icon : null,
        url: file.url,
        sha1: file.sha1 || null,
        sha512: file.sha512 || null,
        size: file.size || null,
      };
    });

    const installed = [title];
    if (type === 'mod' && depth < 6) {
      for (const dep of version.dependencies) {
        let depProject = dep.projectId;
        let depVersion = null;
        if (!depProject && dep.versionId && src === 'modrinth') {
          const v = await modrinth.version(dep.versionId);
          depProject = v.projectId;
          depVersion = v.id;
        }
        if (!depProject) continue;
        const current = await this.readIndex(instanceId);
        if (Object.values(current).some((e) => e.projectId === depProject)) continue;
        try {
          installed.push(
            ...(await this.install({ instanceId, source: src, projectId: depProject, versionId: depVersion, type }, task, depth + 1)),
          );
        } catch (err) {
          if (err.name === 'AbortError') throw err;
        }
      }
    }
    return installed;
  }

  /** Finds newer compatible versions of launcher-installed content. */
  async checkUpdates(id, type) {
    const instance = await this.instances.get(id);
    const index = await this.readIndex(id);
    const folderName = FOLDERS[type];
    const updates = [];
    for (const [key, e] of Object.entries(index)) {
      if (!key.startsWith(`${folderName}/`) || e.fromPack) continue;
      try {
        const list = await source(e.source).versions(e.projectId, {
          loader: type === 'mod' ? instance.loader : undefined,
          gameVersion: instance.mcVersion,
        });
        const latest = pickVersion(list);
        if (latest && latest.id !== e.versionId) {
          updates.push({ file: key.slice(folderName.length + 1), title: e.title, from: e.versionNumber, to: latest.versionNumber, source: e.source, projectId: e.projectId, versionId: latest.id });
        }
      } catch {}
    }
    return updates;
  }
}

module.exports = { ContentManager, readModMeta, pickVersion, FOLDERS };
