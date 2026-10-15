/** Shared app state, the bridge to the main process, and a tiny event bus. */

const bridge = window.obsidian;

export function call(method, ...args) {
  return bridge.call(method, ...args);
}

export function onMain(event, fn) {
  return bridge.on(event, fn);
}

export function pathForFile(file) {
  return bridge.pathForFile(file);
}

const listeners = new Map();

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event).delete(fn);
}

export function emit(event, ...args) {
  for (const fn of listeners.get(event) || []) {
    try {
      fn(...args);
    } catch (err) {
      console.error(err);
    }
  }
}

export const state = {
  info: {},
  settings: {},
  instances: [],
  states: {},
  accounts: [],
  tasks: [],
  update: { state: 'idle' },
};

export async function refreshInstances() {
  const r = await call('instances:list');
  state.instances = r.instances;
  state.states = r.states;
  emit('instances');
  return state.instances;
}

export async function refreshAccounts() {
  state.accounts = await call('accounts:list');
  emit('accounts');
  return state.accounts;
}

export async function refreshSettings() {
  state.settings = await call('settings:get');
  emit('settings');
  return state.settings;
}

export async function updateSettings(changes) {
  state.settings = await call('settings:update', changes);
  emit('settings');
  return state.settings;
}

export function activeAccount() {
  return state.accounts.find((a) => a.active) || state.accounts[0] || null;
}

export function instanceById(id) {
  return state.instances.find((i) => i.id === id) || null;
}

/** The launch task currently running for an instance, if any. */
export function launchTask(id) {
  return state.tasks.find((t) => t.ref === id && t.kind === 'launch' && t.status === 'running') || null;
}

export function gameState(id) {
  return state.states[id] || 'idle';
}
