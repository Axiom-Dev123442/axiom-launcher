'use strict';
const endpoints = require('../endpoints');
const { getJson, postJson } = require('../http');

const PROJECT_TYPES = { mod: 'mod', resourcepack: 'resourcepack', shader: 'shader', modpack: 'modpack' };
const SORTS = { relevance: 'relevance', downloads: 'downloads', updated: 'updated', newest: 'newest', follows: 'follows' };

function api(p, opts) {
  return getJson(`${endpoints.modrinth}${p}`, opts);
}

async function search({ query = '', type = 'mod', loader, gameVersion, sort = 'relevance', offset = 0, limit = 20 }) {
  const facets = [[`project_type:${PROJECT_TYPES[type] || 'mod'}`]];
  if (loader && (type === 'mod' || type === 'modpack')) facets.push([`categories:${loader}`]);
  if (gameVersion) facets.push([`versions:${gameVersion}`]);
  const params = new URLSearchParams({
    query,
    facets: JSON.stringify(facets),
    index: SORTS[sort] || 'relevance',
    offset: String(offset),
    limit: String(limit),
  });
  const r = await api(`/search?${params}`);
  return {
    total: r.total_hits,
    hits: r.hits.map((h) => ({
      source: 'modrinth',
      id: h.project_id,
      slug: h.slug,
      title: h.title,
      description: h.description,
      author: h.author,
      icon: h.icon_url || null,
      downloads: h.downloads,
      follows: h.follows,
      categories: h.display_categories || h.categories || [],
      updated: h.date_modified,
      type,
    })),
  };
}

async function project(id) {
  const p = await api(`/project/${encodeURIComponent(id)}`);
  return {
    source: 'modrinth',
    id: p.id,
    slug: p.slug,
    title: p.title,
    description: p.description,
    body: p.body,
    bodyFormat: 'markdown',
    icon: p.icon_url || null,
    downloads: p.downloads,
    follows: p.followers,
    categories: p.categories || [],
    gallery: (p.gallery || []).map((g) => g.url),
    url: `https://modrinth.com/${p.project_type}/${p.slug}`,
    type: p.project_type,
    clientSide: p.client_side,
  };
}

function mapVersion(v) {
  return {
    source: 'modrinth',
    id: v.id,
    projectId: v.project_id,
    name: v.name,
    versionNumber: v.version_number,
    date: v.date_published,
    gameVersions: v.game_versions || [],
    loaders: v.loaders || [],
    type: v.version_type,
    files: (v.files || []).map((f) => ({
      url: f.url,
      filename: f.filename,
      sha1: f.hashes && f.hashes.sha1,
      sha512: f.hashes && f.hashes.sha512,
      size: f.size,
      primary: f.primary,
    })),
    dependencies: (v.dependencies || [])
      .filter((d) => d.dependency_type === 'required' && (d.project_id || d.version_id))
      .map((d) => ({ projectId: d.project_id, versionId: d.version_id })),
  };
}

async function versions(id, { loader, gameVersion } = {}) {
  const params = new URLSearchParams();
  if (loader) params.set('loaders', JSON.stringify([loader]));
  if (gameVersion) params.set('game_versions', JSON.stringify([gameVersion]));
  const list = await api(`/project/${encodeURIComponent(id)}/version?${params}`);
  return list.map(mapVersion);
}

async function version(versionId) {
  return mapVersion(await api(`/version/${encodeURIComponent(versionId)}`));
}

/** Looks up installed files by sha1, used to recognise mods dropped in by hand. */
async function versionsByHash(hashes) {
  if (!hashes.length) return {};
  const r = await postJson(`${endpoints.modrinth}/version_files`, { hashes, algorithm: 'sha1' });
  const out = {};
  for (const [hash, v] of Object.entries(r)) out[hash] = mapVersion(v);
  return out;
}

module.exports = { search, project, versions, version, versionsByHash };
