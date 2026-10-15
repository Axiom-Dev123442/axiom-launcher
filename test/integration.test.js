'use strict';
/**
 * End-to-end test against a local fake of Mojang, Fabric and Modrinth:
 * installs Java, game files and Fabric, imports a modpack and "launches" with a
 * fake java executable that prints its arguments.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');

const endpoints = require('../src/core/endpoints');
const { createPaths } = require('../src/core/paths');
const { createZip } = require('../src/core/zip');
const { TaskManager } = require('../src/core/tasks');
const { VersionService } = require('../src/core/versions');
const { JavaService, runtimePlatform } = require('../src/core/java');
const { InstanceStore } = require('../src/core/instances');
const { AccountStore } = require('../src/core/accounts');
const { Settings } = require('../src/core/settings');
const { GameManager } = require('../src/core/game');
const { ContentManager } = require('../src/core/content');
const { ModpackManager } = require('../src/core/modpacks');

const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');
const sha512 = (b) => crypto.createHash('sha512').update(b).digest('hex');
const osName = { win32: 'windows', darwin: 'osx', linux: 'linux' }[process.platform];

function buildFixtures(base) {
  const files = new Map();
  const add = (p, body, type = 'application/octet-stream') => {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    files.set(p, { buf, type });
    return { url: base + p, sha1: sha1(buf), size: buf.length, buf };
  };

  const clientJar = add('/client.jar', createZip([{ name: 'net/minecraft/client/main/Main.class', data: 'fake' }]));
  const libJar = add('/libs/com/example/lib/1.0/lib-1.0.jar', createZip([{ name: 'x.class', data: 'x' }]));
  const nativeJar = add(
    `/libs/org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1-natives-${osName}.jar`,
    createZip([{ name: 'META-INF/MANIFEST.MF', data: 'x' }, { name: `${osName}/x64/org/lwjgl/liblwjgl.so`, data: 'native' }]),
  );
  const logCfg = add('/log/client-1.12.xml', '<Configuration/>');
  const assetBody = Buffer.from('sound data');
  const assetHash = sha1(assetBody);
  add(`/resources/${assetHash.slice(0, 2)}/${assetHash}`, assetBody);
  const assetIndex = add('/indexes/5.json', { objects: { 'minecraft/sounds/a.ogg': { hash: assetHash, size: assetBody.length } } });

  const version = add('/v/1.20.1.json', {
    id: '1.20.1',
    type: 'release',
    mainClass: 'net.minecraft.client.main.Main',
    javaVersion: { component: 'java-runtime-gamma', majorVersion: 17 },
    assetIndex: { id: '5', url: assetIndex.url, sha1: assetIndex.sha1, size: assetIndex.size },
    assets: '5',
    downloads: { client: { url: clientJar.url, sha1: clientJar.sha1, size: clientJar.size } },
    logging: { client: { argument: '-Dlog4j.configurationFile=${path}', file: { id: 'client-1.12.xml', url: logCfg.url, sha1: logCfg.sha1, size: logCfg.size } } },
    libraries: [
      { name: 'com.example:lib:1.0', downloads: { artifact: { path: 'com/example/lib/1.0/lib-1.0.jar', url: libJar.url, sha1: libJar.sha1, size: libJar.size } } },
      {
        name: `org.lwjgl:lwjgl:3.3.1:natives-${osName}`,
        rules: [{ action: 'allow', os: { name: osName } }],
        downloads: { artifact: { path: `org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1-natives-${osName}.jar`, url: nativeJar.url, sha1: nativeJar.sha1, size: nativeJar.size } },
      },
    ],
    arguments: {
      game: ['--username', '${auth_player_name}', '--version', '${version_name}', '--gameDir', '${game_directory}', '--assetsDir', '${assets_root}', '--accessToken', '${auth_access_token}'],
      jvm: ['-Djava.library.path=${natives_directory}', '-cp', '${classpath}'],
    },
  });
  add('/manifest.json', { latest: { release: '1.20.1' }, versions: [{ id: '1.20.1', type: 'release', url: version.url, sha1: version.sha1 }] });

  // A fake java that prints the arguments it was started with.
  const fakeJava = add('/java/bin/java', '#!/bin/sh\necho "FAKEJAVA $@"\n');
  const javaManifest = add('/java/manifest.json', {
    files: {
      bin: { type: 'directory' },
      'bin/java': { type: 'file', executable: true, downloads: { raw: { url: fakeJava.url, sha1: fakeJava.sha1, size: fakeJava.size } } },
    },
  });
  add('/java/all.json', {
    [runtimePlatform()]: {
      'java-runtime-gamma': [{ manifest: { url: javaManifest.url, sha1: javaManifest.sha1 }, version: { name: '17.0.8' } }],
    },
  });

  // Fabric meta and maven.
  const fabricJar = add('/maven/net/fabricmc/fabric-loader/0.15.0/fabric-loader-0.15.0.jar', createZip([{ name: 'f.class', data: 'f' }]));
  add('/fabric/versions/loader/1.20.1', [{ loader: { version: '0.15.0', stable: true } }]);
  add('/fabric/versions/loader/1.20.1/0.15.0/profile/json', {
    id: 'fabric-loader-0.15.0-1.20.1',
    inheritsFrom: '1.20.1',
    mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
    arguments: { game: [], jvm: ['-DFabricMcEmu= net.minecraft.client.main.Main '] },
    libraries: [{ name: 'net.fabricmc:fabric-loader:0.15.0', url: `${base}/maven/`, sha1: fabricJar.sha1, size: fabricJar.size }],
  });

  // A mod hosted on the fake CDN for the modpack.
  const modJar = createZip([{ name: 'fabric.mod.json', data: JSON.stringify({ id: 'sodium', name: 'Sodium', version: '0.5' }) }]);
  add('/cdn/sodium.jar', modJar);

  return { files, modJar };
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const f = server.fixtures.files.get(req.url.split('?')[0]);
      if (!f) {
        res.writeHead(404);
        return res.end('not found');
      }
      res.writeHead(200, { 'Content-Type': f.type, 'Content-Length': f.buf.length });
      res.end(f.buf);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

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
  });

  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'obsidian-it-'));
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
