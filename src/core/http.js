'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { sha1File } = require('./util');
const pkg = require('../../package.json');

const USER_AGENT = `lazentho/obsidian-launcher/${pkg.version} (github.com/lazentho/obsidian-launcher)`;

class HttpError extends Error {
  constructor(status, url, body) {
    super(`HTTP ${status} for ${url}${body ? `: ${String(body).slice(0, 200)}` : ''}`);
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' }));
        },
        { once: true },
      );
    }
  });

function isRetryable(err) {
  if (err.name === 'AbortError') return false;
  if (err instanceof HttpError) return err.status === 429 || err.status >= 500;
  return true;
}

/** fetch() with a user agent, retries for transient failures and HttpError on bad status. */
async function request(url, opts = {}) {
  const { retries = 3, signal, headers = {}, ...rest } = opts;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...rest,
        signal,
        headers: { 'User-Agent': USER_AGENT, ...headers },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new HttpError(res.status, url, body);
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === retries) throw err;
      await sleep(500 * 2 ** attempt, signal);
    }
  }
  throw lastErr;
}

async function getJson(url, opts) {
  const res = await request(url, opts);
  return res.json();
}

async function postJson(url, body, opts = {}) {
  const res = await request(url, {
    method: 'POST',
    retries: 0,
    ...opts,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(opts.headers || {}) },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

/** Ends a write stream and waits until its file is closed, even if it failed. */
function closeStream(out) {
  return new Promise((resolve) => {
    if (out.closed) return resolve();
    out.once('close', resolve);
    out.end();
  });
}

/**
 * Streams url to dest, verifying sha1 when given. Writes to a temporary file
 * first so an interrupted download never looks complete.
 */
async function downloadFile(url, dest, { sha1, signal, onBytes, retries = 3 } = {}) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${crypto.randomBytes(4).toString('hex')}.part`;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let received = 0;
    try {
      const res = await request(url, { signal, retries: 0 });
      const hash = crypto.createHash('sha1');
      const out = fs.createWriteStream(tmp);
      // A write error (disk full, file locked) must fail the download, not crash the app or hang it.
      let writeError = null;
      out.on('error', (err) => {
        writeError = writeError || err;
      });
      try {
        for await (const chunk of res.body) {
          if (writeError) throw writeError;
          hash.update(chunk);
          received += chunk.length;
          if (onBytes) onBytes(chunk.length);
          if (!out.write(chunk)) await once(out, 'drain');
        }
      } finally {
        await closeStream(out);
      }
      if (writeError) throw writeError;
      const digest = hash.digest('hex');
      if (sha1 && digest.toLowerCase() !== sha1.toLowerCase()) {
        throw new Error(`Checksum mismatch for ${url}`);
      }
      await fsp.rename(tmp, dest);
      return;
    } catch (err) {
      lastErr = err;
      await fsp.rm(tmp, { force: true });
      if (onBytes && received) onBytes(-received);
      if (!isRetryable(err) || attempt === retries) throw err;
      await sleep(500 * 2 ** attempt, signal);
    }
  }
  throw lastErr;
}

/** True when the file at item.path is missing or does not match its metadata. */
async function needsDownload(item, verify) {
  let stat;
  try {
    stat = await fsp.stat(item.path);
  } catch {
    return true;
  }
  if (item.size && stat.size !== item.size) return true;
  if (verify && item.sha1) return (await sha1File(item.path)) !== item.sha1.toLowerCase();
  return false;
}

/**
 * Downloads many files in parallel, reporting byte progress to task.
 * items: [{ url, path, sha1?, size? }]
 */
async function downloadAll(items, task, { concurrency = 16, verify = false } = {}) {
  const seen = new Set();
  const unique = items.filter((i) => i.url && !seen.has(i.path) && seen.add(i.path));

  const pending = [];
  await runPool(unique, 32, async (item) => {
    if (await needsDownload(item, verify)) pending.push(item);
  });
  if (!pending.length) return 0;

  for (const item of pending) task.addTotal(item.size || 0);
  await runPool(
    pending,
    concurrency,
    async (item) => {
      task.throwIfCancelled();
      let counted = 0;
      await downloadFile(item.url, item.path, {
        sha1: item.sha1,
        signal: task.signal,
        onBytes: (n) => {
          counted += n;
          if (!item.size) task.addTotal(n);
          task.addDone(n);
        },
      });
      if (item.size && counted !== item.size) task.addDone(item.size - counted);
    },
    task.signal,
  );
  return pending.length;
}

/** Runs worker over items with bounded concurrency. Stops on the first error. */
async function runPool(items, concurrency, worker, signal) {
  let index = 0;
  let failed = null;
  const next = async () => {
    while (!failed && index < items.length) {
      if (signal && signal.aborted) {
        failed = Object.assign(new Error('Cancelled'), { name: 'AbortError' });
        break;
      }
      const item = items[index++];
      try {
        await worker(item);
      } catch (err) {
        failed = failed || err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
  if (failed) throw failed;
}

module.exports = {
  USER_AGENT,
  HttpError,
  request,
  getJson,
  postJson,
  downloadFile,
  downloadAll,
  needsDownload,
  runPool,
  sleep,
};
