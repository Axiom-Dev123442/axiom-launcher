/** The "New instance" dialog, with a tab for importing packs. */
import { h, btn, segmented, spinner, toggle } from '../lib/dom.js';
import { icon, loaderIcon } from '../lib/icons.js';
import { call, state, refreshInstances, pathForFile } from '../lib/store.js';
import { modal, showError, toast } from '../lib/ui.js';
import { BLOCK_NAMES, blockIcon, imageToIcon } from '../lib/blocks.js';
import { navigate } from '../router.js';
import { loaderName } from '../lib/format.js';

const LOADERS = [
  { id: 'vanilla', name: 'Vanilla', desc: 'The game as Mojang made it' },
  { id: 'fabric', name: 'Fabric', desc: 'Lightweight, great for performance mods' },
  { id: 'quilt', name: 'Quilt', desc: 'Fabric-compatible, with extra features' },
  { id: 'forge', name: 'Forge', desc: 'The classic loader for big mods' },
];

export function iconPicker(current, onPick) {
  const el = h('div.icon-picker');
  const useImage = async (picked) => {
    if (!picked) return;
    try {
      current = await imageToIcon(picked.data);
      onPick(current);
      render();
    } catch (err) {
      showError(err);
    }
  };
  const render = () => {
    el.replaceChildren(
      ...BLOCK_NAMES.map((name) =>
        h(
          'button',
          {
            type: 'button',
            title: name,
            class: current.type === 'preset' && current.value === name ? 'active' : '',
            onclick: () => {
              current = { type: 'preset', value: name };
              onPick(current);
              render();
            },
          },
          h('img', { src: blockIcon(name), alt: name }),
        ),
      ),
      current.type !== 'preset' ? h('button.active', { type: 'button' }, h('img', { src: current.value, style: 'image-rendering:auto' })) : null,
      h(
        'button.upload',
        {
          type: 'button',
          title: 'Use your own image (PNG, JPG, WebP, GIF, BMP, ICO, AVIF or SVG). You can also drop one here.',
          onclick: async () => {
            try {
              await useImage(await call('instances:pickIcon'));
            } catch (err) {
              showError(err);
            }
          },
        },
        icon('upload'),
      ),
    );
  };
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.add('over');
  });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (!f) return;
    try {
      await useImage(await call('instances:readIcon', pathForFile(f)));
    } catch (err) {
      showError(err);
    }
  });
  render();
  return el;
}

export function versionPicker(initial, onPick) {
  let all = [];
  let snapshots = Boolean(state.settings.showSnapshots);
  let query = '';
  let selected = initial;
  const list = h('div.version-list', h('div.center', spinner()));
  const render = () => {
    const items = all.filter((v) => (snapshots || v.type === 'release') && v.id.toLowerCase().includes(query.toLowerCase()));
    if (!items.length) {
      list.replaceChildren(h('div.center.dim', 'No versions found'));
      return;
    }
    list.replaceChildren(
      ...items.slice(0, 400).map((v, i) =>
        h(
          'div.version-item',
          {
            class: v.id === selected ? 'active' : '',
            onclick: () => {
              selected = v.id;
              onPick(v.id);
              render();
            },
          },
          h('span', v.id),
          h('span.dim', i === 0 && v.type === 'release' && !query ? 'Latest' : v.type === 'snapshot' ? 'Snapshot' : new Date(v.releaseTime).getFullYear()),
        ),
      ),
    );
    const active = list.querySelector('.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  };
  const load = async () => {
    try {
      all = await call('versions:list', true);
      if (!selected) {
        selected = all.find((v) => v.type === 'release').id;
        onPick(selected);
      }
      render();
    } catch (err) {
      list.replaceChildren(h('div.center.dim', `Couldn't load versions: ${err.message}`));
    }
  };
  load();
  const search = h('input.input', { placeholder: 'Search versions', spellcheck: 'false' });
  search.addEventListener('input', () => {
    query = search.value.trim();
    render();
  });
  return h(
    'div',
    h(
      'div.row',
      { style: 'margin-bottom:8px' },
      h('div.search.grow', icon('search'), search),
      h('label.row.small.muted', { style: 'gap:8px;white-space:nowrap' }, toggle(snapshots, (v) => {
        snapshots = v;
        render();
      }), 'Snapshots'),
    ),
    list,
  );
}

export function loaderVersionSelect(getState, onPick) {
  const el = h('select.select');
  let token = 0;
  const reload = async () => {
    const { loader, mcVersion, loaderVersion } = getState();
    const my = ++token;
    el.replaceChildren(h('option', { value: '' }, 'Recommended (automatic)'));
    el.disabled = loader === 'vanilla' || !mcVersion;
    if (loader === 'vanilla' || !mcVersion) return;
    try {
      const list = await call('versions:loaders', loader, mcVersion);
      if (my !== token) return;
      if (!list.length) {
        el.replaceChildren(h('option', { value: '' }, `${loaderName(loader)} isn't available for ${mcVersion}`));
        el.disabled = true;
        return;
      }
      for (const v of list.slice(0, 150)) {
        el.append(h('option', { value: v.id, selected: v.id === loaderVersion }, `${v.label}${v.tag ? ` · ${v.tag}` : v.stable === false ? ' · beta' : ''}`));
      }
    } catch {
      if (my === token) el.replaceChildren(h('option', { value: '' }, 'Recommended (automatic)'));
    }
  };
  el.addEventListener('change', () => onPick(el.value || null));
  return { el, reload };
}

export function newInstanceDialog({ tab = 'create' } = {}) {
  return modal((close) => {
    let performance = true;
    const form = { name: '', icon: { type: 'preset', value: BLOCK_NAMES[Math.floor(Math.random() * BLOCK_NAMES.length)] }, mcVersion: null, loader: 'vanilla', loaderVersion: null };
    const body = h('div');

    const nameInput = h('input.input', { placeholder: 'My world', maxlength: '48', spellcheck: 'false' });
    nameInput.addEventListener('input', () => (form.name = nameInput.value));

    const lv = loaderVersionSelect(() => form, (v) => (form.loaderVersion = v));
    const perfRow = h(
      'label.row',
      { style: 'gap:10px;margin-top:14px' },
      toggle(performance, (v) => (performance = v)),
      h('span', h('b', 'Performance mods'), h('span.dim.small', { style: 'display:block' }, 'Sodium, Lithium, FerriteCore, EntityCulling, ImmediatelyFast and more')),
    );
    const loaderCards = h('div.loader-cards');
    const renderLoaders = () => {
      loaderCards.replaceChildren(
        ...LOADERS.map((l) =>
          h(
            'div.loader-card',
            {
              class: form.loader === l.id ? 'active' : '',
              onclick: () => {
                form.loader = l.id;
                form.loaderVersion = null;
                renderLoaders();
                lv.reload();
                perfRow.hidden = l.id !== 'fabric';
              },
            },
            loaderIcon(l.id),
            h('b', l.name),
            h('span', l.desc),
          ),
        ),
      );
    };
    renderLoaders();

    const createPane = h(
      'div',
      h('div.field', h('label', 'Name'), nameInput),
      h('div.field', h('label', 'Icon'), iconPicker(form.icon, (i) => (form.icon = i))),
      h('div.field', h('label', 'Minecraft version'), versionPicker(null, (v) => {
        form.mcVersion = v;
        lv.reload();
      })),
      h('div.field', h('label', 'Mod loader'), loaderCards),
      h('div.field', { style: 'margin-bottom:0' }, h('label', 'Loader version'), lv.el),
      perfRow,
    );
    perfRow.hidden = true;

    const presetsPane = h('div.preset-list.stagger', h('div.center', spinner()));
    call('presets:list').then(
      (list) =>
        presetsPane.replaceChildren(
          ...list.map((p) =>
            h(
              'div.preset',
              h('img.ii', { src: blockIcon(p.icon), alt: '' }),
              h(
                'div.meta',
                h('b', p.name),
                h('div.small.muted', p.description),
                h('div.row.wrap', { style: 'gap:5px;margin-top:8px' }, h('span.chip', `${p.modCount} mods`), ...p.highlights.map((x) => h('span.chip', x.replace(/-liam$/, '').replace(/-/g, ' ')))),
              ),
              btn('Install', {
                cls: 'primary sm',
                icon: 'download',
                onClick: async () => {
                  close(true);
                  toast(`Setting up ${p.name}`, { message: 'Watch progress in the downloads panel.', timeout: 2500 });
                  try {
                    const r = await call('presets:install', p.id);
                    await refreshInstances();
                    navigate({ page: 'instance', id: r.instance.id });
                    toast(`${p.name} is ready`, {
                      kind: 'success',
                      message: r.skipped.length
                        ? `Skipped (no build for ${r.instance.mcVersion} yet): ${r.skipped.join(', ')}`
                        : `Minecraft ${r.instance.mcVersion} with ${r.installed.length} mods and packs.`,
                      timeout: 9000,
                    });
                  } catch (err) {
                    showError(err, `Couldn’t set up ${p.name}`);
                  }
                },
              }),
            ),
          ),
        ),
      (err) => presetsPane.replaceChildren(h('div.dim', err.message)),
    );

    const doImport = async (file) => {
      close(true);
      try {
        const r = await call('modpacks:import', file);
        if (!r) return;
        await refreshInstances();
        afterImport(r);
      } catch (err) {
        showError(err, 'Import failed');
      }
    };
    const drop = h(
      'div.empty.dropzone',
      { style: 'border:2px dashed var(--border-strong);border-radius:9px;padding:44px 20px' },
      h('div.art', icon('package')),
      h('h2', 'Import a modpack or instance'),
      h('p', 'Drop a Modrinth .mrpack, CurseForge .zip, or a Prism / MultiMC export here.'),
      btn('Choose file', { cls: 'primary', icon: 'folder', onClick: () => doImport(null) }),
    );
    drop.addEventListener('dragover', (e) => {
      e.preventDefault();
      drop.classList.add('over');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      const f = e.dataTransfer.files[0];
      if (f) doImport(pathForFile(f));
    });
    const importPane = h(
      'div',
      drop,
      h(
        'div.row',
        { style: 'justify-content:center;margin-top:16px' },
        btn('Browse modpacks', {
          icon: 'compass',
          cls: 'ghost',
          onClick: () => {
            close(false);
            navigate({ page: 'browse', type: 'modpack' });
          },
        }),
      ),
    );

    const createBtn = btn('Create instance', {
      cls: 'primary',
      icon: 'plus',
      onClick: async () => {
        if (!form.mcVersion) return;
        createBtn.disabled = true;
        try {
          const inst = await call('instances:create', {
            name: form.name.trim() || `${form.loader === 'vanilla' ? 'Minecraft' : loaderName(form.loader)} ${form.mcVersion}`,
            icon: form.icon,
            mcVersion: form.mcVersion,
            loader: form.loader,
            loaderVersion: form.loaderVersion,
          });
          await refreshInstances();
          close(inst);
          navigate({ page: 'instance', id: inst.id });
          toast(`${inst.name} created`, { kind: 'success', message: 'Press Play and Axiom downloads everything it needs.' });
          if (form.loader === 'fabric' && performance) {
            call('presets:performance', inst.id).catch((err) => showError(err, 'Couldn’t add performance mods'));
          }
        } catch (err) {
          createBtn.disabled = false;
          showError(err, 'Could not create instance');
        }
      },
    });
    const footer = h('div.row', { style: 'width:100%;justify-content:flex-end;gap:10px' }, btn('Cancel', { cls: 'ghost', onClick: () => close(false) }), createBtn);

    const show = (t) => {
      body.replaceChildren(t === 'create' ? createPane : t === 'presets' ? presetsPane : importPane);
      footer.style.display = t === 'create' ? '' : 'none';
    };
    show(tab);
    return {
      title: 'New instance',
      body: h('div', h('div', { style: 'margin-bottom:18px' }, segmented([{ value: 'create', label: 'Create', icon: 'plus' }, { value: 'presets', label: 'Presets', icon: 'sparkles' }, { value: 'import', label: 'Import', icon: 'package' }], tab, show)), body),
      footer,
    };
  });
}

/** Tells the person about CurseForge mods they need to download by hand. */
export function afterImport(result) {
  const inst = result.instance;
  if (result.blocked && result.blocked.length) {
    modal((close) => ({
      title: `${result.blocked.length} mods need a manual download`,
      body: h(
        'div',
        h('p.muted', { style: 'margin-top:0' }, 'These authors only allow downloads from the CurseForge website. Download each file, then put it in the folder shown.'),
        h(
          'div.list',
          result.blocked.map((b) =>
            h(
              'div.list-row',
              h('div.meta', h('div.t', b.name), h('div.s', `${b.folder}/${b.file}`)),
              b.url ? btn('Download', { cls: 'sm', icon: 'external', onClick: () => call('app:openExternal', b.url) }) : null,
            ),
          ),
        ),
      ),
      footer: [
        btn('Open mods folder', { icon: 'folder', onClick: () => call('app:openFolder', 'instance', inst.id, 'mods') }),
        btn('Done', { cls: 'primary', onClick: () => close() }),
      ],
    }));
  } else {
    toast(`${inst.name} is ready`, { kind: 'success', message: 'Press Play to start it.' });
  }
  navigate({ page: 'instance', id: inst.id });
}
