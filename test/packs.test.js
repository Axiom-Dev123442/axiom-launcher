'use strict';
/** CurseForge and Prism/MultiMC imports against a fake CurseForge API. */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');

const endpoints = require('../src/core/endpoints');
const curseforge = require('../src/core/mods/curseforge');
const { createPaths } = require('../src/core/paths');
const { createZip } = require('../src/core/zip');
const { TaskManager } = require('../src/core/tasks');
const { InstanceStore } = require('../src/core/instances');
const { ContentManager } = require('../src/core/content');
const { ModpackManager } = require('../src/core/modpacks');
const { buildFixtures, startServer, sha1 } = require('./helpers');

test('curseforge and prism imports', async (t) => {
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  server.fixtures = buildFixtures(base);
  t.after(() => server.close());
  const { add } = server.fixtures;

  const jei = Buffer.from('jei jar');
  const pack = Buffer.from('resource pack zip');
  add('/cdn/jei.jar', jei);
  add('/cdn/faithful.zip', pack);
  add('/cf/mods/files', {
    data: [
      { id: 101, modId: 1, fileName: 'jei.jar', displayName: 'JEI 15', downloadUrl: `${base}/cdn/jei.jar`, fileLength: jei.length, hashes: [{ algo: 1, value: sha1(jei) }] },
      { id: 202, modId: 2, fileName: 'faithful.zip', displayName: 'Faithful', downloadUrl: `${base}/cdn/faithful.zip`, fileLength: pack.length, hashes: [] },
      { id: 303, modId: 3, fileName: 'optifine.jar', displayName: 'OptiFine', downloadUrl: null, fileLength: 1, hashes: [] },
    ],
  });
  add('/cf/mods', {
    data: [
      { id: 1, name: 'JEI', slug: 'jei', classId: 6, links: { websiteUrl: 'https://www.curseforge.com/minecraft/mc-mods/jei' } },
      { id: 2, name: 'Faithful', slug: 'faithful', classId: 12, links: { websiteUrl: 'https://www.curseforge.com/minecraft/texture-packs/faithful' } },
      { id: 3, name: 'OptiFine', slug: 'optifine', classId: 6, links: { websiteUrl: 'https://www.curseforge.com/minecraft/mc-mods/optifine' } },
    ],
  });

  const saved = { ...endpoints };
  t.after(() => {
    Object.assign(endpoints, saved);
    curseforge.setApiKey('');
  });
  endpoints.curseforge = `${base}/cf`;
  curseforge.setApiKey('test-key');

  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'axiom-packs-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const paths = createPaths(path.join(root, 'data'));
  const tasks = new TaskManager();
  const instances = new InstanceStore(paths);
  const content = new ContentManager(instances);
  const modpacks = new ModpackManager({ paths, instances, content });

  // CurseForge zip
  const cfZip = path.join(root, 'pack.zip');
  await fsp.writeFile(
    cfZip,
    createZip([
      {
        name: 'manifest.json',
        data: JSON.stringify({
          minecraft: { version: '1.20.1', modLoaders: [{ id: 'forge-47.2.0', primary: true }] },
          manifestType: 'minecraftModpack',
          name: 'CF Pack',
          version: '2.0',
          files: [
            { projectID: 1, fileID: 101, required: true },
            { projectID: 2, fileID: 202, required: true },
            { projectID: 3, fileID: 303, required: true },
          ],
          overrides: 'overrides',
        }),
      },
      { name: 'overrides/config/jei.toml', data: 'a=1' },
    ]),
  );
  const cf = await tasks.run({ title: 'cf' }, (task) => modpacks.importFile(cfZip, task));
  assert.equal(cf.instance.loader, 'forge');
  assert.equal(cf.instance.loaderVersion, '1.20.1-47.2.0');
  const dir = instances.gameDir(cf.instance.id);
  assert.deepEqual(await fsp.readFile(path.join(dir, 'mods', 'jei.jar')), jei);
  assert.deepEqual(await fsp.readFile(path.join(dir, 'resourcepacks', 'faithful.zip')), pack);
  assert.equal(await fsp.readFile(path.join(dir, 'config', 'jei.toml'), 'utf8'), 'a=1');
  assert.equal(cf.blocked.length, 1);
  assert.equal(cf.blocked[0].name, 'OptiFine');
  assert.match(cf.blocked[0].url, /optifine\/files\/303$/);
  const mods = await content.list(cf.instance.id, 'mod');
  assert.equal(mods[0].title, 'JEI');

  // Prism / MultiMC export
  const prismZip = path.join(root, 'prism.zip');
  await fsp.writeFile(
    prismZip,
    createZip([
      { name: 'My Instance/instance.cfg', data: 'name=Prism World\nMaxMemAlloc=6144\nMinMemAlloc=1024\n' },
      {
        name: 'My Instance/mmc-pack.json',
        data: JSON.stringify({
          components: [
            { uid: 'net.minecraft', version: '1.21.1' },
            { uid: 'net.fabricmc.fabric-loader', version: '0.16.5' },
          ],
        }),
      },
      { name: 'My Instance/.minecraft/saves/World/level.dat', data: 'level' },
      { name: 'My Instance/.minecraft/options.txt', data: 'fov:90' },
    ]),
  );
  const prism = await tasks.run({ title: 'prism' }, (task) => modpacks.importFile(prismZip, task));
  assert.equal(prism.instance.name, 'Prism World');
  assert.equal(prism.instance.loader, 'fabric');
  assert.equal(prism.instance.loaderVersion, '0.16.5');
  assert.equal(prism.instance.memory.max, 6144);
  const pdir = instances.gameDir(prism.instance.id);
  assert.equal(await fsp.readFile(path.join(pdir, 'saves', 'World', 'level.dat'), 'utf8'), 'level');

  // Unsupported loaders are refused before anything is created.
  const neo = path.join(root, 'neo.mrpack');
  await fsp.writeFile(
    neo,
    createZip([{ name: 'modrinth.index.json', data: JSON.stringify({ name: 'Neo', files: [], dependencies: { minecraft: '1.21.1', neoforge: '21.1.1' } }) }]),
  );
  const before = (await instances.list()).length;
  await assert.rejects(() => tasks.run({ title: 'neo' }, (task) => modpacks.importFile(neo, task)), /only Fabric, Quilt and Forge/);
  assert.equal((await instances.list()).length, before);
});
