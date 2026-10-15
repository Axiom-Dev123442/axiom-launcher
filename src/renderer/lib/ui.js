/** Toasts, modals, confirm dialogs and popover menus. */
import { h, btn, iconBtn } from './dom.js';
import { icon } from './icons.js';

const layers = () => document.getElementById('layers');

let toastBox = null;

export function toast(title, { message, kind = 'info', actions = [], timeout = 4500 } = {}) {
  if (!toastBox) {
    toastBox = h('div.toasts');
    document.body.append(toastBox);
  }
  const ic = { info: 'info', success: 'checkCircle', error: 'alert' }[kind] || 'info';
  const el = h(
    'div.toast',
    { class: kind },
    h('div.ic', icon(ic)),
    h(
      'div.meta',
      h('div.tt', title),
      message ? h('div.tm', message) : null,
      actions.length
        ? h(
            'div.ta',
            actions.map((a) =>
              btn(a.label, {
                cls: `sm ${a.primary ? 'primary' : ''}`,
                onClick: () => {
                  a.onClick();
                  close();
                },
              }),
            ),
          )
        : null,
    ),
    iconBtn('x', { title: 'Dismiss', onClick: () => close() }),
  );
  let timer;
  function close() {
    clearTimeout(timer);
    el.classList.add('out');
    setTimeout(() => el.remove(), 250);
  }
  if (timeout) {
    timer = setTimeout(close, timeout + (actions.length ? 4000 : 0));
    el.addEventListener('mouseenter', () => clearTimeout(timer));
    el.addEventListener('mouseleave', () => (timer = setTimeout(close, 2500)));
  }
  toastBox.append(el);
  return close;
}

/** Shows an error the main process sent, offering a link when there is one. */
export function showError(err, title = 'Something went wrong') {
  if (!err || err.cancelled || err.name === 'AbortError') return;
  const actions = [];
  if (err.openUrl) actions.push({ label: 'Open website', primary: true, onClick: () => window.obsidian.call('app:openExternal', err.openUrl) });
  toast(title, { message: err.message || String(err), kind: 'error', actions, timeout: 8000 });
}

/**
 * Opens a modal. build(close) returns { title, body, footer, wide }.
 * Returns a promise resolving with the value passed to close().
 */
export function modal(build) {
  return new Promise((resolve) => {
    let done = false;
    const shade = h('div.modal-shade');
    const close = (value) => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey);
      shade.style.animation = 'fade-in .15s reverse forwards';
      setTimeout(() => shade.remove(), 150);
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(undefined);
    };
    const spec = build(close);
    const box = h(
      'div.modal',
      { class: spec.wide ? 'wide' : '' },
      h('div.m-head', spec.icon || null, h('h2', spec.title), iconBtn('x', { title: 'Close', onClick: () => close(undefined) })),
      h('div.m-body', spec.body),
      spec.footer ? h('div.m-foot', spec.footer) : null,
    );
    shade.append(box);
    shade.addEventListener('mousedown', (e) => {
      if (e.target === shade && !spec.sticky) close(undefined);
    });
    document.addEventListener('keydown', onKey);
    layers().append(shade);
    const first = box.querySelector('input:not([type=hidden]), textarea');
    if (first) setTimeout(() => first.focus(), 50);
  });
}

export function confirmDialog({ title, message, confirm = 'Confirm', danger = false }) {
  return modal((close) => ({
    title,
    body: h('p.muted', { style: 'margin:0' }, message),
    footer: [
      btn('Cancel', { cls: 'ghost', onClick: () => close(false) }),
      btn(confirm, { cls: danger ? 'danger solid' : 'primary', onClick: () => close(true) }),
    ],
  }));
}

export function promptDialog({ title, label, value = '', placeholder = '', confirm = 'Save', hint }) {
  return modal((close) => {
    const input = h('input.input', { value, placeholder, spellcheck: 'false' });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') close(input.value.trim());
    });
    return {
      title,
      body: h('div.field', { style: 'margin:0' }, label ? h('label', label) : null, input, hint ? h('div.hint', hint) : null),
      footer: [btn('Cancel', { cls: 'ghost', onClick: () => close(null) }), btn(confirm, { cls: 'primary', onClick: () => close(input.value.trim()) })],
    };
  });
}

let openPopover = null;

export function closePopover() {
  if (openPopover) openPopover();
  openPopover = null;
}

/**
 * Shows a popover anchored to an element (or at a mouse event).
 * content: a node, or a function (close) => node.
 */
export function popover(anchor, content, { placement = 'bottom-end', cls = '' } = {}) {
  closePopover();
  const el = h('div.popover', { class: cls });
  const close = () => {
    el.remove();
    document.removeEventListener('mousedown', outside, true);
    document.removeEventListener('keydown', esc);
    window.removeEventListener('blur', close);
    if (openPopover === close) openPopover = null;
  };
  el.append(typeof content === 'function' ? content(close) : content);
  layers().append(el);

  let x;
  let y;
  if (anchor instanceof MouseEvent) {
    x = anchor.clientX;
    y = anchor.clientY;
  } else {
    const r = anchor.getBoundingClientRect();
    const pr = el.getBoundingClientRect();
    if (placement === 'top-start') {
      x = r.left;
      y = r.top - pr.height - 8;
    } else if (placement === 'bottom-start') {
      x = r.left;
      y = r.bottom + 8;
    } else {
      x = r.right - pr.width;
      y = r.bottom + 8;
    }
  }
  const pr = el.getBoundingClientRect();
  x = Math.max(8, Math.min(x, window.innerWidth - pr.width - 8));
  y = Math.max(8, Math.min(y, window.innerHeight - pr.height - 8));
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;

  const outside = (e) => {
    if (!el.contains(e.target) && !(anchor instanceof Node && anchor.contains(e.target))) close();
  };
  const esc = (e) => e.key === 'Escape' && close();
  setTimeout(() => document.addEventListener('mousedown', outside, true));
  document.addEventListener('keydown', esc);
  window.addEventListener('blur', close);
  openPopover = close;
  return close;
}

/** A simple action menu. items: [{ label, icon, onClick, danger } | 'sep'] */
export function menu(anchor, items, opts) {
  return popover(
    anchor,
    (close) =>
      h(
        'div',
        { style: 'min-width:190px' },
        items.filter(Boolean).map((it) =>
          it === 'sep'
            ? h('div.menu-sep')
            : h(
                'button.menu-item',
                {
                  class: it.danger ? 'danger' : '',
                  onclick: () => {
                    close();
                    it.onClick();
                  },
                },
                it.icon ? icon(it.icon) : null,
                it.label,
              ),
        ),
      ),
    opts,
  );
}
