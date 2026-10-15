'use strict';
/**
 * End-to-end test against a local fake of Mojang, Fabric and Modrinth:
 * installs Java, game files and Fabric, imports a modpack and "launches" with a
 * fake java executable that prints its arguments.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');

const endpoints = require('../src/core/endpoints');
const { createPaths } = require('../src/core/paths');
const { createZip } = require('../src/core/zip');
const { TaskManager } = require('../src/core/tasks');
const { VersionService } = require('../src/core/versions');
const { JavaService } = require('../src/core/java');
const { buildFixtures, startServer, sha1, sha512 } = require('./helpers');
const { InstanceStore } = require('../src/core/instances');
const { AccountStore } = require('../src/core/accounts');
const { Settings } = require('../src/core/settings');
const { GameManager } = require('../src/core/game');
const { ContentManager } = require('../src/core/content');
const { ModpackManager } = require('../src/core/modpacks');
const { BlockTextures } = require('../src/core/blockTextures');

test('install, fabric, modpack import and launch', { skip: process.platform === 'win32' }, async (t) => {
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  server.fixtures = buildFixtures(base);
  t.after(() => server.close());

  const saved = { ...endpoints };
  t.after(() => Object.assign(endpoints, saved));
  Object.assign(endpoints, {
    versionManifest: `${base}/manifest.json`,
    javaRuntimes: `${base}/java/all.json`,
    resources: `${base}/resources`,
    libraries: `${base}/libs/`,
    fabricMeta: `${base}/fabric`,
    packHosts: [new URL(base).host],
  });

  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'axiom-it-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const paths = createPaths(root);
  const tasks = new TaskManager();
  const settings = new Settings(paths);
  await settings.load();
  const versions = new VersionService(paths);
  const java = new JavaService(paths);
  const instances = new InstanceStore(paths);
  const accounts = new AccountStore(paths);
  const content = new ContentManager(instances);
  const modpacks = new ModpackManager({ paths, instances, content });
  const game = new GameManager({ paths, versions, java, instances, accounts, settings, tasks, launcherVersion: '0.1.0' });

  await accounts.addOffline('Tester');

  const waitExit = (id) => new Promise((resolve) => game.on('exit', (eid, info) => eid === id && resolve(info)));

  // Vanilla
  const vanilla = await instances.create({ name: 'Vanilla Test', mcVersion: '1.20.1', loader: 'vanilla', memory: { min: 256, max: 1024 } });
  let exited = waitExit(vanilla.id);
  await game.launch(vanilla.id);
  assert.equal((await exited).code, 0);
  let log = game.getLog(vanilla.id).map((l) => l.line).join('\n');
  assert.match(log, /FAKEJAVA -Xms256M -Xmx1024M/);
  assert.match(log, /--username Tester --version 1\.20\.1/);
  assert.match(log, /log4j\.configurationFile=.*client-1\.12\.xml/);
  assert.ok(await fsp.stat(path.join(paths.natives, '1.20.1', 'liblwjgl.so')));
  assert.ok(await fsp.stat(paths.versionJar('1.20.1')));
  const inst = await instances.get(vanilla.id);
  assert.ok(inst.lastPlayed > 0);

  // Instance icons come from the downloaded game jar.
  const blocks = new BlockTextures(paths, versions);
  assert.equal(await blocks.cached(), false);
  const textures = await blocks.load({ allowDownload: false });
  assert.deepEqual(Object.keys(textures).sort(), ['crafting', 'obsidian']);
  assert.equal(await blocks.cached(), true);

  // Fabric
  const fabric = await instances.create({ name: 'Fabric Test', mcVersion: '1.20.1', loader: 'fabric' });
  exited = waitExit(fabric.id);
  await game.launch(fabric.id);
  await exited;
  log = game.getLog(fabric.id).map((l) => l.line).join('\n');
  assert.match(log, /net\.fabricmc\.loader\.impl\.launch\.knot\.KnotClient/);
  assert.match(log, /fabric-loader-0\.15\.0\.jar/);
  assert.equal((await instances.get(fabric.id)).installedLoaderVersion, '0.15.0');

  // Modrinth pack import
  const { modJar } = server.fixtures;
  const mrpack = path.join(root, 'pack.mrpack');
  await fsp.writeFile(
    mrpack,
    createZip([
      {
        name: 'modrinth.index.json',
        data: JSON.stringify({
          formatVersion: 1,
          game: 'minecraft',
          versionId: '1.0',
          name: 'Test Pack',
          files: [
            { path: 'mods/sodium.jar', hashes: { sha1: sha1(modJar), sha512: sha512(modJar) }, env: { client: 'required', server: 'required' }, downloads: [`${base}/cdn/sodium.jar`], fileSize: modJar.length },
            { path: 'mods/server-only.jar', hashes: { sha1: 'x', sha512: 'y' }, env: { client: 'unsupported', server: 'required' }, downloads: [`${base}/nope`], fileSize: 1 },
          ],
          dependencies: { minecraft: '1.20.1', 'fabric-loader': '0.15.0' },
        }),
      },
      { name: 'overrides/config/sodium.json', data: '{"a":1}' },
    ]),
  );
  const imported = await tasks.run({ title: 'import' }, (task) => modpacks.importFile(mrpack, task));
  const packInst = imported.instance;
  assert.equal(packInst.name, 'Test Pack');
  assert.equal(packInst.loader, 'fabric');
  const gameDir = instances.gameDir(packInst.id);
  assert.equal(await fsp.readFile(path.join(gameDir, 'config', 'sodium.json'), 'utf8'), '{"a":1}');
  const mods = await content.list(packInst.id, 'mod');
  assert.equal(mods.length, 1);
  assert.equal(mods[0].fromPack, true);

  // Toggle and export
  await content.toggle(packInst.id, 'mod', 'sodium.jar', false);
  assert.equal((await content.list(packInst.id, 'mod'))[0].enabled, false);
  await content.toggle(packInst.id, 'mod', 'sodium.jar', true);
  await instances.update(packInst.id, { installedLoaderVersion: '0.15.0' });
  const out = path.join(root, 'export.mrpack');
  await modpacks.exportMrpack(packInst.id, out, { include: { config: true } });
  const info = await modpacks.inspect(out);
  assert.equal(info.loader, 'fabric');
  assert.equal(info.mcVersion, '1.20.1');

  // Task panel bookkeeping
  const list = tasks.list();
  assert.ok(list.every((x) => x.status === 'done'), JSON.stringify(list.filter((x) => x.status !== 'done')));
});
