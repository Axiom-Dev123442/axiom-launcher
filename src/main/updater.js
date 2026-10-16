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

  // People leave the launcher open for hours, so look often: at start, every 30 minutes, and when
  // they come back to the window (at most every 10 minutes). Once an update is ready, stop looking.
  let lastCheck = 0;
  const check = (minGapMs) => {
    if (status.state === 'ready' || status.state === 'downloading' || Date.now() - lastCheck < minGapMs) return;
    lastCheck = Date.now();
    autoUpdater.checkForUpdates().catch(() => {});
  };
  setTimeout(() => check(0), 5000);
  setInterval(() => check(0), 30 * 60 * 1000);
  require('electron').app.on('browser-window-focus', () => check(10 * 60 * 1000));
}

module.exports = { setupUpdater };
