'use strict';
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;

function pipePath(i) {
  if (process.platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${i}`;
  const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp';
  return path.join(base, `discord-ipc-${i}`);
}

function encode(op, data) {
  const json = Buffer.from(JSON.stringify(data));
  const header = Buffer.alloc(8);
  header.writeInt32LE(op, 0);
  header.writeInt32LE(json.length, 4);
  return Buffer.concat([header, json]);
}

/**
 * A small Discord Rich Presence client speaking Discord's local IPC protocol.
 * It reconnects quietly when Discord starts later, and does nothing when no
 * application id is configured.
 */
class DiscordPresence {
  constructor() {
    this.clientId = '';
    this.enabled = false;
    this.socket = null;
    this.ready = false;
    this.activity = null;
    this.retryTimer = null;
    this.buffer = Buffer.alloc(0);
  }

  configure({ clientId, enabled }) {
    const changed = clientId !== this.clientId || enabled !== this.enabled;
    this.clientId = clientId || '';
    this.enabled = Boolean(enabled && this.clientId);
    if (!changed) return;
    this._disconnect();
    if (this.enabled) this._connect(0);
  }

  set(activity) {
    this.activity = activity;
    if (this.ready) this._send();
  }

  _connect(i) {
    if (!this.enabled || this.socket) return;
    if (i > 9) {
      this._scheduleRetry();
      return;
    }
    const socket = net.createConnection(pipePath(i));
    let opened = false;
    socket.once('connect', () => {
      opened = true;
      this.socket = socket;
      socket.write(encode(OP_HANDSHAKE, { v: 1, client_id: this.clientId }));
    });
    socket.on('data', (d) => this._onData(d));
    socket.on('error', () => {
      if (!opened) {
        socket.destroy();
        this._connect(i + 1);
      }
    });
    socket.on('close', () => {
      if (!opened) return;
      this.socket = null;
      this.ready = false;
      this._scheduleRetry();
    });
  }

  _scheduleRetry() {
    clearTimeout(this.retryTimer);
    if (!this.enabled) return;
    this.retryTimer = setTimeout(() => this._connect(0), 20000);
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 8) {
      const op = this.buffer.readInt32LE(0);
      const len = this.buffer.readInt32LE(4);
      if (this.buffer.length < 8 + len) return;
      let msg = {};
      try {
        msg = JSON.parse(this.buffer.subarray(8, 8 + len).toString());
      } catch {}
      this.buffer = this.buffer.subarray(8 + len);
      if (op === OP_PING && this.socket) this.socket.write(encode(OP_PONG, msg));
      else if (op === OP_CLOSE) this._disconnect(true);
      else if (op === OP_FRAME && msg.evt === 'READY') {
        this.ready = true;
        this._send();
      }
    }
  }

  _send() {
    if (!this.socket || !this.ready) return;
    this.socket.write(
      encode(OP_FRAME, {
        cmd: 'SET_ACTIVITY',
        args: { pid: process.pid, activity: this.activity || undefined },
        nonce: crypto.randomUUID(),
      }),
    );
  }

  _disconnect(retry) {
    clearTimeout(this.retryTimer);
    if (this.socket) {
      this.socket.removeAllListeners('close');
      this.socket.destroy();
    }
    this.socket = null;
    this.ready = false;
    this.buffer = Buffer.alloc(0);
    if (retry) this._scheduleRetry();
  }

  destroy() {
    this.enabled = false;
    this._disconnect();
  }
}

/** Builds the activity shown on someone's Discord profile. */
function buildActivity({ state, instance, startedAt, hideInstance, buttonUrl }) {
  const activity = {
    details: 'using Axiom Launcher',
    assets: { large_image: 'axiom', large_text: 'Axiom Launcher' },
    instance: false,
  };
  if (state === 'playing' && instance) {
    const loader = instance.loader === 'vanilla' ? '' : ` ${instance.loader[0].toUpperCase()}${instance.loader.slice(1)}`;
    activity.state = hideInstance ? `${instance.mcVersion}${loader}` : `${instance.mcVersion}${loader} · ${instance.name}`.slice(0, 128);
    activity.timestamps = { start: startedAt || Date.now() };
    activity.assets.small_image = instance.loader === 'vanilla' ? 'vanilla' : instance.loader;
    activity.assets.small_text = loader ? loader.trim() : 'Vanilla';
  } else {
    activity.state = 'In the launcher';
  }
  if (buttonUrl) activity.buttons = [{ label: 'Get Axiom', url: buttonUrl }];
  return activity;
}

module.exports = { DiscordPresence, buildActivity, encode, pipePath };
