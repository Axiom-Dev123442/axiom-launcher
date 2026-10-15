import { h, btn, iconBtn, segmented, select, searchInput, spinner } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { call, state, refreshInstances, instanceById } from '../lib/store.js';
import { showError, toast, menu } from '../lib/ui.js';
import { compact, ago, loaderName } from '../lib/format.js';
import { renderBody } from '../lib/markdown.js';
import { navigate, onLeave } from '../router.js';
import { afterImport } from '../components/newInstance.js';

const TYPES = [
  { value: 'mod', label: 'Mods', icon: 'puzzle' },
  { value: 'modpack', label: 'Modpacks', icon: 'package' },
  { value: 'resourcepack', label: 'Resource packs', icon: 'image' },
  { value: 'shader', label: 'Shaders', icon: 'sparkles' },
];
const PAGE = 20;

// Browse filters are remembered while the app is open.
const memory = { type: 'mod', source: 'modrinth', query: '', sort: 'relevance', instance: null, loader: '', version: '' };

function projectIcon(p, cls = 'ii') {
  if (p.icon) return h(`img.${cls}`, { src: p.icon, alt: '', loading: 'lazy', class: 'smooth' });
  return h(`div.${cls}`, { style: 'display:grid;place-items:center;color:var(--text-3)' }, icon('package'));
}

/** Installs a project into an instance (or creates an instance for a modpack). */
async function install(project, versionId, instanceId, type) {
  try {
    if (type === 'modpack') {
      toast(`Installing ${project.title}`, { message: 'Watch progress in the downloads panel.', timeout: 2500 });
      const r = await call('modpacks:install', { source: project.source, projectId: project.id, versionId, title: project.title, icon: project.icon });
      await refreshInstances();
      afterImport(r);
      return true;
    }
    const inst = instanceById(instanceId);
    if (!inst) {
      toast('Pick an instance first', { message: 'Choose where to install it with the "Install to" menu.', kind: 'error' });
      return false;
    }
    const installed = await call('content:install', { instanceId, source: project.source, projectId: project.id, versionId, type, title: project.title, icon: project.icon });
    toast(`Installed to ${inst.name}`, {
      kind: 'success',
      message: installed.length > 1 ? `${installed[0]} and ${installed.length - 1} dependenc${installed.length === 2 ? 'y' : 'ies'}` : installed[0],
    });
    return true;
  } catch (err) {
    showError(err, `Couldn't install ${project.title}`);
    return false;
  }
}

function openProject(hit, ctx) {
  const shade = h('div.drawer-shade');
  const drawer = h('div.drawer');
  const close = () => {
    shade.remove();
    drawer.remove();
    document.removeEventListener('keydown', esc);
  };
  const esc = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', esc);
  shade.addEventListener('click', close);
  onLeave(close);

  const installBtn = btn(ctx.type === 'modpack' ? 'Install modpack' : ctx.instance ? `Install to ${instanceById(ctx.instance)?.name || 'instance'}` : 'Install', {
    cls: 'primary',
    icon: 'download',
    onClick: async () => {
      installBtn.disabled = true;
      const ok = await install(hit, null, ctx.instance, ctx.type);
      installBtn.disabled = false;
      if (ok && ctx.type === 'modpack') close();
    },
  });

  drawer.append(
    h(
      'div.d-head',
      projectIcon(hit),
      h('div.grow', h('h2', hit.title), h('div.muted.small', `by ${hit.author || 'unknown'} · ${compact(hit.downloads)} downloads`)),
      installBtn,
      iconBtn('x', { title: 'Close', onClick: close }),
    ),
  );
  const content = h('div.d-body', h('div.center', spinner('lg')));
  drawer.append(content);
  document.getElementById('layers').append(shade, drawer);

  Promise.all([
    call('browse:project', hit.source, hit.id),
    call('browse:versions', hit.source, hit.id, ctx.type === 'mod' || ctx.type === 'modpack' ? { loader: ctx.loader || undefined, gameVersion: ctx.version || undefined } : { gameVersion: ctx.version || undefined }).catch(() => []),
  ])
    .then(([project, versions]) => {
      const gallery = project.gallery && project.gallery.length ? h('div.gallery', project.gallery.slice(0, 8).map((src) => h('img', { src, loading: 'lazy' }))) : null;
      const versionList = h(
        'div.list',
        versions.slice(0, 30).map((v) =>
          h(
            'div.version-row',
            { style: 'padding:10px 14px' },
            h('div.grow', h('b', v.name || v.versionNumber), h('div.small.dim', `${v.gameVersions.slice(0, 4).join(', ')}${v.gameVersions.length > 4 ? '…' : ''} · ${v.loaders.map(loaderName).join(', ')} · ${ago(v.date)}`)),
            v.type !== 'release' ? h('span.chip', v.type) : null,
            btn('Install', {
              cls: 'sm',
              icon: 'download',
              onClick: () => install(hit, v.id, ctx.instance, ctx.type),
            }),
          ),
        ),
      );
      content.replaceChildren(
        gallery,
        h('div.row', { style: 'margin-bottom:16px' }, ...(project.categories || []).slice(0, 6).map((c) => h('span.chip', c)), h('div.grow'), project.url ? btn('Website', { cls: 'sm ghost', icon: 'external', onClick: () => call('app:openExternal', project.url) }) : null),
        h('div.prose', { html: renderBody(project.body || project.description || '', project.bodyFormat) }),
        h('div.section-head', h('h2', 'Versions'), h('span.dim.small', versions.length ? `${versions.length} compatible` : 'No compatible versions')),
        versions.length ? versionList : h('p.dim', 'No versions match this instance’s Minecraft version and loader.'),
      );
      for (const a of content.querySelectorAll('.prose a[href]')) {
        a.addEventListener('click', (e) => {
          e.preventDefault();
          call('app:openExternal', a.getAttribute('href'));
        });
      }
    })
    .catch((err) => content.replaceChildren(h('div.empty', h('div.art', icon('alert')), h('h2', 'Couldn’t load this project'), h('p', err.message))));
}

export function browsePage(route) {
  if (route.type) memory.type = route.type;
  if (route.instance) memory.instance = route.instance;
  if (memory.instance && !instanceById(memory.instance)) memory.instance = null;
  if (!memory.instance && memory.type !== 'modpack') {
    const firstModded = state.instances.find((i) => i.loader !== 'vanilla');
    memory.instance = (memory.type === 'mod' ? firstModded : state.instances[0])?.id || null;
  }

  const el = h('div.page');
  let offset = 0;
  let token = 0;
  const results = h('div.results');
  const pager = h('div.pager');
  const target = h('div');

  const ctx = () => {
    const inst = instanceById(memory.instance);
    if (memory.type !== 'modpack' && inst) {
      return { type: memory.type, instance: inst.id, loader: inst.loader === 'vanilla' ? '' : inst.loader, version: inst.mcVersion };
    }
    return { type: memory.type, instance: null, loader: memory.loader, version: memory.version };
  };

  const search = async () => {
    const my = ++token;
    const c = ctx();
    results.replaceChildren(...Array.from({ length: 6 }, () => h('div.skeleton', { style: 'height:98px' })));
    pager.replaceChildren();
    try {
      const r = await call('browse:search', memory.source, {
        query: memory.query,
        type: memory.type,
        loader: c.loader || undefined,
        gameVersion: c.version || undefined,
        sort: memory.sort,
        offset,
        limit: PAGE,
      });
      if (my !== token) return;
      if (!r.hits.length) {
        results.replaceChildren(h('div.empty', h('div.art', icon('search')), h('h2', 'Nothing found'), h('p', 'Try a different search or fewer filters.')));
        return;
      }
      results.replaceChildren(
        ...r.hits.map((hit, i) => {
          const quick = btn(memory.type === 'modpack' ? 'Install' : 'Install', {
            cls: 'sm primary',
            icon: 'download',
            onClick: async (e) => {
              e.stopPropagation();
              quick.disabled = true;
              await install(hit, null, c.instance, memory.type);
              quick.disabled = false;
            },
          });
          return h(
            'div.result',
            { style: `animation-delay:${i * 25}ms`, onclick: () => openProject(hit, c) },
            projectIcon(hit),
            h(
              'div.meta',
              h('div.t', hit.title, h('span.by', `by ${hit.author || 'unknown'}`)),
              h('div.d', hit.description),
              h(
                'div.facts',
                h('span', icon('download'), compact(hit.downloads)),
                hit.follows ? h('span', icon('heart'), compact(hit.follows)) : null,
                hit.updated ? h('span', icon('clock'), ago(hit.updated)) : null,
                ...(hit.categories || []).slice(0, 3).map((cat) => h('span.chip', { style: 'height:20px;font-size:11px' }, cat)),
              ),
            ),
            h('div.side', quick),
          );
        }),
      );
      const pages = Math.ceil(r.total / PAGE);
      const page = Math.floor(offset / PAGE) + 1;
      pager.replaceChildren(
        btn('', { cls: 'icon sm', icon: 'chevronLeft', disabled: page <= 1, onClick: () => go(offset - PAGE) }),
        h('span', `Page ${page} of ${Math.max(1, pages)}`),
        btn('', { cls: 'icon sm', icon: 'chevronRight', disabled: page >= pages, onClick: () => go(offset + PAGE) }),
      );
    } catch (err) {
      if (my !== token) return;
      const needsKey = memory.source === 'curseforge' && /API key/i.test(err.message);
      results.replaceChildren(
        h(
          'div.empty',
          h('div.art', icon(needsKey ? 'key' : 'alert')),
          h('h2', needsKey ? 'CurseForge needs an API key' : 'Couldn’t search'),
          h('p', needsKey ? 'Add your free CurseForge API key in Settings to browse CurseForge. Modrinth works without one.' : err.message),
          needsKey ? btn('Open settings', { cls: 'primary', icon: 'settings', onClick: () => navigate({ page: 'settings', section: 'integrations' }) }) : null,
        ),
      );
    }
  };
  const go = (o) => {
    offset = Math.max(0, o);
    el.scrollTop = 0;
    search();
  };

  const renderTarget = () => {
    if (memory.type === 'modpack') {
      target.replaceChildren(h('div.target', icon('info'), h('span.muted', 'Installing a modpack creates a new instance with everything set up.')));
      return;
    }
    const options = state.instances.map((i) => ({ value: i.id, label: `${i.name}  ·  ${loaderName(i.loader)} ${i.mcVersion}` }));
    if (!options.length) {
      target.replaceChildren(h('div.target', icon('info'), h('span.muted.grow', 'Create an instance first, then install things into it.')));
      return;
    }
    const sel = select(options, memory.instance, (v) => {
      memory.instance = v;
      offset = 0;
      search();
      renderTarget();
    });
    const inst = instanceById(memory.instance);
    target.replaceChildren(
      h(
        'div.target',
        h('span.label', 'Install to'),
        sel,
        inst && memory.type === 'mod' && inst.loader === 'vanilla' ? h('span.chip', { style: 'color:var(--warning)' }, icon('alert'), 'Vanilla can’t load mods') : null,
        inst ? h('span.dim.small', `Showing ${memory.type === 'mod' ? `${loaderName(inst.loader)} ` : ''}${inst.mcVersion} results`) : null,
      ),
    );
    if (!memory.instance) {
      memory.instance = options[0].value;
      renderTarget();
    }
  };

  el.append(
    h(
      'div.browse-head',
      h(
        'div.page-head',
        { style: 'margin:0' },
        h('div.titles', h('h1', 'Browse'), h('p', 'Find mods, modpacks, resource packs and shaders.')),
        segmented(
          [
            { value: 'modrinth', label: 'Modrinth' },
            { value: 'curseforge', label: 'CurseForge' },
          ],
          memory.source,
          (v) => {
            memory.source = v;
            go(0);
          },
        ),
      ),
      segmented(TYPES, memory.type, (v) => {
        memory.type = v;
        if (v !== 'modpack' && !memory.instance && state.instances[0]) memory.instance = state.instances[0].id;
        renderTarget();
        go(0);
      }),
      h(
        'div.filters',
        searchInput('Search…', memory.query, (v) => {
          memory.query = v;
          go(0);
        }),
        select(
          [
            { value: 'relevance', label: 'Relevance' },
            { value: 'downloads', label: 'Most downloads' },
            { value: 'follows', label: 'Most followed' },
            { value: 'updated', label: 'Recently updated' },
            { value: 'newest', label: 'Newest' },
          ],
          memory.sort,
          (v) => {
            memory.sort = v;
            go(0);
          },
        ),
      ),
      target,
    ),
    results,
    pager,
  );
  renderTarget();
  search();
  return { el };
}

export { menu };
