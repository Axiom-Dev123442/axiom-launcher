import { h, btn, iconBtn, segmented, spinner } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { call, state, refreshAccounts, activeAccount } from '../lib/store.js';
import { showError, toast, promptDialog, confirmDialog, menu } from '../lib/ui.js';
import { accountSkin, createViewer, setAnimation, frontView, capeView, defaultSkin } from '../lib/skin.js';
import { onLeave, pageOn, render } from '../router.js';
import { accountMenu } from '../components/accounts.js';

export function skinsPage() {
  const el = h('div.page');
  const account = activeAccount();
  const isMs = account && account.type === 'microsoft';

  let viewer = null;
  let library = [];
  let selected = null; // library skin id, or null for the account's current skin
  let variant = account && account.skin ? account.skin.variant : 'classic';
  let anim = 'idle';
  onLeave(() => viewer && viewer.dispose());

  const viewerBox = h('div.viewer', h('div.center', spinner('lg')));
  const grid = h('div.skin-grid');
  const capes = h('div.cape-row');
  const applyBtn = btn('Apply to account', { cls: 'primary', icon: 'check', disabled: true });
  const variantSeg = h('div');

  const loadIntoViewer = async (src, v, capeUrl) => {
    if (!viewer) {
      const created = createViewer({ width: 360, height: 400, src, variant: v, animation: anim, zoom: 0.85 });
      if (!created) {
        viewerBox.replaceChildren(h('div.dim', '3D preview is unavailable on this computer.'));
        return;
      }
      viewer = created.viewer;
      viewerBox.replaceChildren(created.canvas);
    } else {
      await viewer.loadSkin(src, { model: v === 'slim' ? 'slim' : 'default' });
    }
    if (capeUrl) {
      try {
        viewer.loadCape(await call('skins:image', capeUrl));
      } catch {
        viewer.resetCape();
      }
    } else {
      viewer.resetCape();
    }
  };

  const activeCape = () => (account && account.capes ? account.capes.find((c) => c.active) : null);

  const showCurrent = async () => {
    selected = null;
    const { src, variant: v } = await accountSkin(account);
    variant = v;
    renderVariant();
    await loadIntoViewer(src, v, activeCape() && activeCape().url);
    applyBtn.disabled = true;
    renderGrid();
  };

  const showLibrary = async (skin) => {
    selected = skin.id;
    variant = skin.variant;
    renderVariant();
    await loadIntoViewer(skin.data, skin.variant, activeCape() && activeCape().url);
    applyBtn.disabled = !isMs;
    renderGrid();
  };

  const renderVariant = () => {
    variantSeg.replaceChildren(
      segmented(
        [
          { value: 'classic', label: 'Classic arms' },
          { value: 'slim', label: 'Slim arms' },
        ],
        variant,
        async (v) => {
          variant = v;
          const skin = library.find((s) => s.id === selected);
          if (skin) {
            await call('skins:update', skin.id, { variant: v });
            skin.variant = v;
            await viewer.loadSkin(skin.data, { model: v === 'slim' ? 'slim' : 'default' });
            renderGrid();
          } else if (viewer) {
            const { src } = await accountSkin(account);
            await viewer.loadSkin(src, { model: v === 'slim' ? 'slim' : 'default' });
            applyBtn.disabled = !isMs;
          }
        },
      ),
    );
  };

  const skinCard = (skin) => {
    const card = h(
      'div.skin-card',
      { class: selected === skin.id ? 'active' : '', onclick: () => showLibrary(skin) },
      frontView(skin.data, skin.variant),
      h('div.n', skin.name),
    );
    const more = iconBtn('dots', { cls: 'x', title: 'More' });
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      menu(more, [
        {
          label: 'Rename',
          icon: 'edit',
          onClick: async () => {
            const name = await promptDialog({ title: 'Rename skin', value: skin.name });
            if (!name) return;
            await call('skins:update', skin.id, { name });
            loadLibrary();
          },
        },
        {
          label: 'Delete',
          icon: 'trash',
          danger: true,
          onClick: async () => {
            if (!(await confirmDialog({ title: `Delete ${skin.name}?`, message: 'It is removed from your skin library.', confirm: 'Delete', danger: true }))) return;
            await call('skins:remove', skin.id);
            if (selected === skin.id) showCurrent();
            loadLibrary();
          },
        },
      ]);
    });
    card.append(more);
    return card;
  };

  const renderGrid = () => {
    const current = h(
      'div.skin-card',
      { class: selected === null ? 'active' : '', onclick: () => showCurrent() },
      h('span.chip.accent.equipped', { style: 'height:20px;font-size:10.5px' }, 'Wearing'),
      frontView(defaultSkin(), 'classic'),
      h('div.n', 'Current skin'),
    );
    accountSkin(account).then(({ src, variant: v }) => current.querySelector('canvas').replaceWith(frontView(src, v)));
    grid.replaceChildren(current, ...library.map(skinCard));
  };

  const loadLibrary = async () => {
    try {
      library = await call('skins:library');
    } catch (err) {
      showError(err);
    }
    renderGrid();
  };

  const renderCapes = () => {
    if (!isMs) {
      capes.replaceChildren(h('p.dim.small', { style: 'margin:0' }, 'Capes are available on Microsoft accounts that own them.'));
      return;
    }
    const list = account.capes || [];
    const pick = async (capeId) => {
      try {
        await call('skins:setCape', account.id, capeId);
        await refreshAccounts();
        toast(capeId ? 'Cape equipped' : 'Cape removed', { kind: 'success', timeout: 2000 });
      } catch (err) {
        showError(err, 'Couldn’t change cape');
      }
    };
    capes.replaceChildren(
      h('button.cape', { class: list.some((c) => c.active) ? '' : 'active', title: 'No cape', onclick: () => pick(null) }, h('span.none', 'None')),
      ...list.map((c) => {
        const b = h('button.cape', { class: c.active ? 'active' : '', title: c.alias, onclick: () => pick(c.id) }, h('div.spinner'));
        call('skins:image', c.url).then((src) => b.replaceChildren(capeView(src)), () => b.replaceChildren(h('span.none', c.alias)));
        return b;
      }),
    );
    if (!list.length) capes.append(h('p.dim.small', { style: 'margin:0;align-self:center' }, 'This account has no capes.'));
  };

  applyBtn.addEventListener('click', async () => {
    if (!isMs) return;
    applyBtn.disabled = true;
    try {
      if (selected) {
        await call('skins:apply', selected, account.id, variant);
      } else {
        const lib = await call('skins:addCurrent', account.id);
        await call('skins:apply', lib, account.id, variant);
        loadLibrary();
      }
      await refreshAccounts();
      toast('Skin updated', { kind: 'success', message: 'It can take a minute to show up in game and on servers.' });
    } catch (err) {
      showError(err, 'Couldn’t change skin');
      applyBtn.disabled = false;
    }
  });

  const addMenu = (anchor) =>
    menu(anchor, [
      {
        label: 'Upload a PNG file',
        icon: 'upload',
        onClick: async () => {
          try {
            const id = await call('skins:addFile', null, variant);
            if (id) await loadLibrary();
          } catch (err) {
            showError(err, 'Couldn’t add skin');
          }
        },
      },
      {
        label: 'Copy from a player',
        icon: 'users',
        onClick: async () => {
          const name = await promptDialog({ title: 'Copy a player’s skin', label: 'Minecraft username', placeholder: 'Notch', confirm: 'Copy skin' });
          if (!name) return;
          try {
            await call('skins:addUsername', name);
            await loadLibrary();
            toast('Skin added to your library', { kind: 'success' });
          } catch (err) {
            showError(err, 'Couldn’t copy skin');
          }
        },
      },
      isMs && account.skin
        ? {
            label: 'Save my current skin',
            icon: 'download',
            onClick: async () => {
              try {
                await call('skins:addCurrent', account.id);
                await loadLibrary();
              } catch (err) {
                showError(err);
              }
            },
          }
        : null,
    ]);

  const addBtn = btn('Add skin', { cls: 'primary', icon: 'plus' });
  addBtn.addEventListener('click', () => addMenu(addBtn));

  const stage = h(
    'div.stage',
    h(
      'div.stage-top',
      h('div', h('h2', account ? account.name : 'No account'), h('div.small.dim', account ? (isMs ? 'Microsoft account' : 'Offline account') : 'Add an account to change skins')),
      segmented(
        [
          { value: 'idle', label: '', icon: 'user' },
          { value: 'walk', label: '', icon: 'walk' },
          { value: 'none', label: '', icon: 'pause' },
        ],
        anim,
        (v) => {
          anim = v;
          setAnimation(viewer, v);
        },
      ),
    ),
    viewerBox,
    h(
      'div.stage-bottom',
      variantSeg,
      isMs
        ? h('div.row', applyBtn, btn('Reset', {
            cls: 'ghost',
            icon: 'rotate',
            onClick: async () => {
              if (!(await confirmDialog({ title: 'Reset to the default skin?', message: 'Your account goes back to a default skin.', confirm: 'Reset' }))) return;
              try {
                await call('skins:reset', account.id);
                await refreshAccounts();
                render();
              } catch (err) {
                showError(err);
              }
            },
          }))
        : h('p.small.dim', { style: 'margin:0' }, account ? 'Offline accounts can preview skins here, but other players and servers won’t see them.' : ''),
    ),
  );

  el.append(
    h('div.page-head', h('div.titles', h('h1', 'Skins'), h('p', 'Preview, save and switch skins and capes.')), !account ? btn('Add account', { cls: 'primary', icon: 'user', onClick: (e) => accountMenu(e.currentTarget) }) : null),
    h(
      'div.skins',
      stage,
      h(
        'div',
        h('div.section-head', { style: 'margin-top:0' }, h('h2', 'Your skins'), addBtn),
        grid,
        h('div.section-head', h('h2', 'Capes')),
        capes,
      ),
    ),
  );

  renderVariant();
  renderCapes();
  showCurrent();
  loadLibrary();
  pageOn('accounts', () => render());
  return { el };
}
