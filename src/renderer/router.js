/** Minimal router: one page rendered at a time inside .main. */
import { emit, on } from './lib/store.js';

export const route = { page: 'home' };
const pages = {};
const history = [];

export function registerPage(name, render) {
  pages[name] = render;
}

let current = null;
const pageScope = new Set();

/** Subscribes to an app event for as long as the current page is shown. */
export function pageOn(event, fn) {
  const off = on(event, fn);
  pageScope.add(off);
  return off;
}

/** Runs fn when the current page is left. */
export function onLeave(fn) {
  pageScope.add(fn);
}

export function navigate(next, { replace = false } = {}) {
  if (!replace) history.push({ ...route });
  for (const k of Object.keys(route)) delete route[k];
  Object.assign(route, next);
  render();
  emit('route', route);
}

export function back() {
  const prev = history.pop();
  if (prev) navigate(prev, { replace: true });
  else navigate({ page: 'home' }, { replace: true });
}

export function render() {
  const main = document.querySelector('.main');
  if (!main) return;
  if (current && current.cleanup) current.cleanup();
  for (const off of pageScope) off();
  pageScope.clear();
  const fn = pages[route.page] || pages.home;
  const result = fn(route);
  current = result;
  main.replaceChildren(result.el || result);
}
