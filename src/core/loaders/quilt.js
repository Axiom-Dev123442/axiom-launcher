'use strict';
const endpoints = require('../endpoints');
const { getJson } = require('../http');
const { writeJson, exists } = require('../util');

/** Quilt marks test builds in the version itself (0.27.0-beta.3) instead of a stable flag. */
const isStable = (version) => !/-(alpha|beta|pre|rc)/i.test(version);

async function quiltLoaderVersions(mcVersion) {
  const list = await getJson(`${endpoints.quiltMeta}/versions/loader/${encodeURIComponent(mcVersion)}`);
  return list.map((e) => ({ version: e.loader.version, stable: isStable(e.loader.version) }));
}

/** Installs a Quilt profile json (the same format as Fabric's) and returns its version id. */
async function installQuilt({ mcVersion, loaderVersion, paths, task }) {
  if (!loaderVersion) {
    const versions = await quiltLoaderVersions(mcVersion);
    if (!versions.length) throw new Error(`Quilt does not support Minecraft ${mcVersion}`);
    loaderVersion = (versions.find((v) => v.stable) || versions[0]).version;
  }
  const id = `quilt-loader-${loaderVersion}-${mcVersion}`;
  if (await exists(paths.versionJson(id))) return id;
  if (task) task.setStage('Installing Quilt');
  const profile = await getJson(
    `${endpoints.quiltMeta}/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`,
    { signal: task && task.signal },
  );
  profile.id = id;
  await writeJson(paths.versionJson(id), profile);
  return id;
}

module.exports = { quiltLoaderVersions, installQuilt };
