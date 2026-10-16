/** Small shared pieces: instance icons, loader chips, play buttons. */
import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { iconSrc, iconIsPixel } from '../lib/blocks.js';
import { call, state, launchTask, gameState, refreshInstances, activeAccount } from '../lib/store.js';
import { showError, toast } from '../lib/ui.js';
import { loaderName } from '../lib/format.js';
import { navigate, pageOn } from '../router.js';

export function instanceIcon(inst, cls = '') {
  const icon = inst && inst.icon;
  return h('img.ii', { class: `${cls} ${iconIsPixel(icon) ? '' : 'smooth'}`, src: iconSrc(icon), alt: '', draggable: 'false' });
}

export function loaderChip(inst) {
  return h(`span.chip.${inst.loader}`, loaderName(inst.loader));
}

export function versionChip(inst) {
  return h('span.chip', icon('cpu'), inst.mcVersion);
}

/** Starts an instance, asking for an account first if there is none. */
export async function launch(id) {
  if (!activeAccount()) {
    toast('Add an account first', {
      message: 'Click the account card at the bottom left to add a Microsoft or offline account.',
      kind: 'error',
    });
    return;
  }
  try {
    await call('game:launch', id);
  } catch (err) {
    if (err.code === 'RELOGIN') {
      toast('Sign in again', { message: err.message, kind: 'error' });
    } else {
      showError(err, 'Could not start Minecraft');
    }
  }
}

function pct(task) {
  if (!task || !task.total) return 0;
  return Math.min(100, (task.done / task.total) * 100);
}

/**
 * The large play button. It keeps itself in sync with the game state and the
 * launch task's progress.
 */
export function playButton(id, { size = 'lg' } = {}) {
  const fill = h('i.fill', { style: 'width:0' });
  const label = h('span.pl-label');
  const el = h('button.btn.primary.play', { class: size }, fill, label);

  const render = () => {
    const st = gameState(id);
    const task = launchTask(id);
    el.classList.toggle('running', st === 'running');
    el.classList.toggle('preparing', st === 'preparing');
    if (st === 'running') {
      label.replaceChildren(icon('stop'), 'STOP');
      fill.style.width = '0';
    } else if (st === 'preparing') {
      const p = pct(task);
      fill.style.width = `${p}%`;
      label.replaceChildren(h('div.spinner', { style: 'width:16px;height:16px;border-width:2px' }), h('span', task ? task.stage : 'Preparing'), p ? h('span.sub', `${Math.round(p)}%`) : null);
    } else {
      fill.style.width = '0';
      label.replaceChildren(icon('play'), 'PLAY');
    }
  };
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    const st = gameState(id);
    if (st === 'running') call('game:kill', id);
    else if (st === 'preparing') call('game:cancel', id);
    else launch(id);
  });
  render();
  pageOn('game-state', render);
  pageOn('tasks', render);
  return el;
}

/** A small round play button for cards. */
export function roundPlay(id) {
  const el = h('button.round-play', { title: 'Play' });
  const render = () => {
    const st = gameState(id);
    el.classList.toggle('running', st === 'running');
    el.classList.toggle('preparing', st === 'preparing');
    el.title = st === 'running' ? 'Stop' : st === 'preparing' ? 'Cancel' : 'Play';
    el.replaceChildren(st === 'preparing' ? h('div.spinner', { style: 'width:15px;height:15px;border-width:2px' }) : icon(st === 'running' ? 'stop' : 'play'));
  };
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    const st = gameState(id);
    if (st === 'running') call('game:kill', id);
    else if (st === 'preparing') call('game:cancel', id);
    else launch(id);
  });
  render();
  pageOn('game-state', render);
  return el;
}

export function statusDot(id) {
  const st = gameState(id);
  if (st === 'idle') return null;
  return h('span.dot', { class: st === 'preparing' ? 'preparing' : '', title: st === 'running' ? 'Running' : 'Starting' });
}

export function openInstance(id, tab) {
  navigate({ page: 'instance', id, tab });
}

export async function reloadInstances() {
  try {
    await refreshInstances();
  } catch (err) {
    showError(err);
  }
  return state.instances;
}

/** The Axiom Client runs on Fabric for Minecraft 26.3 (see core/axiomClient.js). */
export function hasAxiomSupport(inst) {
  return inst.loader === 'fabric' && inst.mcVersion === '26.3';
}

/** On unless the player turned it off for this instance. */
export function hasAxiomClient(inst) {
  return hasAxiomSupport(inst) && inst.axiomClient !== false;
}

/** The "Axiom" chip shown next to the version and loader of instances that have the client. */
export function axiomChip(inst) {
  return hasAxiomClient(inst) ? h('span.chip.axiom', 'Axiom') : null;
}
