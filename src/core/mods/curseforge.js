'use strict';
const endpoints = require('../endpoints');
const { getJson, postJson } = require('../http');

const GAME_ID = 432;
const CLASS_IDS = { mod: 6, resourcepack: 12, shader: 6552, modpack: 4471 };
const LOADER_IDS = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
const SORTS = { relevance: 1, downloads: 6, updated: 3, newest: 11, follows: 2 };

let apiKey = '';
function setApiKey(key) {
  apiKey = String(key || '').trim();
}
function hasKey() {
  return Boolean(apiKey);
}

function headers() {
  if (!apiKey) throw new Error('CurseForge needs an API key. Add one in Settings → Integrations.');
  return { 'x-api-key': apiKey, Accept: 'application/json' };
}

function api(p) {
  return getJson(`${endpoints.curseforge}${p}`, { headers: headers() });
}

function typeOfClass(classId) {
  return Object.keys(CLASS_IDS).find((k) => CLASS_IDS[k] === classId) || 'mod';
}

function mapMod(m) {
  return {
    source: 'curseforge',
    id: String(m.id),
    slug: m.slug,
    title: m.name,
    description: m.summary,
    author: (m.authors && m.authors[0] && m.authors[0].name) || '',
    icon: (m.logo && (m.logo.thumbnailUrl || m.logo.url)) || null,
    downloads: m.downloadCount,
    follows: m.thumbsUpCount || 0,
    categories: (m.categories || []).map((c) => c.name),
    updated: m.dateModified,
    gallery: (m.screenshots || []).map((s) => s.url),
    url: (m.links && m.links.websiteUrl) || `https://www.curseforge.com/minecraft/mc-mods/${m.slug}`,
    type: typeOfClass(m.classId),
    classId: m.classId,
  };
}

async function search({ query = '', type = 'mod', loader, gameVersion, sort = 'relevance', offset = 0, limit = 20 }) {
  const params = new URLSearchParams({
    gameId: String(GAME_ID),
    classId: String(CLASS_IDS[type] || 6),
    searchFilter: query,
    sortField: String(SORTS[sort] || 1),
    sortOrder: 'desc',
    index: String(offset),
    pageSize: String(limit),
  });
  if (gameVersion) params.set('gameVersion', gameVersion);
  if (loader && (type === 'mod' || type === 'modpack') && LOADER_IDS[loader]) params.set('modLoaderType', String(LOADER_IDS[loader]));
  const r = await api(`/mods/search?${params}`);
  return { total: r.pagination ? r.pagination.totalCount : r.data.length, hits: r.data.map(mapMod) };
}

async function project(id) {
  const [{ data }, desc] = await Promise.all([
    api(`/mods/${encodeURIComponent(id)}`),
    api(`/mods/${encodeURIComponent(id)}/description`).catch(() => ({ data: '' })),
  ]);
  return { ...mapMod(data), body: desc.data || '', bodyFormat: 'html' };
}

function mapFile(f, modId) {
  const sha1 = (f.hashes || []).find((h) => h.algo === 1);
  const lowered = (f.gameVersions || []).map((v) => v.toLowerCase());
  return {
    source: 'curseforge',
    id: String(f.id),
    projectId: String(modId || f.modId),
    name: f.displayName,
    versionNumber: f.displayName,
    date: f.fileDate,
    gameVersions: (f.gameVersions || []).filter((v) => /^\d/.test(v)),
    loaders: ['forge', 'fabric', 'quilt', 'neoforge'].filter((l) => lowered.includes(l)),
    type: { 1: 'release', 2: 'beta', 3: 'alpha' }[f.releaseType] || 'release',
    blocked: !f.downloadUrl,
    files: [
      {
        url: f.downloadUrl,
        filename: f.fileName,
        sha1: sha1 && sha1.value,
        size: f.fileLength,
        primary: true,
      },
    ],
    dependencies: (f.dependencies || []).filter((d) => d.relationType === 3).map((d) => ({ projectId: String(d.modId) })),
  };
}

async function versions(id, { loader, gameVersion } = {}) {
  const params = new URLSearchParams({ pageSize: '50' });
  if (gameVersion) params.set('gameVersion', gameVersion);
  if (loader && LOADER_IDS[loader]) params.set('modLoaderType', String(LOADER_IDS[loader]));
  const r = await api(`/mods/${encodeURIComponent(id)}/files?${params}`);
  return r.data.map((f) => mapFile(f, id)).sort((a, b) => new Date(b.date) - new Date(a.date));
}

async function version(fileId, modId) {
  const r = await api(`/mods/${encodeURIComponent(modId)}/files/${encodeURIComponent(fileId)}`);
  return mapFile(r.data, modId);
}

/** Bulk lookups used by modpack installs. */
async function files(fileIds) {
  const r = await postJson(`${endpoints.curseforge}/mods/files`, { fileIds }, { headers: headers() });
  return r.data;
}

async function mods(modIds) {
  const r = await postJson(`${endpoints.curseforge}/mods`, { modIds }, { headers: headers() });
  return r.data.map(mapMod);
}

module.exports = { setApiKey, hasKey, search, project, versions, version, files, mods, mapFile, CLASS_IDS };
