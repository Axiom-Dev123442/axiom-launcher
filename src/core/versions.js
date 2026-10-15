'use strict';
const path = require('node:path');
const fsp = require('node:fs/promises');
const endpoints = require('./endpoints');
const { getJson, downloadFile } = require('./http');
const { readJson, writeJson, exists, libraryKey, sha1File } = require('./util');

/**
 * Merges a child version json (Fabric, Forge...) on top of its parent.
 * Child libraries come first and replace parent libraries with the same
 * group:artifact:classifier, so loaders can override vanilla library versions.
 */
function mergeVersions(parent, child) {
  const merged = { ...parent, ...child };
  delete merged.inheritsFrom;

  const libs = [];
  const seen = new Set();
  for (const lib of [...(child.libraries || []), ...(parent.libraries || [])]) {
    // Libraries with rules (natives for one OS) may legitimately repeat, so only dedupe plain ones.
    const key = lib.rules ? null : libraryKey(lib.name);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    libs.push(lib);
  }
  merged.libraries = libs;

  if (parent.arguments || child.arguments) {
    merged.arguments = {
      game: [...((parent.arguments && parent.arguments.game) || []), ...((child.arguments && child.arguments.game) || [])],
      jvm: [...((parent.arguments && parent.arguments.jvm) || []), ...((child.arguments && child.arguments.jvm) || [])],
    };
  }
  merged.minecraftArguments = child.minecraftArguments || parent.minecraftArguments;
  merged.downloads = child.downloads || parent.downloads;
  merged.assetIndex = child.assetIndex || parent.assetIndex;
  merged.assets = child.assets || parent.assets;
  merged.javaVersion = child.javaVersion || parent.javaVersion;
  merged.logging = child.logging || parent.logging;
  merged.jar = child.jar || parent.jar || parent.id;
  merged.type = parent.type || child.type;
  merged.chain = [child.id, ...(parent.chain || [parent.id])];
  return merged;
}

class VersionService {
  constructor(paths) {
    this.paths = paths;
    this._manifest = null;
    this._manifestAt = 0;
  }

  get manifestCache() {
    return path.join(this.paths.cache, 'version_manifest_v2.json');
  }

  /** Mojang's version list, cached for 10 minutes and on disk for offline use. */
  async manifest({ force = false } = {}) {
    if (!force && this._manifest && Date.now() - this._manifestAt < 10 * 60 * 1000) return this._manifest;
    try {
      this._manifest = await getJson(endpoints.versionManifest, { retries: 1 });
      this._manifestAt = Date.now();
      await writeJson(this.manifestCache, this._manifest);
    } catch (err) {
      const cached = await readJson(this.manifestCache, null);
      if (!cached) throw err;
      this._manifest = cached;
    }
    return this._manifest;
  }

  /** Versions installed locally that are not in the Mojang manifest (loader profiles etc). */
  async localVersions() {
    try {
      const dirs = await fsp.readdir(this.paths.versions);
      const out = [];
      for (const id of dirs) if (await exists(this.paths.versionJson(id))) out.push(id);
      return out;
    } catch {
      return [];
    }
  }

  /** Returns a version's own json, downloading it if needed. */
  async ensureVersion(id, task) {
    const file = this.paths.versionJson(id);
    let entry = null;
    if (await exists(file)) {
      const json = await readJson(file, null);
      if (json) {
        // Vanilla jsons are re-checked against the manifest so Mojang fixes are picked up.
        if (!json.inheritsFrom && this._manifest) {
          entry = this._manifest.versions.find((v) => v.id === id);
          if (!entry || !entry.sha1 || (await sha1File(file)) === entry.sha1) return json;
        } else {
          return json;
        }
      }
    }
    const manifest = await this.manifest();
    entry = entry || manifest.versions.find((v) => v.id === id);
    if (!entry) throw new Error(`Minecraft version ${id} was not found`);
    if (task) task.setStage(`Fetching ${id} info`);
    await downloadFile(entry.url, file, { sha1: entry.sha1, signal: task && task.signal });
    return readJson(file);
  }

  /** Fully resolved version json with inheritance applied. */
  async resolve(id, task, depth = 0) {
    if (depth > 5) throw new Error('Version inheritance is too deep');
    const json = await this.ensureVersion(id, task);
    if (!json.inheritsFrom) return { ...json, jar: json.jar || json.id, chain: [json.id] };
    const parent = await this.resolve(json.inheritsFrom, task, depth + 1);
    return mergeVersions(parent, json);
  }
}

module.exports = { VersionService, mergeVersions };
