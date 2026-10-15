import { h, btn, iconBtn, segmented, select, spinner } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { call, refreshAccounts, activeAccount } from '../lib/store.js';
import { showError, toast, promptDialog, confirmDialog, menu } from '../lib/ui.js';
import { accountSkin, createViewer, setAnimation, skinThumbImg, capeView } from '../lib/skin.js';
import { onLeave, pageOn, render } from '../router.js';
import { accountMenu } from '../components/accounts.js';

const ANIMATIONS = [
  { value: 'idle', label: 'Idle' },
  { value: 'walk', label: 'Walk' },
  { value: 'run', label: 'Run' },
  { value: 'wave', label: 'Wave' },
  { value: 'crouch', label: 'Crouch' },
  { value: 'fly', label: 'Fly' },
  { value: 'none', label: 'Still' },
];

// Viewer preferences survive page changes while the app is open.
const prefs = { anim: 'idle', rotate: false, elytra: false };

export function skinsPage() {
  const el = h('div.page');
  const account = activeAccount();
  const isMs = account && account.type === 'microsoft';

  let viewer = null;
  let library = [];
  let selected = null; // library skin id, or null for the account's current skin
  let variant = account && account.skin ? account.skin.variant : 'classic';
  let currentCape = null;
  onLeave(() => viewer && viewer.dispose());

  const viewerBox = h('div.viewer', h('div.center', spinner('lg')));
  const grid = h('div.skin-grid');
  const capes = h('div.cape-row');
  const applyBtn = btn('Apply to account', { cls: 'primary', icon: 'check', disabled: true });
  const variantSeg = h('div');
  const caption = h('div.small.dim');

  const activeCape = () => (account && account.capes ? account.capes.find((c) => c.active) : null);

  const applyBack = async () => {
    if (!viewer) return;
    if (!currentCape) {
      viewer.resetCape();
      return;
    }
    try {
      viewer.loadCape(await call('skins:image', currentCape.url), { backEquipment: prefs.elytra ? 'elytra' : 'cape' });
    } catch {
      viewer.resetCape();
    }
  };

  const loadIntoViewer = async (src, v) => {
    if (!viewer) {
      const created = createViewer({
        width: 380,
        height: 470,
        src,
        variant: v,
        animation: prefs.anim,
        zoom: 0.72,
        rotate: prefs.rotate,
      });
      if (!created) {
        viewerBox.replaceChildren(h('div.dim', '3D preview is unavailable on this computer.'));
        return;
      }
      viewer = created.viewer;
      viewerBox.replaceChildren(created.canvas);
    } else {
      await viewer.loadSkin(src, { model: v === 'slim' ? 'slim' : 'default' });
    }
    await applyBack();
  };

  const showCurrent = async () => {
    selected = null;
    const { src, variant: v } = await accountSkin(account);
    variant = v;
    caption.textContent = 'Your current skin';
    renderVariant();
    await loadIntoViewer(src, v);
    applyBtn.disabled = true;
    renderGrid();
  };

  const showLibrary = async (skin) => {
    selected = skin.id;
    variant = skin.variant;
    caption.textContent = `Previewing ${skin.name}`;
    renderVariant();
    await loadIntoViewer(skin.data, skin.variant);
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
      { class: selected === skin.id ? 'active' : '', onclick: () => showLibrary(skin), title: skin.name },
      h('div.thumb', skinThumbImg(skin.data, skin.variant)),
      h('div.n', skin.name),
      h('div.v', skin.variant === 'slim' ? 'Slim' : 'Classic'),
    );
    const more = iconBtn('dots', { cls: 'x', title: 'More' });
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      menu(more, [
        isMs
          ? {
              label: 'Wear this skin',
              icon: 'check',
              onClick: async () => {
                try {
                  await call('skins:apply', skin.id, account.id, skin.variant);
                  await refreshAccounts();
                  toast('Skin updated', { kind: 'success' });
                } catch (err) {
                  showError(err, 'Couldn’t change skin');
                }
              },
            }
          : null,
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
    const thumb = h('div.thumb', h('div.spinner'));
    const current = h(
      'div.skin-card',
      { class: selected === null ? 'active' : '', onclick: () => showCurrent() },
      h('span.chip.accent.equipped', 'Wearing'),
      thumb,
      h('div.n', 'Current skin'),
      h('div.v', variant === 'slim' ? 'Slim' : 'Classic'),
    );
    accountSkin(account).then(({ src, variant: v }) => thumb.replaceChildren(skinThumbImg(src, v)));
    const add = h('div.skin-card.add', { onclick: (e) => addMenu(e.currentTarget) }, h('div.thumb', icon('plus')), h('div.n', 'Add skin'), h('div.v', 'PNG or username'));
    grid.replaceChildren(current, ...library.map(skinCard), add);
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
    const pick = async (cape) => {
      try {
        await call('skins:setCape', account.id, cape ? cape.id : null);
        currentCape = cape;
        await applyBack();
        await refreshAccounts();
        toast(cape ? `${cape.alias} cape equipped` : 'Cape removed', { kind: 'success', timeout: 2000 });
      } catch (err) {
        showError(err, 'Couldn’t change cape');
      }
    };
    capes.replaceChildren(
      h('button.cape', { class: list.some((c) => c.active) ? '' : 'active', title: 'No cape', onclick: () => pick(null) }, h('span.none', 'None')),
      ...list.map((c) => {
        const b = h('button.cape', { class: c.active ? 'active' : '', title: c.alias, onclick: () => pick(c) }, h('div.spinner'));
        call('skins:image', c.url).then((src) => b.replaceChildren(capeView(src)), () => b.replaceChildren(h('span.none', c.alias)));
        b.addEventListener('mouseenter', async () => {
          if (!viewer) return;
          try {
            viewer.loadCape(await call('skins:image', c.url), { backEquipment: prefs.elytra ? 'elytra' : 'cape' });
          } catch {}
        });
        b.addEventListener('mouseleave', applyBack);
        return b;
      }),
    );
    if (!list.length) capes.append(h('p.dim.small', { style: 'margin:0;align-self:center' }, 'This account has no capes.'));
  };

  applyBtn.addEventListener('click', async () => {
    if (!isMs) return;
    applyBtn.disabled = true;
    try {
      await call('skins:apply', selected, account.id, variant);
      await refreshAccounts();
      toast('Skin updated', { kind: 'success', message: 'It can take a minute to show up in game and on servers.' });
    } catch (err) {
      showError(err, 'Couldn’t change skin');
      applyBtn.disabled = false;
    }
  });

  function addMenu(anchor) {
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
  }

  const addBtn = btn('Add skin', { cls: 'primary', icon: 'plus' });
  addBtn.addEventListener('click', () => addMenu(addBtn));

  const rotateBtn = iconBtn('rotate', { title: 'Auto rotate', cls: prefs.rotate ? 'on' : '' });
  rotateBtn.addEventListener('click', () => {
    prefs.rotate = !prefs.rotate;
    rotateBtn.classList.toggle('on', prefs.rotate);
    if (viewer) viewer.autoRotate = prefs.rotate;
  });
  const elytraBtn = iconBtn('layers', { title: 'Show cape as elytra', cls: prefs.elytra ? 'on' : '' });
  elytraBtn.addEventListener('click', () => {
    prefs.elytra = !prefs.elytra;
    elytraBtn.classList.toggle('on', prefs.elytra);
    applyBack();
  });
  const resetCam = iconBtn('refresh', {
    title: 'Reset view',
    onClick: () => {
      if (!viewer) return;
      viewer.resetCameraPose();
      viewer.playerWrapper.rotation.y = -0.4;
    },
  });
  const animSel = select(ANIMATIONS, prefs.anim, (v) => {
    prefs.anim = v;
    setAnimation(viewer, v);
  });
  animSel.style.width = '130px';
  animSel.style.height = '34px';

  const stage = h(
    'div.stage',
    h(
      'div.stage-top',
      h('div', h('h2', account ? account.name : 'No account'), caption),
      h('div.row', { style: 'gap:4px' }, animSel, rotateBtn, isMs ? elytraBtn : null, resetCam),
    ),
    viewerBox,
    h(
      'div.stage-bottom',
      variantSeg,
      isMs
        ? h(
            'div.row',
            applyBtn,
            btn('Reset to default', {
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
            }),
          )
        : h('p.small.dim', { style: 'margin:0' }, account ? 'Offline accounts can preview skins here, but other players and servers won’t see them.' : ''),
    ),
  );

  el.append(
    h(
      'div.page-head',
      h('div.titles', h('h1', 'Skins'), h('p', 'Drag to turn your character, scroll to zoom.')),
      !account ? btn('Add account', { cls: 'primary', icon: 'user', onClick: (e) => accountMenu(e.currentTarget) }) : addBtn,
    ),
    h('div.skins', stage, h('div', h('div.section-head', { style: 'margin-top:0' }, h('h2', 'Your skins')), grid, h('div.section-head', h('h2', 'Capes')), capes)),
  );

  currentCape = activeCape() || null;
  renderVariant();
  renderCapes();
  showCurrent();
  loadLibrary();
  pageOn('accounts', () => render());
  return { el };
}
