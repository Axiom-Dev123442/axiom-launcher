import { h, cascade, btn, toggle, select, spinner, paintRange } from '../lib/dom.js';
import { icon, logo } from '../lib/icons.js';
import { call, state, updateSettings, refreshSettings } from '../lib/store.js';
import { THEMES, ACCENT_SWATCHES, applyTheme } from '../lib/themes.js';
import { showError, toast, confirmDialog } from '../lib/ui.js';
import { navigate, render } from '../router.js';

const SECTIONS = [
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
  { id: 'game', label: 'Game', icon: 'gamepad' },
  { id: 'java', label: 'Java', icon: 'java' },
  { id: 'accounts', label: 'Accounts', icon: 'key' },
  { id: 'integrations', label: 'Integrations', icon: 'link' },
  { id: 'discord', label: 'Discord', icon: 'discord' },
  { id: 'storage', label: 'Storage', icon: 'hardDrive' },
  { id: 'about', label: 'About', icon: 'info' },
];

function setting(title, desc, ctrl) {
  return h('div.setting', h('div.txt', h('b', title), desc ? h('span', desc) : null), h('div.ctrl', ctrl));
}

async function save(changes, quiet = true) {
  try {
    await updateSettings(changes);
    if (!quiet) toast('Saved', { kind: 'success', timeout: 1500 });
  } catch (err) {
    showError(err);
  }
}

function secretInput(value, placeholder, onSave) {
  const input = h('input.input', { type: 'password', value: value || '', placeholder, spellcheck: 'false', style: 'width:320px' });
  const reveal = btn('', { cls: 'icon', icon: 'search', title: 'Show' });
  reveal.addEventListener('click', () => (input.type = input.type === 'password' ? 'text' : 'password'));
  input.addEventListener('change', () => onSave(input.value.trim()));
  return h('div.row', input, reveal);
}

function textInput(value, placeholder, onSave, width = 320) {
  const input = h('input.input', { value: value || '', placeholder, spellcheck: 'false', style: `width:${width}px` });
  input.addEventListener('change', () => onSave(input.value.trim()));
  return input;
}

/* ---------- Sections ---------- */

function appearance() {
  const s = state.settings;
  const themeGrid = cascade(h('div.theme-grid'));
  const renderThemes = () => {
    themeGrid.replaceChildren(
      ...Object.entries(THEMES).map(([id, t]) =>
        h(
          'button.theme-card',
          {
            class: s.theme === id ? 'active' : '',
            style: `--p-accent:${t.accent};--p-accent2:${t.accent2}`,
            onclick: async () => {
              await save({ theme: id });
              applyTheme(id, state.settings.accent, state.settings.animations);
              s.theme = id;
              renderThemes();
            },
          },
          h(
            'div.preview',
            { style: `background:${t.bg};color:${t.text}` },
            h('div.pside', { style: `background:${t.elev}` }, h('i'), h('i'), h('i'), h('i')),
            h('div.pmain', h('div.glow'), h('div.pline'), h('div.pline', { style: 'width:45%;margin-top:6px' }), h('div.pbtn')),
          ),
          h('div.tname', t.name),
        ),
      ),
    );
  };
  renderThemes();

  const swatches = h('div.swatches');
  const renderSwatches = () => {
    const custom = h('input', { type: 'color', value: s.accent || THEMES[s.theme]?.accent || '#8b5cf6' });
    custom.addEventListener('input', () => applyTheme(s.theme, custom.value, s.animations));
    custom.addEventListener('change', async () => {
      s.accent = custom.value;
      await save({ accent: custom.value });
      renderSwatches();
    });
    swatches.replaceChildren(
      h(
        'button.swatch.reset',
        {
          title: 'Theme default',
          class: s.accent ? '' : 'active',
          onclick: async () => {
            s.accent = null;
            await save({ accent: null });
            applyTheme(s.theme, null, s.animations);
            renderSwatches();
          },
        },
        icon('rotate'),
      ),
      ...ACCENT_SWATCHES.map((c) =>
        h('button.swatch', {
          style: `background:${c}`,
          title: c,
          class: s.accent === c ? 'active' : '',
          onclick: async () => {
            s.accent = c;
            applyTheme(s.theme, c, s.animations);
            await save({ accent: c });
            renderSwatches();
          },
        }),
      ),
      h('label.swatch.custom', { title: 'Custom colour', class: s.accent && !ACCENT_SWATCHES.includes(s.accent) ? 'active' : '' }, custom),
    );
  };
  renderSwatches();

  return [
    h('div.card', h('h3', { style: 'margin-bottom:14px' }, 'Theme'), themeGrid),
    h(
      'div.card',
      setting('Accent colour', 'Used for buttons, highlights and the glow behind the window.', swatches),
      setting(
        'Animations',
        'Smooth transitions and moving backgrounds.',
        toggle(s.animations, async (v) => {
          await save({ animations: v });
          applyTheme(s.theme, s.accent, v);
        }),
      ),
    ),
  ];
}

function game() {
  const s = state.settings;
  const mem = h('input', { type: 'range', min: '1024', max: '16384', step: '512', value: String(s.defaultMemory), style: 'width:220px' });
  const memLabel = h('b', { style: 'width:60px;text-align:right' });
  const show = () => {
    memLabel.textContent = `${(mem.value / 1024).toFixed(1)} GB`;
    paintRange(mem);
  };
  mem.addEventListener('input', show);
  mem.addEventListener('change', () => save({ defaultMemory: Number(mem.value) }));
  show();
  return [
    h(
      'div.card',
      setting('Default memory', 'RAM for new instances. Each instance can change this in its settings.', h('div.row', mem, memLabel)),
      setting(
        'When the game starts',
        'What the launcher window does while you play.',
        select(
          [
            { value: 'minimize', label: 'Minimize' },
            { value: 'hide', label: 'Hide' },
            { value: 'keep', label: 'Stay open' },
          ],
          s.onLaunch,
          (v) => save({ onLaunch: v }),
        ),
      ),
      setting(
        'Performance mode',
        'Lighter visuals for low-end laptops: no background glow and a still character on Home. Automatic turns it on for PCs with 4 cores or 8 GB of memory or less.',
        select(
          [
            { value: 'auto', label: 'Automatic' },
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' },
          ],
          s.performanceMode || 'auto',
          async (v) => {
            await save({ performanceMode: v });
            const { applyPerformance } = await import('../app.js');
            applyPerformance();
          },
        ),
      ),
      setting('Show snapshots', 'Include test versions when picking a Minecraft version.', toggle(s.showSnapshots, (v) => save({ showSnapshots: v }))),
      setting(
        'Parallel downloads',
        'How many files download at the same time.',
        select(
          [4, 8, 16, 32].map((n) => ({ value: String(n), label: String(n) })),
          String(s.concurrency),
          (v) => save({ concurrency: Number(v) }),
        ),
      ),
    ),
  ];
}

function java() {
  const s = state.settings;
  const list = h('div', h('div.row.dim', spinner(), 'Loading…'));
  const load = () =>
    call('java:installed').then((rt) => {
      list.replaceChildren(
        rt.length
          ? h(
              'div.list',
              rt.map((r) => h('div.list-row', h('div.ii', { style: 'display:grid;place-items:center;color:var(--accent)' }, icon('java')), h('div.meta', h('div.t', `Java ${r.version}`), h('div.s', r.component)))),
            )
          : h('p.dim', { style: 'margin:0' }, 'No Java downloaded yet. It downloads automatically the first time you play.'),
      );
    });
  load();
  const pathInput = textInput(s.javaPath, 'Automatic (recommended)', (v) => save({ javaPath: v }, false), 300);
  return [
    h(
      'div.card',
      setting(
        'Java for all instances',
        'Leave empty to let Obsidian download the exact Java each Minecraft version needs.',
        h(
          'div.row',
          pathInput,
          btn('Browse', {
            onClick: async () => {
              try {
                const r = await call('java:pick');
                if (r) {
                  pathInput.value = r.path;
                  save({ javaPath: r.path }, false);
                }
              } catch (err) {
                showError(err);
              }
            },
          }),
        ),
      ),
    ),
    h(
      'div.card',
      h('div.row', { style: 'margin-bottom:14px' }, h('h3.grow', 'Downloaded Java'), btn('Delete all', {
        cls: 'danger sm',
        icon: 'trash',
        onClick: async () => {
          if (!(await confirmDialog({ title: 'Delete downloaded Java?', message: 'It downloads again automatically when needed.', confirm: 'Delete', danger: true }))) return;
          await call('java:removeAll');
          load();
        },
      })),
      list,
    ),
  ];
}

function accounts() {
  const s = state.settings;
  return [
    h(
      'div.card',
      setting(
        'Microsoft app ID',
        'Obsidian has its own app ID built in. Only fill this in if you registered your own app in Azure.',
        textInput(s.microsoftClientId, 'Built in (recommended)', async (v) => {
          await save({ microsoftClientId: v }, false);
          state.info = await call('app:info');
        }),
      ),
    ),
    h(
      'div.card',
      h('h3', { style: 'margin-bottom:10px' }, 'Using your own app ID (optional)'),
      h(
        'ol.steps',
        h('li', 'Go to ', h('code', 'entra.microsoft.com'), ' and sign in with any Microsoft account.'),
        h('li', 'Open Applications → App registrations → New registration.'),
        h('li', 'Name it ', h('code', 'Obsidian Launcher'), ' and choose "Personal Microsoft accounts only".'),
        h('li', 'Redirect URI: pick "Public client/native" and enter ', h('code', 'https://login.microsoftonline.com/common/oauth2/nativeclient'), '.'),
        h('li', 'After registering, open Authentication and turn on "Allow public client flows".'),
        h('li', 'Copy the Application (client) ID from Overview and paste it above.'),
        h('li', 'Ask Mojang to approve the app at ', h('code', 'aka.ms/mce-reviewappid'), '. Until then Minecraft refuses the login.'),
      ),
    ),
  ];
}

function integrations() {
  const s = state.settings;
  return [
    h(
      'div.card',
      setting(
        'CurseForge API key',
        'Lets you browse and install from CurseForge, and import CurseForge modpacks. Get one free at console.curseforge.com.',
        secretInput(s.curseforgeKey, 'Paste your key', async (v) => {
          await save({ curseforgeKey: v }, false);
          state.info = await call('app:info');
        }),
      ),
      setting('Modrinth', 'Works out of the box, no key needed.', h('span.chip.vanilla', icon('check'), 'Connected')),
    ),
  ];
}

function discord() {
  const d = state.settings.discord;
  return [
    h(
      'div.card',
      setting('Show status on Discord', 'Shows "Playing Minecraft, using Obsidian Launcher" on your profile.', toggle(d.enabled, (v) => save({ discord: { enabled: v } }))),
      setting('Hide instance name', 'Only show the Minecraft version and loader.', toggle(d.hideInstance, (v) => save({ discord: { hideInstance: v } }))),
      setting('"Get Obsidian" button', 'Adds a button to your status linking to the download page.', toggle(d.showButton, (v) => save({ discord: { showButton: v } }))),
      setting(
        'Discord application ID',
        'Create an app named "Minecraft" at discord.com/developers and paste its Application ID.',
        textInput(d.clientId, 'Application ID', async (v) => {
          await save({ discord: { clientId: v } }, false);
          state.info = await call('app:info');
        }),
      ),
    ),
    h(
      'div.card',
      h('h3', { style: 'margin-bottom:12px' }, 'Preview'),
      h(
        'div.row',
        { style: 'gap:14px;padding:14px;border-radius:8px;background:#111214;color:#dbdee1' },
        h('div', { style: 'width:64px;height:64px;border-radius:7px;display:grid;place-items:center;background:#1e1f22' }, logo('discord-logo')),
        h('div', h('div', { style: 'font-weight:700;color:#fff' }, 'Playing Minecraft'), h('div', 'using Obsidian Launcher'), h('div', '1.20.1 Fabric · My Survival World'), h('div', { style: 'color:#949ba4;font-size:12px' }, '00:42 elapsed')),
      ),
    ),
  ];
}

function storage() {
  return [
    h(
      'div.card',
      setting('Data folder', state.info.dataDir, btn('Open', { icon: 'folder', onClick: () => call('app:openFolder', 'root') })),
      setting('Repair an instance', 'Re-checks every game file. Use it from the instance’s menu in the Library.', btn('Open Library', { icon: 'library', onClick: () => navigate({ page: 'library' }) })),
    ),
  ];
}

function about() {
  const u = h('span.muted');
  const renderU = () => {
    const st = state.update;
    u.textContent =
      { checking: 'Checking for updates…', latest: 'You have the latest version.', downloading: `Downloading update ${st.percent || 0}%`, ready: `Version ${st.version} is ready. Restart to install.`, error: `Update check failed: ${st.message}`, disabled: 'Updates are checked in the installed app.' }[st.state] || '';
  };
  renderU();
  return [
    h(
      'div.card.pad-lg',
      h(
        'div.about',
        logo('logo'),
        h('div.grow', h('h2', 'Obsidian'), h('div.muted', `Version ${state.info.version}`), h('div.small', u)),
        btn('Check for updates', {
          icon: 'refresh',
          onClick: async () => {
            state.update = await call('updates:check');
            renderU();
          },
        }),
      ),
    ),
    h(
      'div.card',
      setting('Releases', 'Download the installer or see what changed.', btn('Open', { icon: 'external', onClick: () => call('app:openExternal', state.info.releasesUrl) })),
      setting('Auto update', 'Download new versions in the background.', toggle(state.settings.autoUpdate, (v) => save({ autoUpdate: v }))),
      h('p.small.dim', { style: 'margin:16px 0 0' }, 'Obsidian is not affiliated with Mojang or Microsoft. Minecraft is a trademark of Mojang Studios.'),
    ),
  ];
}

const BUILDERS = { appearance, game, java, accounts, integrations, discord, storage, about };

export function settingsPage(route) {
  const section = SECTIONS.some((s) => s.id === route.section) ? route.section : 'appearance';
  const el = h('div.page');
  const panel = h('div.panel', BUILDERS[section]());
  el.append(
    h('div.page-head', h('div.titles', h('h1', 'Settings'))),
    h(
      'div.settings',
      h(
        'div.subnav',
        SECTIONS.map((s) =>
          h('button.nav-item', { class: s.id === section ? 'active' : '', onclick: () => navigate({ page: 'settings', section: s.id }, { replace: true }) }, icon(s.icon), s.label),
        ),
      ),
      panel,
    ),
  );
  return { el };
}

export { refreshSettings, render };
