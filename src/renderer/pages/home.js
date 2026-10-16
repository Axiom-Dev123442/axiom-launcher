import { h, btn } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { state, activeAccount } from '../lib/store.js';
import { iconSrc } from '../lib/blocks.js';
import { accountSkin, createViewer, skinThumbImg, performanceMode } from '../lib/skin.js';
import { duration, ago, greeting, loaderName } from '../lib/format.js';
import { pageOn, onLeave, navigate, render } from '../router.js';
import { instanceIcon, loaderChip, versionChip, playButton, roundPlay, openInstance, axiomChip } from '../components/common.js';
import { newInstanceDialog } from '../components/newInstance.js';
import { accountMenu } from '../components/accounts.js';

function heroPlayer(account, onViewer) {
  const wrap = h('div.player');
  const tag = h('div.tag', account ? account.name : 'Player');
  wrap.append(tag);
  accountSkin(account).then(({ src, variant }) => {
    // Low-end PCs get a still render instead of a live 3D scene.
    if (performanceMode()) {
      wrap.append(skinThumbImg(src, variant, ''));
      return;
    }
    const v = createViewer({ width: 280, height: 360, src, variant, animation: 'idle', zoom: 0.82 });
    if (!v) return;
    wrap.append(v.canvas);
    onViewer(v.viewer);
  });
  return wrap;
}

function emptyHero() {
  return h(
    'div.hero',
    { style: 'grid-template-columns:1fr' },
    h('div.art'),
    h(
      'div.content',
      { style: 'justify-content:center;align-items:flex-start' },
      h('h1', 'Get the Axiom Client'),
      h('p.muted', { style: 'margin:0;max-width:520px' }, 'Minecraft 26.3 with the Axiom menu, PvP and Bedwars mods and cosmetics built in, set up in one click. Or make an instance with any version and loader.'),
      h(
        'div.actions',
        btn('Get Axiom Client', { cls: 'primary lg', icon: 'plus', onClick: () => newInstanceDialog() }),
        btn('Browse modpacks', { cls: 'lg', icon: 'compass', onClick: () => navigate({ page: 'browse', type: 'modpack' }) }),
        btn('Import', { cls: 'lg ghost', icon: 'package', onClick: () => newInstanceDialog({ tab: 'import' }) }),
      ),
    ),
  );
}

export function homePage() {
  const el = h('div.page');
  let viewer = null;
  onLeave(() => viewer && viewer.dispose());

  const account = activeAccount();
  const instances = state.instances;
  const lastId = state.settings.lastInstance;
  const featured = instances.find((i) => i.id === lastId) || instances[0];

  el.append(
    h(
      'div.page-head',
      h('div.titles', h('h1', `${greeting()}${account ? `, ${account.name}` : ''}`)),
      btn('New instance', { cls: 'primary', icon: 'plus', onClick: () => newInstanceDialog() }),
    ),
  );

  if (!account) {
    el.append(
      h(
        'div.banner',
        icon('user'),
        h('div.grow', h('b', 'Add an account to play'), h('span.muted', 'Sign in with Microsoft, or use an offline account with any username.')),
        btn('Add account', {
          cls: 'primary sm',
          onClick: (e) => accountMenu(e.currentTarget),
        }),
      ),
    );
  }

  if (!featured) {
    el.append(emptyHero());
    return { el };
  }

  const hero = h(
    'div.hero',
    { style: `--hero-img:url("${iconSrc(featured.icon)}")` },
    h('div.art'),
    h(
      'div.content',
      h('div.row', { style: 'gap:16px' }, instanceIcon(featured), h('div', h('div.eyebrow', featured.lastPlayed ? `Last played ${ago(featured.lastPlayed).toLowerCase()}` : 'Not played yet'), h('div.row.wrap', { style: 'gap:6px;margin-top:6px' }, versionChip(featured), loaderChip(featured), axiomChip(featured), featured.modpack && featured.modpack.name ? h('span.chip', icon('package'), 'Modpack') : null))),
      h('h1', featured.name),
      h(
        'div.stats',
        h('div', h('b', duration(featured.playtime)), 'Play time'),
        h('div', h('b', `${loaderName(featured.loader)} ${featured.mcVersion}`), 'Version'),
      ),
      h(
        'div.actions',
        playButton(featured.id),
        btn('', { cls: 'icon lg', icon: 'settings', title: 'Instance settings', onClick: () => openInstance(featured.id, 'settings') }),
        btn('', { cls: 'icon lg', icon: 'folder', title: 'Open folder', onClick: () => window.axiom.call('app:openFolder', 'instance', featured.id) }),
      ),
    ),
    heroPlayer(account, (v) => (viewer = v)),
  );
  el.append(hero);

  const others = instances.filter((i) => i.id !== featured.id).slice(0, 7);
  el.append(
    h('div.section-head', h('h2', 'Your instances'), btn('View all', { cls: 'ghost sm', icon: 'chevronRight', onClick: () => navigate({ page: 'library' }) })),
    h(
      'div.shelf.stagger',
      ...others.map((inst) =>
        h(
          'div.tile',
          { onclick: () => openInstance(inst.id) },
          instanceIcon(inst),
          h('div.meta', h('div.name', inst.name), h('div.sub', `${loaderName(inst.loader)} ${inst.mcVersion}`)),
          h('div.quick', roundPlay(inst.id)),
        ),
      ),
      h('div.tile.add', { onclick: () => newInstanceDialog() }, icon('plus'), 'New instance'),
    ),
  );

  pageOn('instances', () => render());
  pageOn('accounts', () => render());
  return { el };
}
