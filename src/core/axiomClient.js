'use strict';
const path = require('node:path');
const fsp = require('node:fs/promises');
const { sha1 } = require('./util');

/**
 * The Axiom client (Right Shift menu, HUD and PvP mods, cosmetics) is built into the launcher:
 * its jar ships in assets/client and is put into every instance that can run it when you press
 * Play, together with Fabric API, which it needs. Updating the launcher updates the client.
 */

/** The Minecraft version the bundled client is made for. */
const MC_VERSION = '26.3';
const JAR_NAME = 'axiom-client.jar';
const BUNDLED = path.join(__dirname, '..', '..', 'assets', 'client', JAR_NAME);
/** Fabric API's Modrinth project id. */
const FABRIC_API = 'P7dR8mSH';

/** True if the instance can run the Axiom client (Fabric on the version it is made for). */
function supports(inst) {
  return inst.loader === 'fabric' && inst.mcVersion === MC_VERSION;
}

/** On unless the player turned it off for this instance. */
function wanted(inst) {
  return supports(inst) && inst.axiomClient !== false;
}

/**
 * Makes sure the instance has the current Axiom client and Fabric API, or removes the client if
 * it was turned off. Returns true if it changed anything.
 */
async function ensure({ instances, content }, inst, task) {
  const mods = path.join(instances.gameDir(inst.id), 'mods');
  const target = path.join(mods, JAR_NAME);
  if (!wanted(inst)) {
    await fsp.rm(target, { force: true });
    return false;
  }
  // Electron can read files inside its app archive, but not copy them, so read and write.
  const jar = await fsp.readFile(BUNDLED);
  let current = null;
  try {
    current = await fsp.readFile(target);
  } catch {}
  let changed = false;
  if (!current || sha1(current) !== sha1(jar)) {
    task.setStage('Installing Axiom Client');
    await fsp.mkdir(mods, { recursive: true });
    await fsp.writeFile(target, jar);
    changed = true;
  }
  // Older copies under other names would load twice.
  for (const name of await fsp.readdir(mods)) {
    if (name !== JAR_NAME && /^axiom-client.*\.jar(\.disabled)?$/i.test(name)) {
      await fsp.rm(path.join(mods, name), { force: true });
      changed = true;
    }
  }
  await content.updateIndex(inst.id, (index) => {
    index[`mods/${JAR_NAME}`] = { source: 'axiom', title: 'Axiom Client', description: 'Built into the Axiom Launcher', builtIn: true };
  });
  if (!(await hasFabricApi(content, inst, mods))) {
    task.setStage('Installing Fabric API');
    await content.install({ instanceId: inst.id, source: 'modrinth', projectId: 'fabric-api', type: 'mod' }, task);
    changed = true;
  }
  return changed;
}

async function hasFabricApi(content, inst, mods) {
  const index = await content.readIndex(inst.id);
  if (Object.values(index).some((e) => e.projectId === FABRIC_API)) return true;
  try {
    return (await fsp.readdir(mods)).some((n) => /^fabric-api.*\.jar$/i.test(n));
  } catch {
    return false;
  }
}

module.exports = { MC_VERSION, JAR_NAME, BUNDLED, supports, wanted, ensure };
