/** The downloads panel opened from the title bar. */
import { h, btn, iconBtn } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { call, on, state } from '../lib/store.js';
import { popover } from '../lib/ui.js';
import { bytes } from '../lib/format.js';

const KIND_ICON = { launch: 'gamepad', mod: 'puzzle', modpack: 'package', repair: 'wrench', backup: 'hardDrive', download: 'download' };

function taskRow(t) {
  const running = t.status === 'running';
  const pct = t.total ? Math.min(100, (t.done / t.total) * 100) : 0;
  let detail;
  if (t.status === 'failed') detail = h('span.err', t.error || 'Failed');
  else if (t.status === 'cancelled') detail = h('span', 'Cancelled');
  else if (t.status === 'done') detail = h('span', t.kind === 'launch' ? 'Game started' : 'Finished');
  else detail = h('span', t.stage);
  const amount = running && t.total ? h('span', `${bytes(t.done)} / ${bytes(t.total)}${t.speed > 1024 ? ` · ${bytes(t.speed)}/s` : ''}`) : null;
  return h(
    'div.dl',
    { class: t.status },
    h('div.kind', t.icon ? h('img', { src: t.icon, alt: '' }) : icon(t.status === 'done' ? 'check' : t.status === 'failed' ? 'alert' : KIND_ICON[t.kind] || 'download')),
    h(
      'div.meta',
      h('div.t', t.title),
      h('div.s', detail, amount),
      running ? h('div.progress', { class: t.total ? '' : 'indeterminate' }, h('i', { style: `width:${pct}%` })) : null,
    ),
    running ? iconBtn('x', { title: 'Cancel', onClick: () => call('tasks:cancel', t.id) }) : null,
  );
}

export function openDownloads(anchor) {
  popover(
    anchor,
    () => {
      const list = h('div.dl-list');
      const render = () => {
        if (!state.tasks.length) {
          list.replaceChildren(h('div.empty', { style: 'padding:36px 10px' }, h('div.art', { style: 'width:56px;height:56px;border-radius:8px' }, icon('download')), h('div', 'Nothing downloading right now')));
          return;
        }
        list.replaceChildren(...state.tasks.map(taskRow));
      };
      render();
      const off = on('tasks', () => {
        if (!list.isConnected) return off();
        render();
      });
      return h(
        'div',
        h('div.dl-head', h('h3', 'Downloads'), btn('Clear finished', { cls: 'sm ghost', onClick: () => call('tasks:clear') })),
        list,
      );
    },
    { cls: 'downloads' },
  );
}
