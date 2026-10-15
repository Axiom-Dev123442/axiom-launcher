'use strict';
const os = require('node:os');
const { readJson, writeJson } = require('./util');

/** A sensible default for Minecraft's memory, leaving room for Windows on smaller PCs. */
function recommendedMemory(total = os.totalmem()) {
  const gb = total / 1024 ** 3;
  if (gb <= 6) return 1536;
  if (gb <= 8) return 2048;
  if (gb <= 12) return 3072;
  return 4096;
}

/** Built-in app ids. Both are public identifiers, not secrets. */
const BUILT_IN = {
  microsoftClientId: 'f1918da3-339c-4862-b8a7-4349402ba0f8',
  discordClientId: '',
};

const DEFAULTS = {
  theme: 'axiom',
  accent: null,
  animations: true,
  showSnapshots: false,
  defaultMemory: recommendedMemory(),
  performanceMode: 'auto',
  defaultResolution: { width: 0, height: 0 },
  onLaunch: 'minimize',
  javaPath: '',
  concurrency: 16,
  microsoftClientId: '',
  curseforgeKey: '',
  discord: { enabled: true, clientId: '', hideInstance: false, showButton: true },
  lastInstance: null,
  autoUpdate: true,
};

const clamp = (n, min, max) => Math.min(max, Math.max(min, Math.round(n)));

/** Checks a changed setting, returning undefined for a value that would break something. */
function clean(key, value) {
  const def = DEFAULTS[key];
  if (key === 'concurrency') return Number.isFinite(value) ? clamp(value, 1, 64) : undefined;
  if (key === 'defaultMemory') return Number.isFinite(value) ? clamp(value, 512, Math.floor(os.totalmem() / 1024 ** 2)) : undefined;
  if (key === 'discord') return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
  if (typeof def === 'boolean' || typeof def === 'string') return typeof value === typeof def ? value : undefined;
  return value;
}

class Settings {
  constructor(paths) {
    this.file = paths.settingsFile;
    this.data = null;
  }

  async load() {
    // Callers that arrive while the file is being read share that read, so they all change one object.
    if (!this._loading) {
      this._loading = readJson(this.file, {}).then((saved) => {
        this.data = { ...DEFAULTS, ...saved, discord: { ...DEFAULTS.discord, ...(saved.discord || {}) } };
        // The default theme was called "obsidian" before the launcher became Axiom.
        if (this.data.theme === 'obsidian') this.data.theme = 'axiom';
      });
    }
    await this._loading;
    return this.data;
  }

  async get() {
    return { ...(await this.load()) };
  }

  async update(changes) {
    const d = await this.load();
    for (const [k, raw] of Object.entries(changes)) {
      if (!(k in DEFAULTS)) continue;
      const v = clean(k, raw);
      if (v === undefined) continue;
      d[k] = k === 'discord' ? { ...d.discord, ...v } : v;
    }
    await writeJson(this.file, d);
    return { ...d };
  }

  microsoftClientId() {
    return (this.data && this.data.microsoftClientId) || BUILT_IN.microsoftClientId;
  }

  discordClientId() {
    return (this.data && this.data.discord.clientId) || BUILT_IN.discordClientId;
  }
}

module.exports = { Settings, SETTINGS_DEFAULTS: DEFAULTS, BUILT_IN, recommendedMemory };
