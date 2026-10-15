'use strict';
const path = require('node:path');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const endpoints = require('./endpoints');
const { request, getJson, HttpError } = require('./http');
const { readJson, writeJson } = require('./util');

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/** Checks a buffer is a PNG Minecraft can use as a skin (64x64 or legacy 64x32). */
function validateSkin(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24 || !buf.subarray(0, 4).equals(PNG_MAGIC)) {
    throw new Error('Skins must be PNG images.');
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width !== 64 || (height !== 64 && height !== 32)) {
    throw new Error(`Skins must be 64×64 pixels (this one is ${width}×${height}).`);
  }
  return { width, height };
}

async function fetchImage(url) {
  const res = await request(url.replace(/^http:\/\//, 'https://'), { retries: 1 });
  return Buffer.from(await res.arrayBuffer());
}

function toDataUrl(buf) {
  return `data:image/png;base64,${buf.toString('base64')}`;
}

/** Looks up any player's current skin by username. */
async function skinByUsername(username) {
  let profile;
  try {
    profile = await getJson(`${endpoints.mojangApi}/users/profiles/minecraft/${encodeURIComponent(username)}`, { retries: 1 });
  } catch (err) {
    if (err instanceof HttpError && (err.status === 404 || err.status === 204)) throw new Error(`No player called ${username}.`);
    throw err;
  }
  const session = await getJson(`${endpoints.sessionServer}/session/minecraft/profile/${profile.id}`, { retries: 1 });
  const prop = (session.properties || []).find((p) => p.name === 'textures');
  const textures = JSON.parse(Buffer.from(prop.value, 'base64').toString()).textures || {};
  if (!textures.SKIN) throw new Error(`${profile.name} uses the default skin.`);
  const variant = textures.SKIN.metadata && textures.SKIN.metadata.model === 'slim' ? 'slim' : 'classic';
  return { name: profile.name, variant, data: await fetchImage(textures.SKIN.url) };
}

async function uploadSkin(mcToken, png, variant) {
  validateSkin(png);
  const form = new FormData();
  form.append('variant', variant === 'slim' ? 'slim' : 'classic');
  form.append('file', new Blob([png], { type: 'image/png' }), 'skin.png');
  await request(`${endpoints.mcServices}/minecraft/profile/skins`, {
    method: 'POST',
    retries: 0,
    headers: { Authorization: `Bearer ${mcToken}` },
    body: form,
  });
}

async function resetSkin(mcToken) {
  await request(`${endpoints.mcServices}/minecraft/profile/skins/active`, {
    method: 'DELETE',
    retries: 0,
    headers: { Authorization: `Bearer ${mcToken}` },
  });
}

async function setCape(mcToken, capeId) {
  const headers = { Authorization: `Bearer ${mcToken}` };
  if (!capeId) {
    await request(`${endpoints.mcServices}/minecraft/profile/capes/active`, { method: 'DELETE', retries: 0, headers });
    return;
  }
  await request(`${endpoints.mcServices}/minecraft/profile/capes/active`, {
    method: 'PUT',
    retries: 0,
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ capeId }),
  });
}

/** The skins people saved in the launcher, stored as PNG files plus an index. */
class SkinLibrary {
  constructor(paths) {
    this.dir = paths.skins;
    this.indexFile = path.join(paths.skins, 'library.json');
  }

  async list() {
    const index = await readJson(this.indexFile, []);
    const out = [];
    for (const s of index) {
      try {
        out.push({ ...s, data: toDataUrl(await fsp.readFile(path.join(this.dir, s.file))) });
      } catch {}
    }
    return out;
  }

  async add({ name, variant, data }) {
    validateSkin(data);
    const index = await readJson(this.indexFile, []);
    const id = crypto.randomUUID();
    const file = `${id}.png`;
    await fsp.mkdir(this.dir, { recursive: true });
    await fsp.writeFile(path.join(this.dir, file), data);
    index.unshift({ id, name: String(name || 'Skin').slice(0, 32), variant: variant === 'slim' ? 'slim' : 'classic', file, addedAt: Date.now() });
    await writeJson(this.indexFile, index);
    return id;
  }

  async update(id, changes) {
    const index = await readJson(this.indexFile, []);
    const s = index.find((x) => x.id === id);
    if (!s) return;
    if (changes.name) s.name = String(changes.name).slice(0, 32);
    if (changes.variant) s.variant = changes.variant === 'slim' ? 'slim' : 'classic';
    await writeJson(this.indexFile, index);
  }

  async remove(id) {
    const index = await readJson(this.indexFile, []);
    const s = index.find((x) => x.id === id);
    if (!s) return;
    await fsp.rm(path.join(this.dir, s.file), { force: true });
    await writeJson(this.indexFile, index.filter((x) => x.id !== id));
  }

  async read(id) {
    const index = await readJson(this.indexFile, []);
    const s = index.find((x) => x.id === id);
    if (!s) throw new Error('Skin not found');
    return { ...s, buffer: await fsp.readFile(path.join(this.dir, s.file)) };
  }
}

module.exports = { validateSkin, fetchImage, toDataUrl, skinByUsername, uploadSkin, resetSkin, setCape, SkinLibrary };
