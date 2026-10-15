'use strict';
const endpoints = require('../endpoints');
const { getJson } = require('../http');
const { writeJson, exists } = require('../util');

async function fabricLoaderVersions(mcVersion) {
  const list = await getJson(`${endpoints.fabricMeta}/versions/loader/${encodeURIComponent(mcVersion)}`);
  return list.map((e) => ({ version: e.loader.version, stable: e.loader.stable }));
}

async function fabricSupportedGameVersions() {
  const list = await getJson(`${endpoints.fabricMeta}/versions/game`);
  return list.map((e) => e.version);
}

/** Installs a Fabric profile json and returns its version id. */
async function installFabric({ mcVersion, loaderVersion, paths, task }) {
  if (!loaderVersion) {
    const versions = await fabricLoaderVersions(mcVersion);
    if (!versions.length) throw new Error(`Fabric does not support Minecraft ${mcVersion}`);
    loaderVersion = (versions.find((v) => v.stable) || versions[0]).version;
  }
  const id = `fabric-loader-${loaderVersion}-${mcVersion}`;
  if (await exists(paths.versionJson(id))) return id;
  if (task) task.setStage('Installing Fabric');
  const profile = await getJson(
    `${endpoints.fabricMeta}/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`,
    { signal: task && task.signal },
  );
  profile.id = id;
  await writeJson(paths.versionJson(id), profile);
  return id;
}

module.exports = { fabricLoaderVersions, fabricSupportedGameVersions, installFabric };
