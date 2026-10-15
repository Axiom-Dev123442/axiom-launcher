/** Sidebar and title bar: the parts of the window that never change. */
import { h, iconBtn } from '../lib/dom.js';
import { icon, logo } from '../lib/icons.js';
import { call, on, onMain, state, activeAccount, gameState } from '../lib/store.js';
import { accountHead } from '../lib/skin.js';
import { navigate, route } from '../router.js';
import { accountMenu } from './accounts.js';
import { openDownloads } from './downloads.js';
import { instanceIcon } from './common.js';

const NAV = [
  { page: 'home', label: 'Home', icon: 'home' },
  { page: 'library', label: 'Library', icon: 'library' },
  { page: 'browse', label: 'Browse', icon: 'compass' },
  { page: 'skins', label: 'Skins', icon: 'shirt' },
  { page: 'settings', label: 'Settings', icon: 'settings' },
];

export function sidebar() {
  const nav = h('nav.nav');
  const recent = h('div.side-recent');
  const account = h('div.account-card');

  const renderNav = () => {
    nav.replaceChildren(
      ...NAV.map((n) =>
        h(
          'button.nav-item',
          {
            class: route.page === n.page || (n.page === 'library' && route.page === 'instance') ? 'active' : '',
            onclick: () => navigate({ page: n.page }),
          },
          icon(n.icon),
          n.label,
          n.page === 'library' && state.instances.length ? h('span.count', state.instances.length) : null,
        ),
      ),
    );
  };

  const renderRecent = () => {
    const items = state.instances.slice(0, 6);
    recent.replaceChildren(
      items.length ? h('div.nav-label', 'Recent') : null,
      ...items.map((inst) => {
        const st = gameState(inst.id);
        return h(
          'button.nav-item',
          { class: route.page === 'instance' && route.id === inst.id ? 'active' : '', onclick: () => navigate({ page: 'instance', id: inst.id }), title: inst.name },
          instanceIcon(inst),
          h('span', { style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, inst.name),
          st !== 'idle' ? h('span.dot', { class: st === 'preparing' ? 'preparing' : '' }) : null,
        );
      }),
    );
  };

  const renderAccount = () => {
    const acc = activeAccount();
    account.replaceChildren(
      acc ? accountHead(acc) : h('div.head', { style: 'display:grid;place-items:center;color:var(--text-3)' }, icon('user')),
      h(
        'div.meta',
        h('div.name', acc ? acc.name : 'Add an account'),
        h('div.type', acc ? (acc.type === 'microsoft' ? 'Microsoft account' : 'Offline account') : 'Microsoft or offline'),
      ),
      icon('chevronUpDown', 'chev'),
    );
  };
  account.addEventListener('click', () => accountMenu(account));

  renderNav();
  renderRecent();
  renderAccount();
  on('route', () => {
    renderNav();
    renderRecent();
  });
  on('instances', () => {
    renderNav();
    renderRecent();
  });
  on('game-state', renderRecent);
  on('accounts', renderAccount);

  return h('aside.sidebar', h('div.brand', logo(), h('span.word', 'OBSIDIAN')), nav, recent, account);
}

export function titlebar() {
  const crumbs = h('div.crumbs');
  const dlBtn = iconBtn('download', { title: 'Downloads' });
  dlBtn.addEventListener('click', () => openDownloads(dlBtn));
  const updateSlot = h('span');
  const maxBtn = iconBtn('square', { cls: 'win-btn', title: 'Maximize', onClick: () => call('window:maximize') });
  maxBtn.className = 'win-btn';

  const renderBadge = () => {
    const running = state.tasks.filter((t) => t.status === 'running').length;
    const old = dlBtn.querySelector('.badge');
    if (old) old.remove();
    if (running) dlBtn.append(h('span.badge', running));
    dlBtn.classList.toggle('spin', false);
  };
  const renderUpdate = () => {
    const u = state.update;
    if (u.state === 'ready') {
      updateSlot.replaceChildren(h('button.update-pill', { onclick: () => call('updates:install') }, icon('refresh'), `Restart to update to ${u.version}`));
    } else if (u.state === 'downloading') {
      updateSlot.replaceChildren(h('span.chip', icon('download'), `Updating ${u.percent || 0}%`));
    } else {
      updateSlot.replaceChildren();
    }
  };
  const renderCrumbs = () => {
    const names = { home: 'Home', library: 'Library', browse: 'Browse', skins: 'Skins', settings: 'Settings', instance: 'Library' };
    let text = names[route.page] || '';
    if (route.page === 'instance') {
      const inst = state.instances.find((i) => i.id === route.id);
      if (inst) text = `Library  ›  ${inst.name}`;
    }
    crumbs.textContent = text;
  };
  on('tasks', renderBadge);
  on('update', renderUpdate);
  on('route', renderCrumbs);
  on('instances', renderCrumbs);
  onMain('window-state', (s) => maxBtn.replaceChildren(icon(s.maximized ? 'squares' : 'square')));
  renderBadge();
  renderCrumbs();

  const win = h(
    'div.win-controls',
    h('button.win-btn', { title: 'Minimize', onclick: () => call('window:minimize') }, icon('minus')),
    maxBtn,
    h('button.win-btn.close', { title: 'Close', onclick: () => call('window:close') }, icon('x')),
  );
  return h('header.titlebar', crumbs, h('div.tb-actions', updateSlot, dlBtn), win);
}
