import { h, btn, iconBtn, searchInput, select } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { call, state, refreshInstances } from '../lib/store.js';
import { blurBackground } from '../lib/blocks.js';
import { menu, confirmDialog, promptDialog, showError, toast } from '../lib/ui.js';
import { ago, duration } from '../lib/format.js';
import { pageOn } from '../router.js';
import { instanceIcon, loaderChip, versionChip, roundPlay, openInstance, launch, statusDot } from '../components/common.js';
import { newInstanceDialog } from '../components/newInstance.js';

/** The actions menu shared by instance cards and the instance page. */
export function instanceMenu(anchor, inst, { onDeleted } = {}) {
  menu(anchor, [
    { label: 'Play', icon: 'play', onClick: () => launch(inst.id) },
    { label: 'Open folder', icon: 'folder', onClick: () => call('app:openFolder', 'instance', inst.id) },
    'sep',
    {
      label: 'Rename',
      icon: 'edit',
      onClick: async () => {
        const name = await promptDialog({ title: 'Rename instance', label: 'Name', value: inst.name });
        if (!name) return;
        await call('instances:update', inst.id, { name });
        await refreshInstances();
      },
    },
    {
      label: 'Duplicate',
      icon: 'copy',
      onClick: async () => {
        try {
          const copy = await call('instances:duplicate', inst.id);
          await refreshInstances();
          toast(`Created ${copy.name}`, { kind: 'success' });
        } catch (err) {
          showError(err);
        }
      },
    },
    {
      label: 'Export as .mrpack',
      icon: 'share',
      onClick: async () => {
        try {
          const out = await call('modpacks:export', inst.id, { include: { config: true, resourcepacks: true, shaderpacks: true } });
          if (out) toast('Exported', { kind: 'success', message: out });
        } catch (err) {
          showError(err, 'Export failed');
        }
      },
    },
    {
      label: 'Repair game files',
      icon: 'wrench',
      onClick: () => call('game:repair', inst.id).then(() => toast('Repair finished', { kind: 'success' }), (err) => showError(err, 'Repair failed')),
    },
    'sep',
    {
      label: 'Delete',
      icon: 'trash',
      danger: true,
      onClick: async () => {
        const ok = await confirmDialog({
          title: `Delete ${inst.name}?`,
          message: 'This permanently deletes the instance, including its worlds, mods and screenshots.',
          confirm: 'Delete forever',
          danger: true,
        });
        if (!ok) return;
        try {
          await call('instances:remove', inst.id);
          await refreshInstances();
          if (onDeleted) onDeleted();
        } catch (err) {
          showError(err);
        }
      },
    },
  ]);
}

function card(inst, i) {
  const more = iconBtn('dots', { cls: 'more', title: 'More' });
  more.addEventListener('click', (e) => {
    e.stopPropagation();
    instanceMenu(more, inst);
  });
  const el = h(
    'div.icard',
    { style: `animation-delay:${Math.min(i, 12) * 30}ms`, onclick: () => openInstance(inst.id) },
    h('div.cover', blurBackground(h('div.bgimg'), inst.icon), instanceIcon(inst), h('div.status', statusDot(inst.id))),
    more,
    h(
      'div.body',
      h('div.name', inst.name),
      h('div.chips', versionChip(inst), loaderChip(inst), inst.modpack && inst.modpack.name ? h('span.chip', icon('package'), 'Pack') : null),
      h('div.foot', inst.lastPlayed ? `${/ago|now|Yesterday/.test(ago(inst.lastPlayed)) ? `Played ${ago(inst.lastPlayed).toLowerCase()}` : `Played ${ago(inst.lastPlayed)}`}${inst.playtime ? ` · ${duration(inst.playtime)}` : ''}` : 'Never played'),
    ),
    roundPlay(inst.id),
  );
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    instanceMenu(e, inst);
  });
  return el;
}

export function libraryPage() {
  const el = h('div.page');
  let query = '';
  let filter = 'all';
  let sort = 'recent';
  const grid = h('div.grid');

  const renderGrid = () => {
    let list = state.instances.filter((i) => i.name.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || i.loader === filter));
    if (sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'playtime') list = [...list].sort((a, b) => (b.playtime || 0) - (a.playtime || 0));
    if (sort === 'version') list = [...list].sort((a, b) => b.mcVersion.localeCompare(a.mcVersion, undefined, { numeric: true }));
    if (!state.instances.length) {
      grid.replaceChildren();
      el.querySelector('.lib-empty')?.remove();
      grid.before(
        h(
          'div.empty.lib-empty',
          h('div.art', icon('library')),
          h('h2', 'No instances yet'),
          h('p', 'An instance is a separate Minecraft setup with its own version, mods and worlds.'),
          h('div.row', btn('New instance', { cls: 'primary', icon: 'plus', onClick: () => newInstanceDialog() }), btn('Import', { icon: 'package', onClick: () => newInstanceDialog({ tab: 'import' }) })),
        ),
      );
      return;
    }
    el.querySelector('.lib-empty')?.remove();
    grid.replaceChildren(...list.map(card));
    if (!list.length) grid.replaceChildren(h('div.dim', { style: 'grid-column:1/-1;padding:30px;text-align:center' }, 'Nothing matches your search.'));
  };

  el.append(
    h(
      'div.page-head',
      h('div.titles', h('h1', 'Library'), h('p', `${state.instances.length} instance${state.instances.length === 1 ? '' : 's'}`)),
      btn('Import', { icon: 'package', onClick: () => newInstanceDialog({ tab: 'import' }) }),
      btn('New instance', { cls: 'primary', icon: 'plus', onClick: () => newInstanceDialog() }),
    ),
    h(
      'div.toolbar',
      searchInput('Search instances', '', (v) => {
        query = v;
        renderGrid();
      }, 0),
      select(
        [
          { value: 'all', label: 'All loaders' },
          { value: 'vanilla', label: 'Vanilla' },
          { value: 'fabric', label: 'Fabric' },
          { value: 'forge', label: 'Forge' },
        ],
        filter,
        (v) => {
          filter = v;
          renderGrid();
        },
      ),
      select(
        [
          { value: 'recent', label: 'Recently played' },
          { value: 'name', label: 'Name' },
          { value: 'playtime', label: 'Play time' },
          { value: 'version', label: 'Version' },
        ],
        sort,
        (v) => {
          sort = v;
          renderGrid();
        },
      ),
    ),
    grid,
  );
  for (const s of el.querySelectorAll('.toolbar .select')) s.style.width = '180px';
  renderGrid();
  pageOn('instances', renderGrid);
  pageOn('game-state', renderGrid);
  return { el };
}

