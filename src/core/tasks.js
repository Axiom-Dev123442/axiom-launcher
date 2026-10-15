'use strict';
const { EventEmitter } = require('node:events');

let nextId = 1;

/**
 * A unit of background work shown in the downloads panel. Progress is tracked
 * in bytes when known, otherwise in item counts.
 */
class Task {
  constructor(manager, { title, kind = 'download', icon = null, ref = null }) {
    this.manager = manager;
    this.id = nextId++;
    this.title = title;
    this.kind = kind;
    this.icon = icon;
    this.ref = ref;
    this.status = 'running';
    this.stage = 'Starting';
    this.total = 0;
    this.done = 0;
    this.error = null;
    this.startedAt = Date.now();
    this.finishedAt = null;
    this.speed = 0;
    this._sample = { t: Date.now(), done: 0 };
    this.controller = new AbortController();
  }

  get signal() {
    return this.controller.signal;
  }

  setStage(stage) {
    this.stage = stage;
    this._changed();
  }

  addTotal(n) {
    this.total += n;
    this._changed();
  }

  addDone(n) {
    this.done += n;
    this._changed();
  }

  /** Resets the counters for a new stage of work. */
  reset(stage) {
    this.stage = stage;
    this.total = 0;
    this.done = 0;
    this._sample = { t: Date.now(), done: 0 };
    this._changed();
  }

  throwIfCancelled() {
    if (this.signal.aborted) {
      const err = new Error('Cancelled');
      err.name = 'AbortError';
      throw err;
    }
  }

  finish(stage = 'Done') {
    if (this.status !== 'running') return;
    this.status = 'done';
    this.stage = stage;
    this.finishedAt = Date.now();
    this.done = Math.max(this.done, this.total);
    this._changed(true);
  }

  fail(err) {
    if (this.status !== 'running') return;
    const aborted = err && err.name === 'AbortError';
    this.status = aborted ? 'cancelled' : 'failed';
    this.error = aborted ? null : String((err && err.message) || err);
    this.stage = aborted ? 'Cancelled' : 'Failed';
    this.finishedAt = Date.now();
    this._changed(true);
  }

  cancel() {
    if (this.status === 'running') this.controller.abort();
  }

  snapshot() {
    const now = Date.now();
    const dt = (now - this._sample.t) / 1000;
    if (dt >= 0.5) {
      const instant = (this.done - this._sample.done) / dt;
      this.speed = this.speed ? this.speed * 0.6 + instant * 0.4 : instant;
      this._sample = { t: now, done: this.done };
    }
    return {
      id: this.id,
      title: this.title,
      kind: this.kind,
      icon: this.icon,
      ref: this.ref,
      status: this.status,
      stage: this.stage,
      total: this.total,
      done: this.done,
      speed: this.status === 'running' ? Math.max(0, this.speed) : 0,
      error: this.error,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
    };
  }

  _changed(force) {
    if (this.manager) this.manager._schedule(force);
  }
}

class TaskManager extends EventEmitter {
  constructor() {
    super();
    this.tasks = new Map();
    this._timer = null;
  }

  create(opts) {
    const task = new Task(this, opts);
    this.tasks.set(task.id, task);
    this._schedule(true);
    return task;
  }

  /** Runs fn(task) inside a new task, marking it finished or failed. */
  async run(opts, fn) {
    const task = this.create(opts);
    try {
      const result = await fn(task);
      task.finish();
      return result;
    } catch (err) {
      task.fail(err);
      throw err;
    }
  }

  cancel(id) {
    const t = this.tasks.get(id);
    if (t) t.cancel();
  }

  clearFinished() {
    for (const [id, t] of this.tasks) if (t.status !== 'running') this.tasks.delete(id);
    this._schedule(true);
  }

  list() {
    return [...this.tasks.values()].map((t) => t.snapshot()).reverse();
  }

  _schedule(force) {
    if (force) {
      clearTimeout(this._timer);
      this._timer = null;
      this.emit('change', this.list());
      return;
    }
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this.emit('change', this.list());
    }, 150);
  }
}

/** A task that reports nowhere, for use in tests and silent operations. */
function silentTask() {
  return new Task(null, { title: 'silent' });
}

module.exports = { Task, TaskManager, silentTask };
