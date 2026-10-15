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
  theme: 'obsidian',
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

class Settings {
  constructor(paths) {
    this.file = paths.settingsFile;
    this.data = null;
  }

  async load() {
    if (!this.data) {
      const saved = await readJson(this.file, {});
      this.data = { ...DEFAULTS, ...saved, discord: { ...DEFAULTS.discord, ...(saved.discord || {}) } };
    }
    return this.data;
  }

  async get() {
    return { ...(await this.load()) };
  }

  async update(changes) {
    const d = await this.load();
    for (const [k, v] of Object.entries(changes)) {
      if (!(k in DEFAULTS)) continue;
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
