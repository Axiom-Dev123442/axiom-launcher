'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function dataBase() {
  return (
    process.env.APPDATA ||
    (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : path.join(os.homedir(), '.local', 'share'))
  );
}

/**
 * The launcher's data folder. Earlier versions were called Obsidian and kept
 * everything in .obsidian; that folder is moved to .axiom the first time, so
 * instances, accounts and downloads carry over.
 */
function defaultRoot() {
  const custom = process.env.AXIOM_HOME || process.env.OBSIDIAN_HOME;
  if (custom) return custom;
  const base = dataBase();
  const root = path.join(base, '.axiom');
  const legacy = path.join(base, '.obsidian');
  if (!fs.existsSync(root) && fs.existsSync(path.join(legacy, 'settings.json'))) {
    try {
      fs.renameSync(legacy, root);
    } catch {
      // Something still holds a file in it (the old launcher is open); keep using it this time.
      return legacy;
    }
  }
  return root;
}

/** All on-disk locations used by the launcher, derived from one root folder. */
function createPaths(root = defaultRoot()) {
  return {
    root,
    versions: path.join(root, 'versions'),
    libraries: path.join(root, 'libraries'),
    assets: path.join(root, 'assets'),
    runtimes: path.join(root, 'runtimes'),
    natives: path.join(root, 'natives'),
    instances: path.join(root, 'instances'),
    skins: path.join(root, 'skins'),
    cache: path.join(root, 'cache'),
    settingsFile: path.join(root, 'settings.json'),
    accountsFile: path.join(root, 'accounts.json'),
    versionDir: (id) => path.join(root, 'versions', id),
    versionJson: (id) => path.join(root, 'versions', id, `${id}.json`),
    versionJar: (id) => path.join(root, 'versions', id, `${id}.jar`),
  };
}

module.exports = { createPaths, defaultRoot };
