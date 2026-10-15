/** Entry point for the launcher interface. */
import { h } from './lib/dom.js';
import { applyTheme } from './lib/themes.js';
import { call, onMain, emit, state, refreshInstances, refreshAccounts, refreshSettings } from './lib/store.js';
import { toast, showError } from './lib/ui.js';
import { registerPage, render, navigate } from './router.js';
import { sidebar, titlebar } from './components/shell.js';
import { homePage } from './pages/home.js';
import { libraryPage } from './pages/library.js';
import { instancePage } from './pages/instance.js';
import { browsePage } from './pages/browse.js';
import { skinsPage } from './pages/skins.js';
import { settingsPage } from './pages/settings.js';

registerPage('home', homePage);
registerPage('library', libraryPage);
registerPage('instance', instancePage);
registerPage('browse', browsePage);
registerPage('skins', skinsPage);
registerPage('settings', settingsPage);

async function boot() {
  const [info, settings] = await Promise.all([call('app:info'), refreshSettings()]);
  state.info = info;
  applyTheme(settings.theme, settings.accent, settings.animations);
  await Promise.all([refreshInstances(), refreshAccounts()]);
  state.tasks = await call('tasks:list');
  try {
    state.update = await call('updates:status');
  } catch {}

  const app = document.getElementById('app');
  app.append(sidebar(), titlebar(), h('main.main'));
  render();

  onMain('tasks', (list) => {
    state.tasks = list;
    emit('tasks');
  });
  onMain('game-state', (id, st) => {
    if (st === 'idle') delete state.states[id];
    else state.states[id] = st;
    emit('game-state', id, st);
    if (st === 'idle') refreshInstances();
  });
  onMain('game-exit', (id, info) => {
    const inst = state.instances.find((i) => i.id === id);
    if (info.crashed) {
      toast(`${inst ? inst.name : 'Minecraft'} crashed`, {
        kind: 'error',
        message: `Exit code ${info.code}. The console has the details.`,
        actions: [{ label: 'View console', primary: true, onClick: () => navigate({ page: 'instance', id, tab: 'console' }) }],
        timeout: 10000,
      });
    }
  });
  onMain('update-status', (st) => {
    state.update = st;
    emit('update');
    if (st.state === 'ready') {
      toast(`Obsidian ${st.version} is ready`, {
        message: 'Restart to finish updating.',
        actions: [{ label: 'Restart now', primary: true, onClick: () => call('updates:install') }],
        timeout: 0,
      });
    }
  });

  // Dropping a modpack anywhere imports it.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (e.defaultPrevented && e.target.closest('.dropzone')) return;
    if (e.target.closest && e.target.closest('.dropzone')) return;
    const f = e.dataTransfer.files[0];
    if (!f || !/\.(mrpack|zip)$/i.test(f.name)) return;
    const { afterImport } = await import('./components/newInstance.js');
    try {
      const r = await call('modpacks:import', window.obsidian.pathForFile(f));
      if (r) {
        await refreshInstances();
        afterImport(r);
      }
    } catch (err) {
      showError(err, 'Import failed');
    }
  });
}

boot().catch((err) => {
  document.getElementById('app').replaceChildren(h('div.center', { style: 'grid-column:1/-1;grid-row:1/-1' }, h('div', h('h2', 'Obsidian failed to start'), h('p.muted', err.message))));
});
