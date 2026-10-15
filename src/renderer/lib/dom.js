import { icon } from './icons.js';

// Let append/replaceChildren skip null, undefined and booleans like h() does,
// so conditional children never render as the text "null".
for (const name of ['append', 'prepend', 'replaceChildren', 'before', 'after']) {
  for (const proto of [Element.prototype, DocumentFragment.prototype]) {
    const original = proto[name];
    if (!original || original.__obsidian) continue;
    const patched = function (...nodes) {
      return original.apply(this, nodes.filter((n) => n != null && n !== false && n !== true));
    };
    patched.__obsidian = true;
    proto[name] = patched;
  }
}

/**
 * Tiny element builder: h('div.card#main', { onclick, style, attrs }, ...children)
 * Children may be strings, nodes, arrays, or null/false (skipped).
 */
export function h(tag, props, ...children) {
  if (props && (props instanceof Node || typeof props !== 'object' || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  const [, name = 'div', rest = ''] = tag.match(/^([a-z0-9-]*)(.*)$/i);
  const el = document.createElement(name || 'div');
  for (const part of rest.match(/[.#][^.#]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className += ` ${v}`;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = Boolean(v);
      else if (k === 'ref') v(el);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

export function mount(el, ...children) {
  clear(el);
  append(el, children);
  return el;
}

/** A button with an optional leading icon. */
export function btn(label, opts = {}) {
  const { icon: ic, cls = '', onClick, title, disabled, type } = opts;
  return h(
    `button.btn`,
    { class: cls, onclick: onClick, title, disabled, type: type || 'button' },
    ic ? icon(ic) : null,
    label ? h('span', label) : null,
  );
}

export function iconBtn(name, opts = {}) {
  const { title, onClick, cls = '' } = opts;
  return h('button.icon-btn', { class: cls, title, 'aria-label': title, onclick: onClick }, icon(name));
}

export function toggle(on, onChange) {
  const el = h('button.switch', { role: 'switch', 'aria-checked': String(Boolean(on)), class: on ? 'on' : '' });
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    const next = !el.classList.contains('on');
    el.classList.toggle('on', next);
    el.setAttribute('aria-checked', String(next));
    onChange(next);
  });
  return el;
}

export function segmented(options, value, onChange) {
  const el = h('div.segmented');
  for (const o of options) {
    const b = h('button', { class: o.value === value ? 'active' : '', type: 'button' }, o.icon ? icon(o.icon) : null, o.label);
    b.addEventListener('click', () => {
      for (const x of el.children) x.classList.remove('active');
      b.classList.add('active');
      onChange(o.value);
    });
    el.append(b);
  }
  return el;
}

export function select(options, value, onChange, cls = '') {
  const el = h('select.select', { class: cls });
  for (const o of options) el.append(h('option', { value: o.value, selected: o.value === value }, o.label));
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

export function searchInput(placeholder, value, onInput, delay = 250) {
  let t;
  const input = h('input.input', { placeholder, value: value || '', spellcheck: 'false' });
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => onInput(input.value), delay);
  });
  return h('div.search', icon('search'), input);
}

export function spinner(cls = '') {
  return h('div.spinner', { class: cls });
}

/** Sets a range input's filled track colour to match its value. */
export function paintRange(input) {
  const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.setProperty('--fill', `${pct}%`);
}

/**
 * Cascades an element's children in when it first appears. The class is
 * removed afterwards so later re-renders (a toggle, a selection) don't replay it.
 */
export function cascade(el) {
  el.classList.add('stagger');
  setTimeout(() => el.classList.remove('stagger'), 800);
  return el;
}
