'use strict';
const path = require('node:path');
const fsp = require('node:fs/promises');
const modrinth = require('./mods/modrinth');
const os = require('node:os');
const { compareVersions, exists } = require('./util');

/** Client-side performance mods for Fabric, installed in this order (Fabric API first so others reuse it). */
const PERFORMANCE_MODS = [
  'fabric-api',
  'sodium',
  'lithium',
  'ferrite-core',
  'entityculling',
  'immediatelyfast',
  'modernfix',
  'moreculling',
  'dynamic-fps',
  'modmenu',
];

/** Garbage collector settings that keep frame times smooth with 3 to 6 GB of memory. */
const JVM_ARGS =
  '-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions ' +
  '-XX:+DisableExplicitGC -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M ' +
  '-XX:G1ReservePercent=20 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15';

/** Video settings tuned for competitive play: high frame rate, no distractions. */
const PVP_OPTIONS = {
  renderDistance: 8,
  simulationDistance: 6,
  maxFps: 260,
  enableVsync: false,
  graphicsMode: 0,
  entityShadows: false,
  particles: 1,
  bobView: false,
  renderClouds: '"false"',
  biomeBlendRadius: 0,
};

const PRESETS = {
  bedwars: {
    name: 'Bedwars',
    icon: 'tnt',
    description: 'High FPS and a clean PvP look for Hypixel Bedwars.',
    anchor: 'sodium',
    memory: 3072,
    mods: [...PERFORMANCE_MODS, 'sodium-extra', 'reeses-sodium-options', 'zoomify'],
    resourcepacks: ['low-on-fire'],
    options: PVP_OPTIONS,
    server: 'mc.hypixel.net',
  },
  skyblock: {
    name: 'Hypixel SkyBlock',
    icon: 'grass',
    description: 'Skyblocker’s SkyBlock tools, smooth performance and a SkyBlock texture pack.',
    anchor: 'skyblocker-liam',
    memory: 4096,
    mods: [...PERFORMANCE_MODS, 'skyblocker-liam', 'zoomify'],
    resourcepacks: ['hypixel-plus'],
    options: { renderDistance: 12, simulationDistance: 8, maxFps: 240, enableVsync: false, particles: 1 },
    server: 'mc.hypixel.net',
  },
  cpvp: {
    name: 'Crystal PvP',
    icon: 'amethyst',
    description: 'Instant crystal placing, maximum FPS and low fire for crystal PvP.',
    anchor: 'marlows-crystal-optimizer',
    memory: 3072,
    mods: [...PERFORMANCE_MODS, 'marlows-crystal-optimizer', 'zoomify'],
    resourcepacks: ['low-on-fire'],
    options: PVP_OPTIONS,
  },
};

function listPresets() {
  return Object.entries(PRESETS).map(([id, p]) => ({
    id,
    name: p.name,
    icon: p.icon,
    description: p.description,
    highlights: [...p.mods.filter((m) => !PERFORMANCE_MODS.includes(m)), ...p.resourcepacks],
    modCount: p.mods.length,
  }));
}

const isRelease = (v) => /^\d+\.\d+(\.\d+)?$/.test(v);

/** The newest Minecraft release that a mod's latest Fabric build supports. */
async function newestSupportedVersion(slug) {
  const versions = await modrinth.versions(slug, { loader: 'fabric' });
  const pick = versions.find((v) => v.type === 'release') || versions[0];
  if (!pick) throw new Error(`${slug} has no Fabric versions`);
  const game = pick.gameVersions.filter(isRelease).sort(compareVersions);
  if (!game.length) throw new Error(`${slug} supports no release versions`);
  return game[game.length - 1];
}

/** Writes Minecraft's options.txt with the preset's settings and enabled resource packs. */
async function writeOptions(gameDir, options, packs) {
  const file = path.join(gameDir, 'options.txt');
  if (await exists(file)) return;
  const lines = Object.entries(options || {}).map(([k, v]) => `${k}:${v}`);
  if (packs.length) {
    lines.push(`resourcePacks:${JSON.stringify(['vanilla', ...packs.map((p) => `file/${p}`)])}`);
  }
  await fsp.mkdir(gameDir, { recursive: true });
  await fsp.writeFile(file, `${lines.join('\n')}\n`);
}

/**
 * Installs a list of Modrinth projects into an instance, skipping any that
 * have no build for its version. Returns { installed, skipped } titles/slugs.
 */
async function installMany(content, instanceId, slugs, type, task) {
  const installed = [];
  const skipped = [];
  const have = async () => Object.values(await content.readIndex(instanceId)).map((e) => e.projectId);
  for (const slug of slugs) {
    task.throwIfCancelled();
    try {
      const project = await modrinth.project(slug);
      if ((await have()).includes(project.id)) continue;
      installed.push(...(await content.install({ instanceId, source: 'modrinth', projectId: project.id, type }, task)));
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      skipped.push(slug);
    }
  }
  return { installed, skipped };
}

/** Creates a ready-to-play instance from a preset. */
async function installPreset(id, { instances, content }, task) {
  const preset = PRESETS[id];
  if (!preset) throw new Error('Unknown preset');
  task.setStage('Finding the best Minecraft version');
  let mcVersion;
  try {
    mcVersion = await newestSupportedVersion(preset.anchor);
  } catch {
    mcVersion = await newestSupportedVersion('sodium');
  }

  const inst = await instances.create({
    name: preset.name,
    icon: { type: 'preset', value: preset.icon },
    mcVersion,
    loader: 'fabric',
    // Never more than half the PC's memory, so low-end machines stay responsive.
    memory: { min: 1024, max: Math.min(preset.memory, Math.max(1536, Math.floor(os.totalmem() / 1024 ** 2 / 2 / 512) * 512)) },
    jvmArgs: JVM_ARGS,
    preset: id,
  });
  try {
    const mods = await installMany(content, inst.id, preset.mods, 'mod', task);
    const packs = await installMany(content, inst.id, preset.resourcepacks, 'resourcepack', task);
    const packFiles = (await content.list(inst.id, 'resourcepack')).map((p) => p.file);
    await writeOptions(instances.gameDir(inst.id), preset.options, packFiles);
    return {
      instance: await instances.get(inst.id),
      installed: [...mods.installed, ...packs.installed],
      skipped: [...mods.skipped, ...packs.skipped],
    };
  } catch (err) {
    if (err.name === 'AbortError') await instances.remove(inst.id).catch(() => {});
    throw err;
  }
}

/** Adds the performance mods to an existing Fabric instance. */
async function installPerformanceMods(instanceId, { instances, content }, task) {
  const inst = await instances.get(instanceId);
  if (inst.loader !== 'fabric') throw new Error('Performance mods are available for Fabric instances.');
  if (!inst.jvmArgs) await instances.update(instanceId, { jvmArgs: JVM_ARGS });
  return installMany(content, instanceId, PERFORMANCE_MODS, 'mod', task);
}

module.exports = { PRESETS, PERFORMANCE_MODS, JVM_ARGS, listPresets, installPreset, installPerformanceMods, writeOptions, newestSupportedVersion };
