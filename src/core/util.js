'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJson(p, fallback) {
  try {
    return JSON.parse(await fsp.readFile(p, 'utf8'));
  } catch (err) {
    if (fallback !== undefined) return fallback;
    throw err;
  }
}

const locks = new Map();

/**
 * Runs fn once every earlier call with the same key has finished, so
 * read-modify-write steps on one file never interleave and lose changes.
 * Key it with lockKey(file). fn must not take the same lock again.
 */
async function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  let release;
  const mine = new Promise((r) => (release = r));
  const tail = prev.then(() => mine);
  locks.set(key, tail);
  try {
    await prev;
    return await fn();
  } finally {
    release();
    if (locks.get(key) === tail) locks.delete(key);
  }
}

/** The lock key for a file, the same however its path is written. */
function lockKey(p) {
  return path.resolve(p).toLowerCase();
}

/** Windows briefly refuses a rename while something else (antivirus, the indexer, another rename) holds the file. */
async function renameRetrying(from, to) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fsp.rename(from, to);
    } catch (err) {
      if (attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
      await new Promise((r) => setTimeout(r, 20 * 2 ** attempt));
    }
  }
}

/**
 * Writes JSON atomically so a crash never leaves a half-written file. Writes
 * to one file run one at a time in call order, so the last call always wins.
 * This uses its own lock, so it is safe to call inside withLock(lockKey(p)).
 */
async function writeJson(p, data) {
  return withLock(`write:${lockKey(p)}`, async () => {
    await fsp.mkdir(path.dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      await fsp.writeFile(tmp, JSON.stringify(data, null, 2));
      await renameRetrying(tmp, p);
    } catch (err) {
      await fsp.rm(tmp, { force: true }).catch(() => {});
      throw err;
    }
  });
}

function sha1File(p) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    fs.createReadStream(p)
      .on('error', reject)
      .on('data', (d) => hash.update(d))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

function sha1(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex');
}

/**
 * Converts a maven coordinate (group:artifact:version[:classifier][@ext])
 * to its relative repository path.
 */
function mavenPath(name) {
  let ext = 'jar';
  let coord = name;
  const at = coord.indexOf('@');
  if (at !== -1) {
    ext = coord.slice(at + 1);
    coord = coord.slice(0, at);
  }
  const [group, artifact, version, classifier] = coord.split(':');
  if (!group || !artifact || !version) throw new Error(`Invalid maven name: ${name}`);
  const file = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.${ext}`;
  return [...group.split('.'), artifact, version, file].join('/');
}

/** A stable identity for a library ignoring its version, used to dedupe. */
function libraryKey(name) {
  const coord = name.split('@')[0].split(':');
  return [coord[0], coord[1], coord[3] || ''].join(':');
}

function slugify(s) {
  return (
    String(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'instance'
  );
}

/** Rejects paths that would escape their parent directory (zip slip etc). */
function safeJoin(base, rel) {
  const target = path.resolve(base, rel);
  const root = path.resolve(base);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`Unsafe path: ${rel}`);
  }
  return target;
}

function compareVersions(a, b) {
  const pa = String(a).split(/[.\-+]/);
  const pb = String(b).split(/[.\-+]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '';
    const y = pb[i] ?? '';
    const nx = /^\d+$/.test(x) ? Number(x) : NaN;
    const ny = /^\d+$/.test(y) ? Number(y) : NaN;
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) {
      if (nx !== ny) return nx - ny;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

module.exports = {
  exists,
  readJson,
  writeJson,
  withLock,
  lockKey,
  sha1File,
  sha1,
  mavenPath,
  libraryKey,
  slugify,
  safeJoin,
  compareVersions,
};
