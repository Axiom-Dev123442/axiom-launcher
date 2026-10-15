'use strict';

/**
 * Auto updates from GitHub Releases. The web installer and the updater share
 * the same release files, so publishing a release updates everyone.
 */
function setupUpdater({ send, enabled, api }) {
  let autoUpdater = null;
  let status = { state: enabled ? 'idle' : 'disabled' };
  const set = (next) => {
    status = next;
    send('update-status', status);
  };

  api['updates:status'] = async () => status;
  api['updates:check'] = async () => {
    if (!autoUpdater) return status;
    await autoUpdater.checkForUpdates().catch((err) => set({ state: 'error', message: err.message }));
    return status;
  };
  api['updates:install'] = async () => {
    if (autoUpdater && status.state === 'ready') autoUpdater.quitAndInstall(false, true);
  };

  if (!enabled) return;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch {
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => set({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => set({ state: 'latest' }));
  autoUpdater.on('update-available', (info) => set({ state: 'downloading', version: info.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => set({ ...status, state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', version: info.version }));
  autoUpdater.on('error', (err) => set({ state: 'error', message: err.message }));

  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000);
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
}

module.exports = { setupUpdater };
