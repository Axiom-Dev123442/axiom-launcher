import { h, cascade, btn, iconBtn, toggle, searchInput, spinner, paintRange } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { call, onMain, state, refreshInstances, instanceById, pathForFile } from '../lib/store.js';
import { blurBackground } from '../lib/blocks.js';
import { showError, toast, confirmDialog } from '../lib/ui.js';
import { ago, bytes, duration, loaderName } from '../lib/format.js';
import { pageOn, onLeave, navigate, back, render } from '../router.js';
import { instanceIcon, loaderChip, versionChip, playButton, axiomChip, hasAxiomSupport } from '../components/common.js';
import { iconPicker, versionPicker, loaderVersionSelect } from '../components/newInstance.js';
import { instanceMenu } from './library.js';

const TABS = [
  { id: 'overview', label: 'Overview', icon: 'grid' },
  { id: 'mods', label: 'Mods', icon: 'puzzle', type: 'mod' },
  { id: 'resourcepacks', label: 'Resource packs', icon: 'image', type: 'resourcepack' },
  { id: 'shaders', label: 'Shaders', icon: 'sparkles', type: 'shader' },
  { id: 'worlds', label: 'Worlds', icon: 'layers' },
  { id: 'console', label: 'Console', icon: 'terminal' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

export function instancePage(route) {
  const inst = instanceById(route.id);
  if (!inst) {
    setTimeout(() => navigate({ page: 'library' }, { replace: true }));
    return { el: h('div.page') };
  }
  const tab = route.tab || 'overview';
  const el = h('div.page.flush');

  const more = btn('', { cls: 'icon lg', icon: 'dots', title: 'More' });
  more.addEventListener('click', () => instanceMenu(more, inst, { onDeleted: () => navigate({ page: 'library' }) }));

  const tabs = h(
    'div.tabs',
    TABS.map((t) =>
      h('button.tab', { class: t.id === tab ? 'active' : '', onclick: () => navigate({ page: 'instance', id: inst.id, tab: t.id }, { replace: true }) }, icon(t.icon), t.label),
    ),
  );

  el.append(
    h(
      'div.inst-head',
      blurBackground(h('div.bgimg'), inst.icon),
      h('button.back', { onclick: () => back() }, icon('chevronLeft'), 'Back'),
      h(
        'div.top',
        instanceIcon(inst),
        h('div.grow', h('h1', inst.name), h('div.chips', versionChip(inst), loaderChip(inst), axiomChip(inst), inst.modpack && inst.modpack.name ? h('span.chip', icon('package'), `${inst.modpack.name} ${inst.modpack.versionNumber || ''}`) : null)),
        h('div.row', btn('', { cls: 'icon lg', icon: 'folder', title: 'Open folder', onClick: () => call('app:openFolder', 'instance', inst.id) }), more, playButton(inst.id)),
      ),
      tabs,
    ),
  );

  const body = h('div.tab-body');
  el.append(body);
  const t = TABS.find((x) => x.id === tab) || TABS[0];
  if (t.id === 'overview') overviewTab(body, inst);
  else if (t.type) contentTab(body, inst, t.type);
  else if (t.id === 'worlds') worldsTab(body, inst);
  else if (t.id === 'console') consoleTab(body, inst);
  else settingsTab(body, inst);
  return { el };
}

/* ---------- Overview ---------- */

function overviewTab(body, inst) {
  const modsCount = h('span', '…');
  call('content:list', inst.id, 'mod').then((l) => (modsCount.textContent = l.filter((m) => m.enabled).length), () => (modsCount.textContent = '0'));
  const stat = (ic, k, v) => h('div.stat', h('div.k', icon(ic), k), h('div.v', v));
  body.append(
    h(
      'div.stats-grid.stagger',
      stat('clock', 'Play time', duration(inst.playtime)),
      stat('calendar', 'Last played', ago(inst.lastPlayed)),
      stat('puzzle', 'Mods enabled', modsCount),
      stat('cpu', 'Memory', `${Math.round((inst.memory.max / 1024) * 10) / 10} GB`),
    ),
  );

  if (inst.modpack && (inst.modpack.source === 'modrinth' || inst.modpack.source === 'curseforge')) {
    const status = h('span.muted', 'Checking for updates…');
    const action = h('span');
    const box = h(
      'div.card',
      { style: 'margin-top:18px;display:flex;align-items:center;gap:16px' },
      h('div.dl', { style: 'padding:0' }, h('div.kind', icon('package'))),
      h('div.grow', h('b', inst.modpack.name), h('div.small', status)),
      action,
    );
    body.append(box);
    call('modpacks:checkUpdate', inst.id).then(
      (u) => {
        if (!u) {
          status.textContent = `Up to date · ${inst.modpack.versionNumber || ''}`;
          return;
        }
        status.textContent = `${inst.modpack.versionNumber} → ${u.versionNumber} available`;
        action.replaceChildren(
          btn('Update modpack', {
            cls: 'primary',
            icon: 'refresh',
            onClick: async () => {
              const ok = await confirmDialog({
                title: `Update ${inst.modpack.name}?`,
                message: 'The pack’s mods and configs are replaced with the new version. Your worlds and any mods you added yourself are kept.',
                confirm: 'Update',
              });
              if (!ok) return;
              try {
                await call('modpacks:update', inst.id, u.versionId);
                await refreshInstances();
                toast('Modpack updated', { kind: 'success' });
                render();
              } catch (err) {
                showError(err, 'Update failed');
              }
            },
          }),
        );
      },
      () => (status.textContent = inst.modpack.versionNumber || ''),
    );
  }

  const folders = [
    ['Mods', 'mods', 'puzzle'],
    ['Worlds', 'saves', 'layers'],
    ['Screenshots', 'screenshots', 'image'],
    ['Resource packs', 'resourcepacks', 'image'],
    ['Shaders', 'shaderpacks', 'sparkles'],
    ['Config', 'config', 'settings'],
    ['Logs', 'logs', 'terminal'],
  ];
  body.append(
    h('div.section-head', h('h2', 'Folders')),
    h(
      'div.folder-grid.stagger',
      folders.map(([label, sub, ic]) => btn(label, { cls: 'folder-btn', icon: ic, onClick: () => call('app:openFolder', 'instance', inst.id, sub) })),
    ),
  );
}

/* ---------- Mods / resource packs / shaders ---------- */

const TYPE_LABEL = { mod: 'mods', resourcepack: 'resource packs', shader: 'shaders' };

function contentTab(body, inst, type) {
  let items = [];
  let query = '';
  const list = cascade(h('div'));
  const updatesSlot = h('div');

  const renderList = () => {
    const shown = items.filter((m) => `${m.title} ${m.file}`.toLowerCase().includes(query.toLowerCase()));
    if (!items.length) {
      const noMods = type === 'mod' && inst.loader === 'vanilla';
      list.replaceChildren(
        h(
          'div.empty',
          h('div.art', icon(type === 'mod' ? 'puzzle' : type === 'shader' ? 'sparkles' : 'image')),
          h('h2', noMods ? 'Vanilla can’t use mods' : `No ${TYPE_LABEL[type]} yet`),
          h('p', noMods ? 'Change this instance to Fabric, Quilt or Forge in Settings to add mods.' : `Find ${TYPE_LABEL[type]} in Browse, or drop files here.`),
          noMods
            ? btn('Open settings', { icon: 'settings', onClick: () => navigate({ page: 'instance', id: inst.id, tab: 'settings' }, { replace: true }) })
            : btn(`Browse ${TYPE_LABEL[type]}`, { cls: 'primary', icon: 'compass', onClick: () => navigate({ page: 'browse', type, instance: inst.id }) }),
        ),
      );
      return;
    }
    list.replaceChildren(
      h(
        'div.list',
        shown.map((m) =>
          h(
            'div.list-row',
            { class: m.enabled ? '' : 'off' },
            m.icon ? h('img.ii', { src: m.icon, alt: '' }) : h('div.ii', { style: 'display:grid;place-items:center;color:var(--text-3)' }, icon(type === 'mod' ? 'puzzle' : 'image')),
            h('div.meta', h('div.t', m.title, m.builtIn ? h('span.chip.axiom', { style: 'margin-left:8px;height:20px;font-size:11px' }, 'Built in') : m.fromPack ? h('span.chip', { style: 'margin-left:8px;height:20px;font-size:11px' }, 'Pack') : null), h('div.s', [m.version, m.file].filter(Boolean).join(' · '))),
            // The Axiom Client is managed by the launcher: turn it off in Settings instead of here.
            m.builtIn ? h('span.dim.small', { style: 'margin-right:6px' }, 'Managed by Axiom') : toggle(m.enabled, async (on) => {
              try {
                await call('content:toggle', inst.id, type, m.file, on);
                m.enabled = on;
                renderList();
              } catch (err) {
                showError(err);
                load();
              }
            }),
            m.builtIn ? null : iconBtn('trash', {
              title: 'Remove',
              onClick: async () => {
                const ok = await confirmDialog({ title: `Remove ${m.title}?`, message: 'The file is deleted from this instance.', confirm: 'Remove', danger: true });
                if (!ok) return;
                try {
                  await call('content:remove', inst.id, type, m.file);
                } catch (err) {
                  showError(err, `Couldn't remove ${m.title}`);
                }
                load();
              },
            }),
          ),
        ),
      ),
    );
  };

  const load = async () => {
    try {
      items = await call('content:list', inst.id, type);
      renderList();
    } catch (err) {
      list.replaceChildren(h('div.dim', err.message));
    }
  };

  const checkUpdates = async () => {
    updatesSlot.replaceChildren(h('div.row.dim', { style: 'margin-bottom:14px' }, spinner(), 'Checking for updates…'));
    try {
      const ups = await call('content:checkUpdates', inst.id, type);
      if (!ups.length) {
        updatesSlot.replaceChildren(h('div.banner', icon('checkCircle'), h('div.grow', h('b', 'Everything is up to date'))));
        return;
      }
      updatesSlot.replaceChildren(
        h(
          'div.banner',
          icon('refresh'),
          h('div.grow', h('b', `${ups.length} update${ups.length === 1 ? '' : 's'} available`), h('span.muted.small', ups.map((u) => u.title).join(', '))),
          btn('Update all', {
            cls: 'primary sm',
            onClick: async () => {
              updatesSlot.replaceChildren();
              for (const u of ups) {
                try {
                  await call('content:install', { instanceId: inst.id, source: u.source, projectId: u.projectId, versionId: u.versionId, type, title: u.title });
                } catch (err) {
                  showError(err, `Couldn't update ${u.title}`);
                }
              }
              load();
              toast('Updates installed', { kind: 'success' });
            },
          }),
        ),
      );
    } catch (err) {
      updatesSlot.replaceChildren();
      showError(err);
    }
  };

  const zone = h('div.dropzone', list);
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('over');
  });
  zone.addEventListener('dragleave', (e) => {
    if (!zone.contains(e.relatedTarget)) zone.classList.remove('over');
  });
  zone.addEventListener('drop', async (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    const files = [...e.dataTransfer.files].map((f) => pathForFile(f)).filter(Boolean);
    if (!files.length) return;
    try {
      await call('content:addFiles', inst.id, type, files);
      load();
      toast(`Added ${files.length} file${files.length === 1 ? '' : 's'}`, { kind: 'success' });
    } catch (err) {
      showError(err);
    }
  });

  body.append(
    h(
      'div.toolbar',
      searchInput(`Search ${TYPE_LABEL[type]}`, '', (v) => {
        query = v;
        renderList();
      }, 0),
      h('div.grow'),
      btn('Check for updates', { icon: 'refresh', onClick: checkUpdates }),
      btn('Add files', {
        icon: 'upload',
        onClick: async () => {
          try {
            if (await call('content:addFiles', inst.id, type)) load();
          } catch (err) {
            showError(err);
          }
        },
      }),
      btn(`Browse ${TYPE_LABEL[type]}`, { cls: 'primary', icon: 'compass', onClick: () => navigate({ page: 'browse', type, instance: inst.id }) }),
    ),
    updatesSlot,
    zone,
  );
  list.append(h('div.center', spinner()));
  load();
  pageOn('tasks', (() => {
    let last = '';
    return () => {
      const sig = state.tasks.filter((t) => t.kind === 'mod' && t.status === 'done').length;
      if (String(sig) !== last) {
        last = String(sig);
        load();
      }
    };
  })());
}

/* ---------- Worlds ---------- */

function worldsTab(body, inst) {
  const list = cascade(h('div'));
  const backupsBox = h('div');

  const restoreButton = (b) =>
    btn('Restore', {
      cls: 'sm',
      icon: 'rotate',
      onClick: async () => {
        const ok = await confirmDialog({
          title: `Restore ${b.world}?`,
          message: 'The backup is added as a new world next to your current one, so nothing is overwritten.',
          confirm: 'Restore',
        });
        if (!ok) return;
        try {
          const r = await call('worlds:restore', inst.id, b.name);
          toast('World restored', { kind: 'success', message: `Saved as “${r.folder}”.` });
          load();
        } catch (err) {
          showError(err, 'Restore failed');
        }
      },
    });

  const load = async () => {
    let worlds;
    let backups;
    try {
      [worlds, backups] = await Promise.all([call('worlds:list', inst.id), call('worlds:backups', inst.id)]);
    } catch (err) {
      list.replaceChildren(h('div.dim', err.message));
      return;
    }
    if (!worlds.length) {
      list.replaceChildren(
        h('div.empty', h('div.art', icon('layers')), h('h2', 'No worlds yet'), h('p', 'Worlds you create in this instance show up here, ready to back up.'), playButton(inst.id)),
      );
    } else {
      list.replaceChildren(
        h(
          'div.list',
          worlds.map((w) => {
            const backupBtn = btn('Back up', { cls: 'sm', icon: 'copy' });
            backupBtn.addEventListener('click', async () => {
              backupBtn.disabled = true;
              try {
                await call('worlds:backup', inst.id, w.folder);
                toast(`Backed up ${w.folder}`, { kind: 'success' });
                load();
              } catch (err) {
                showError(err, 'Backup failed');
                backupBtn.disabled = false;
              }
            });
            return h(
              'div.list-row',
              w.icon ? h('img.ii', { src: w.icon, alt: '' }) : h('div.ii', { style: 'display:grid;place-items:center;color:var(--text-3)' }, icon('layers')),
              h(
                'div.meta',
                h('div.t', w.folder),
                h('div.s', [`Played ${/ago|now|Yesterday/.test(ago(w.lastPlayed)) ? ago(w.lastPlayed).toLowerCase() : ago(w.lastPlayed)}`, bytes(w.size), w.backups ? `${w.backups} backup${w.backups === 1 ? '' : 's'}` : 'No backups'].join(' · ')),
              ),
              iconBtn('folder', { title: 'Open world folder', onClick: () => call('app:openFolder', 'instance', inst.id, `saves/${w.folder}`) }),
              backupBtn,
            );
          }),
        ),
      );
    }
    backupsBox.replaceChildren(
      backups.length
        ? h(
            'div',
            h('div.section-head', h('h2', 'Backups'), btn('Open backups folder', { cls: 'sm', icon: 'folder', onClick: () => call('app:openFolder', 'backups', inst.id) })),
            h(
              'div.list',
              backups.slice(0, 30).map((b) =>
                h('div.list-row', h('div.ii', { style: 'display:grid;place-items:center;color:var(--text-3)' }, icon('hardDrive')), h('div.meta', h('div.t', b.world), h('div.s', ago(b.createdAt))), restoreButton(b)),
              ),
            ),
          )
        : null,
    );
  };

  body.append(
    h(
      'div.toolbar',
      h('div.grow.muted.small', 'Back up a world before updating mods or the Minecraft version. Backups are kept outside the game folder.'),
      btn('Open saves folder', { icon: 'folder', onClick: () => call('app:openFolder', 'instance', inst.id, 'saves') }),
    ),
    list,
    backupsBox,
  );
  list.append(h('div.center', spinner()));
  load();
}

/* ---------- Console ---------- */

function classify(entry) {
  if (entry.kind === 'launcher' || entry.kind === 'installer') return `l-${entry.kind}`;
  if (/\b(ERROR|FATAL|Exception)\b/.test(entry.line)) return 'l-error';
  if (/\bWARN\b/.test(entry.line)) return 'l-warn';
  return entry.kind === 'err' ? 'l-err' : 'l-info';
}

function consoleTab(body, inst) {
  const box = h('div.console');
  let follow = true;
  const add = (entry) => {
    box.append(h('div', { class: classify(entry) }, entry.line));
    while (box.childElementCount > 5000) box.firstChild.remove();
    if (follow) box.scrollTop = box.scrollHeight;
  };
  box.addEventListener('scroll', () => {
    follow = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
  });
  call('game:log', inst.id).then((lines) => {
    if (!lines.length) box.append(h('div.dim', 'The game log appears here when you press Play.'));
    lines.forEach(add);
  });
  const off = onMain('game-log', (id, entry) => {
    if (id === inst.id) {
      const hint = box.querySelector('.dim');
      if (hint) hint.remove();
      add(entry);
    }
  });
  onLeave(off);
  body.append(
    h(
      'div.toolbar',
      h('h2.grow', 'Game output'),
      btn('Copy', { icon: 'copy', onClick: () => navigator.clipboard.writeText(box.innerText).then(() => toast('Log copied', { kind: 'success', timeout: 1800 })) }),
      btn('Clear', { icon: 'trash', onClick: () => call('game:clearLog', inst.id).then(() => box.replaceChildren()) }),
      btn('Logs folder', { icon: 'folder', onClick: () => call('app:openFolder', 'instance', inst.id, 'logs') }),
    ),
    box,
  );
}

/* ---------- Settings ---------- */

function settingsTab(body, inst) {
  const save = async (changes, quiet) => {
    try {
      await call('instances:update', inst.id, changes);
      Object.assign(inst, changes);
      await refreshInstances();
      if (!quiet) toast('Saved', { kind: 'success', timeout: 1500 });
    } catch (err) {
      showError(err);
    }
  };

  const name = h('input.input', { value: inst.name, maxlength: '48' });
  name.addEventListener('change', () => name.value.trim() && save({ name: name.value.trim() }, true));

  const totalMb = Math.max(4096, Math.floor((state.info.totalMemory || 16 * 1024 ** 3) / 1024 ** 2));
  const maxAllowed = Math.min(32768, Math.floor(totalMb * 0.85 / 512) * 512);
  const memVal = h('span.mem-display');
  const mem = h('input', { type: 'range', min: '1024', max: String(maxAllowed), step: '512', value: String(inst.memory.max) });
  const showMem = () => {
    memVal.textContent = `${(mem.value / 1024).toFixed(1)} GB`;
    paintRange(mem);
  };
  mem.addEventListener('input', showMem);
  mem.addEventListener('change', () => save({ memory: { min: Math.min(inst.memory.min || 512, Number(mem.value)), max: Number(mem.value) } }, true));
  showMem();

  const jvm = h('textarea.input', { rows: '3', placeholder: '-XX:+UseG1GC', spellcheck: 'false' });
  jvm.value = inst.jvmArgs || '';
  jvm.addEventListener('change', () => save({ jvmArgs: jvm.value }, true));

  const resW = h('input.input', { type: 'number', min: '0', placeholder: 'Auto', value: inst.resolution && inst.resolution.width ? inst.resolution.width : '' });
  const resH = h('input.input', { type: 'number', min: '0', placeholder: 'Auto', value: inst.resolution && inst.resolution.height ? inst.resolution.height : '' });
  const saveRes = () => save({ resolution: { width: Number(resW.value) || 0, height: Number(resH.value) || 0 } }, true);
  resW.addEventListener('change', saveRes);
  resH.addEventListener('change', saveRes);

  const javaInput = h('input.input', { value: inst.javaPath || '', placeholder: 'Automatic (recommended)', spellcheck: 'false' });
  javaInput.addEventListener('change', () => save({ javaPath: javaInput.value.trim() }, true));

  // Version and loader
  const form = { mcVersion: inst.mcVersion, loader: inst.loader, loaderVersion: inst.loaderVersion };
  const lv = loaderVersionSelect(() => form, (v) => (form.loaderVersion = v));
  const loaderSel = h(
    'select.select',
    ['vanilla', 'fabric', 'quilt', 'forge'].map((l) => h('option', { value: l, selected: l === inst.loader }, loaderName(l))),
  );
  loaderSel.addEventListener('change', () => {
    form.loader = loaderSel.value;
    form.loaderVersion = null;
    lv.reload();
  });
  lv.reload();

  body.append(
    h(
      'div.settings-grid',
      h(
        'div.card',
        h('h3', icon('edit'), 'General'),
        h('div.field', h('label', 'Name'), name),
        h('div.field', { style: 'margin:0' }, h('label', 'Icon'), iconPicker(inst.icon, (i) => save({ icon: i }, true))),
      ),
      // The built-in Axiom Client: on by default wherever it can run.
      h(
        'div.card',
        h('h3', icon('sparkles'), 'Axiom Client'),
        hasAxiomSupport(inst)
          ? h(
              'div',
              h('label.row', { style: 'gap:10px' }, toggle(inst.axiomClient !== false, (v) => save({ axiomClient: v }, true)), 'Use the Axiom Client in this instance'),
              h('p.small.dim', { style: 'margin:12px 0 0' }, 'Adds the Axiom menu (Right Shift in game), HUD, PvP and Bedwars mods, presets and cosmetics. Installed and kept up to date each time you press Play.'),
            )
          : h('p.small.dim', { style: 'margin:0' }, 'The Axiom Client runs on Fabric for Minecraft 26.3. Create one with New instance > Axiom Client, or switch this instance to Fabric 26.3.'),
      ),
      h(
        'div.card',
        h('h3', icon('cpu'), 'Memory'),
        h('div.row', { style: 'justify-content:space-between;margin-bottom:12px' }, h('span.muted', 'Maximum RAM'), memVal),
        mem,
        h('p.small.dim', { style: 'margin:14px 0 0' }, 'Most modpacks run well with 4 to 8 GB. Giving Minecraft too much memory can make it slower.'),
        h('div.field', { style: 'margin:18px 0 0' }, h('label', 'Window size'), h('div.row', resW, h('span.dim', '×'), resH)),
        h('label.row', { style: 'margin-top:14px;gap:10px' }, toggle(inst.fullscreen, (v) => save({ fullscreen: v }, true)), 'Start in fullscreen'),
      ),
      h(
        'div.card',
        h('h3', icon('package'), 'Version'),
        h('div.field', h('label', 'Minecraft version'), versionPicker(inst.mcVersion, (v) => (form.mcVersion = v))),
        h('div.cols-2', h('div.field', h('label', 'Loader'), loaderSel), h('div.field', h('label', 'Loader version'), lv.el)),
        btn('Apply version change', {
          cls: 'primary',
          icon: 'check',
          onClick: async () => {
            if (form.mcVersion === inst.mcVersion && form.loader === inst.loader && form.loaderVersion === inst.loaderVersion) return;
            const ok = await confirmDialog({
              title: 'Change version?',
              message: 'Mods made for the old version may stop working. Back up important worlds first.',
              confirm: 'Change version',
            });
            if (ok) {
              await save({ mcVersion: form.mcVersion, loader: form.loader, loaderVersion: form.loaderVersion });
              render();
            }
          },
        }),
      ),
      h(
        'div.card',
        h('h3', icon('java'), 'Java'),
        h('div.field', h('label', 'Java executable'), h('div.row', javaInput, btn('Browse', {
          onClick: async () => {
            try {
              const r = await call('java:pick');
              if (r) {
                javaInput.value = r.path;
                save({ javaPath: r.path });
              }
            } catch (err) {
              showError(err);
            }
          },
        })), h('div.hint', 'Leave empty and Axiom downloads the right Java automatically.')),
        h('div.field', { style: 'margin:0' }, h('label', 'Java arguments'), jvm),
      ),
    ),
  );
}
