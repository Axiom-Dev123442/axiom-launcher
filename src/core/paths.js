'use strict';
const path = require('node:path');
const os = require('node:os');

function defaultRoot() {
  if (process.env.OBSIDIAN_HOME) return process.env.OBSIDIAN_HOME;
  const base =
    process.env.APPDATA ||
    (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : path.join(os.homedir(), '.local', 'share'));
  return path.join(base, '.obsidian');
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
