'use strict';
const path = require('node:path');
const fsp = require('node:fs/promises');
const { downloadFile } = require('./http');
const { readJson, writeJson, exists } = require('./util');
const { withZip } = require('./zip');

/**
 * Instance icon name → block texture inside the Minecraft client jar.
 * The textures are Mojang's, so they are never shipped with Obsidian; they are
 * read from the game files the player downloads.
 */
const TEXTURES = {
  obsidian: 'obsidian',
  grass: 'grass_block_side',
  dirt: 'dirt',
  stone: 'stone',
  deepslate: 'deepslate',
  diamond: 'diamond_ore',
  emerald: 'emerald_ore',
  gold: 'gold_ore',
  redstone: 'redstone_ore',
  lapis: 'lapis_ore',
  netherrack: 'netherrack',
  endstone: 'end_stone',
  glowstone: 'glowstone',
  amethyst: 'amethyst_block',
  ice: 'packed_ice',
  sculk: 'sculk',
  cherry: 'cherry_planks',
  planks: 'oak_planks',
  log: 'oak_log',
  tnt: 'tnt_side',
  crafting: 'crafting_table_front',
  furnace: 'furnace_front',
  bookshelf: 'bookshelf',
  pumpkin: 'jack_o_lantern',
  diamondblock: 'diamond_block',
  goldblock: 'gold_block',
  netherite: 'netherite_block',
  debris: 'ancient_debris_side',
  crying: 'crying_obsidian',
  honey: 'honeycomb_block',
  slime: 'slime_block',
  magma: 'magma',
  prismarine: 'prismarine_bricks',
  sealantern: 'sea_lantern',
  moss: 'mossy_cobblestone',
  bricks: 'bricks',
  sand: 'sand',
  command: 'command_block_front',
  spawner: 'spawner',
  beacon: 'beacon',
};

const VERSION = 2;

/** The game version whose block textures are used for icons. */
const PREFERRED_VERSION = '1.21.11';

class BlockTextures {
  constructor(paths, versions) {
    this.paths = paths;
    this.versions = versions;
    this.dir = path.join(paths.cache, 'block-icons');
    this._pending = null;
  }

  /** The preferred version's jar if it's installed, else the newest installed vanilla jar. */
  async _localJar() {
    if (await exists(this.paths.versionJar(PREFERRED_VERSION))) return this.paths.versionJar(PREFERRED_VERSION);
    let best = null;
    let ids = [];
    try {
      ids = await fsp.readdir(this.paths.versions);
    } catch {}
    for (const id of ids) {
      const json = await readJson(this.paths.versionJson(id), null);
      if (!json || json.inheritsFrom || !json.releaseTime) continue;
      if (!(await exists(this.paths.versionJar(id)))) continue;
      if (!best || json.releaseTime > best.releaseTime) best = { id, releaseTime: json.releaseTime };
    }
    return best ? this.paths.versionJar(best.id) : null;
  }

  /** Downloads the preferred version's client jar (or the latest release) into the versions folder. */
  async _download() {
    const manifest = await this.versions.manifest();
    const has = (id) => manifest.versions.some((v) => v.id === id);
    const id = has(PREFERRED_VERSION) ? PREFERRED_VERSION : manifest.latest && manifest.latest.release;
    if (!id) return null;
    const json = await this.versions.ensureVersion(id);
    const client = json.downloads && json.downloads.client;
    if (!client) return null;
    const jar = this.paths.versionJar(id);
    if (!(await exists(jar))) await downloadFile(client.url, jar, { sha1: client.sha1 });
    return jar;
  }

  async _extract(jar) {
    await fsp.mkdir(this.dir, { recursive: true });
    const found = [];
    await withZip(jar, async (zip) => {
      for (const [key, name] of Object.entries(TEXTURES)) {
        const entry = `assets/minecraft/textures/block/${name}.png`;
        if (!zip.has(entry)) continue;
        await fsp.writeFile(path.join(this.dir, `${key}.png`), await zip.read(entry));
        found.push(key);
      }
    });
    await writeJson(path.join(this.dir, 'index.json'), { version: VERSION, source: path.basename(jar), found });
    return found;
  }

  /**
   * Returns { name: pngBuffer } for every available block texture, extracting
   * them from game files on first use. Resolves to {} when nothing is available.
   */
  async load({ allowDownload = true } = {}) {
    if (this._pending) return this._pending;
    this._pending = (async () => {
      let index = await readJson(path.join(this.dir, 'index.json'), null);
      if (!index || index.version !== VERSION) {
        let jar = await this._localJar();
        const preferred = this.paths.versionJar(PREFERRED_VERSION);
        if (allowDownload && jar !== preferred) jar = (await this._download().catch(() => null)) || jar;
        if (!jar) return {};
        await this._extract(jar);
        index = await readJson(path.join(this.dir, 'index.json'), { found: [] });
      }
      const out = {};
      for (const key of index.found) {
        try {
          out[key] = await fsp.readFile(path.join(this.dir, `${key}.png`));
        } catch {}
      }
      return out;
    })();
    try {
      return await this._pending;
    } finally {
      this._pending = null;
    }
  }

  async reset() {
    await fsp.rm(this.dir, { recursive: true, force: true });
  }
}

module.exports = { BlockTextures, BLOCK_TEXTURES: TEXTURES, PREFERRED_VERSION };
