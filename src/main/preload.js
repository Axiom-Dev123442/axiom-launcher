'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

async function call(method, ...args) {
  const r = await ipcRenderer.invoke('api', method, ...args);
  if (r.ok) return r.data;
  const err = new Error(r.error.message);
  Object.assign(err, r.error);
  throw err;
}

const EVENTS = ['tasks', 'game-state', 'game-log', 'game-exit', 'login-code', 'update-status', 'window-state'];

contextBridge.exposeInMainWorld('obsidian', {
  call,
  on(event, fn) {
    if (!EVENTS.includes(event)) throw new Error(`Unknown event ${event}`);
    const listener = (_e, ...args) => fn(...args);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  },
  pathForFile(file) {
    return webUtils.getPathForFile(file);
  },
});
