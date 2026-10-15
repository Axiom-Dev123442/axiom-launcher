'use strict';
/** Preset instances against a fake Modrinth with only some projects available. */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');

const endpoints = require('../src/core/endpoints');
const { createPaths } = require('../src/core/paths');
const { TaskManager } = require('../src/core/tasks');
const { InstanceStore } = require('../src/core/instances');
const { ContentManager } = require('../src/core/content');
const presets = require('../src/core/presets');
const { buildFixtures, startServer, sha1 } = require('./helpers');

test('preset installs available mods, skips missing ones and tunes settings', async (t) => {
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  server.fixtures = buildFixtures(base);
  t.after(() => server.close());
  const { add } = server.fixtures;

  // slug -> [project type, supported game versions]
  const available = {
    'skyblocker-liam': ['mod', ['1.21.4', '1.21.5']],
    'fabric-api': ['mod', ['1.21.5']],
    sodium: ['mod', ['1.21.5']],
    lithium: ['mod', ['1.21.5']],
    zoomify: ['mod', ['1.21.5']],
    'hypixel-plus': ['resourcepack', ['1.21.5']],
  };
  for (const [slug, [type, games]] of Object.entries(available)) {
    const jar = Buffer.from(`${slug} file`);
    const ext = type === 'mod' ? 'jar' : 'zip';
    add(`/cdn/${slug}.${ext}`, jar);
    const pid = `id-${slug}`;
    const project = { id: pid, slug, title: slug, description: `${slug} desc`, body: '', icon_url: null, project_type: type };
    add(`/mr/project/${slug}`, project);
    add(`/mr/project/${pid}`, project);
    const version = {
      id: `v-${slug}`,
      project_id: pid,
      name: `${slug} 1.0`,
      version_number: '1.0',
      date_published: '2026-01-01T00:00:00Z',
      game_versions: games,
      loaders: type === 'mod' ? ['fabric'] : ['minecraft'],
      version_type: 'release',
      files: [{ url: `${base}/cdn/${slug}.${ext}`, filename: `${slug}.${ext}`, hashes: { sha1: sha1(jar), sha512: 'x' }, size: jar.length, primary: true }],
      dependencies: slug === 'skyblocker-liam' ? [{ project_id: 'id-fabric-api', dependency_type: 'required' }] : [],
    };
    add(`/mr/project/${slug}/version`, [version]);
    add(`/mr/project/${pid}/version`, [version]);
  }

  const saved = { ...endpoints };
  t.after(() => Object.assign(endpoints, saved));
  endpoints.modrinth = `${base}/mr`;

  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'axiom-presets-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const paths = createPaths(path.join(root, 'data'));
  const tasks = new TaskManager();
  const instances = new InstanceStore(paths);
  const content = new ContentManager(instances);

  const r = await tasks.run({ title: 'preset' }, (task) => presets.installPreset('skyblock', { instances, content }, task));
  assert.equal(r.instance.mcVersion, '1.21.5');
  assert.equal(r.instance.loader, 'fabric');
  assert.equal(r.instance.memory.max, 4096);
  assert.match(r.instance.jvmArgs, /UseG1GC/);
  assert.ok(r.skipped.includes('ferrite-core'));
  assert.ok(!r.skipped.includes('sodium'));

  const mods = (await content.list(r.instance.id, 'mod')).map((m) => m.file).sort();
  assert.deepEqual(mods, ['fabric-api.jar', 'lithium.jar', 'skyblocker-liam.jar', 'sodium.jar', 'zoomify.jar']);

  const options = await fsp.readFile(path.join(instances.gameDir(r.instance.id), 'options.txt'), 'utf8');
  assert.match(options, /renderDistance:12/);
  assert.match(options, /resourcePacks:\["vanilla","file\/hypixel-plus\.zip"\]/);

  // Performance mods on an existing instance skip what's already there.
  const perf = await tasks.run({ title: 'perf' }, (task) => presets.installPerformanceMods(r.instance.id, { instances, content }, task));
  assert.deepEqual(perf.installed, []);
});
