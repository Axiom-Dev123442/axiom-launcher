'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');

const { mavenPath, compareVersions, safeJoin, libraryKey, slugify } = require('../src/core/util');
const { isAllowed } = require('../src/core/rules');
const { offlineUuid, validOfflineName } = require('../src/core/auth/offline');
const { createZip, ZipFile, crc32 } = require('../src/core/zip');
const { mergeVersions } = require('../src/core/versions');
const { buildLaunchArgs, splitArgs, quoteArgFile } = require('../src/core/launch');
const { collectLibraries } = require('../src/core/install');
const { createPaths } = require('../src/core/paths');
const { encode, buildActivity } = require('../src/core/discord');
const { loaderFromMrpack, loaderFromCurseforge, loaderFromPrism } = require('../src/core/modpacks');
const { validateSkin } = require('../src/core/skins');
const { readModMeta } = require('../src/core/content');

const winEnv = { os: 'windows', arch: 'x86_64', version: '10.0', features: {} };

test('mavenPath handles classifiers and extensions', () => {
  assert.equal(mavenPath('org.lwjgl:lwjgl:3.3.1'), 'org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1.jar');
  assert.equal(mavenPath('org.lwjgl:lwjgl:3.3.1:natives-windows'), 'org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1-natives-windows.jar');
  assert.equal(
    mavenPath('net.minecraft:client:1.20.1-20230612.114412:mappings@txt'),
    'net/minecraft/client/1.20.1-20230612.114412/client-1.20.1-20230612.114412-mappings.txt',
  );
  assert.throws(() => mavenPath('broken'));
});

test('libraryKey ignores version but keeps classifier', () => {
  assert.equal(libraryKey('org.ow2.asm:asm:9.1'), libraryKey('org.ow2.asm:asm:9.6'));
  assert.notEqual(libraryKey('org.lwjgl:lwjgl:3.3.1'), libraryKey('org.lwjgl:lwjgl:3.3.1:natives-windows'));
});

test('compareVersions orders numerically', () => {
  assert.ok(compareVersions('47.2.10', '47.2.9') > 0);
  assert.ok(compareVersions('1.20', '1.20.1') < 0);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
});

test('safeJoin rejects path traversal', () => {
  const base = path.resolve('/tmp/x');
  assert.equal(safeJoin(base, 'mods/a.jar'), path.join(base, 'mods', 'a.jar'));
  assert.throws(() => safeJoin(base, '../evil.txt'));
  assert.throws(() => safeJoin(base, '/etc/passwd'));
});

test('slugify makes safe ids', () => {
  assert.equal(slugify('My Cool Pack!!'), 'my-cool-pack');
  assert.equal(slugify('***'), 'instance');
});

test('rules: last matching rule wins', () => {
  const rules = [{ action: 'allow' }, { action: 'disallow', os: { name: 'osx' } }];
  assert.equal(isAllowed(rules, winEnv), true);
  assert.equal(isAllowed(rules, { ...winEnv, os: 'osx' }), false);
  assert.equal(isAllowed([{ action: 'allow', os: { name: 'osx' } }], winEnv), false);
  assert.equal(isAllowed(undefined, winEnv), true);
  assert.equal(isAllowed([{ action: 'allow', features: { is_demo_user: true } }], winEnv), false);
  assert.equal(isAllowed([{ action: 'allow', features: { has_custom_resolution: true } }], { ...winEnv, features: { has_custom_resolution: true } }), true);
});

test('offline uuid matches vanilla offline mode', () => {
  assert.equal(offlineUuid('Notch'), 'b50ad385829d3141a2167e7d7539ba7f');
  assert.ok(validOfflineName('Steve_123'));
  assert.ok(!validOfflineName('no spaces'));
  assert.ok(!validOfflineName('ab'));
});

test('zip round trip', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'obs-zip-'));
  const big = Buffer.alloc(10000, 'a');
  const file = path.join(dir, 'a.zip');
  await fsp.writeFile(file, createZip([{ name: 'hello.txt', data: 'hi there' }, { name: 'dir/big.bin', data: big }]));
  const zip = await ZipFile.open(file);
  assert.equal(await zip.readText('hello.txt'), 'hi there');
  assert.deepEqual(await zip.read('dir/big.bin'), big);
  const written = await zip.extractTo(path.join(dir, 'out'), { prefix: 'dir/' });
  assert.deepEqual(written, ['big.bin']);
  await zip.close();
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('mergeVersions puts loader libraries first and dedupes', () => {
  const parent = {
    id: '1.20.1',
    mainClass: 'net.minecraft.client.main.Main',
    libraries: [{ name: 'org.ow2.asm:asm:9.1' }, { name: 'com.google:gson:2.10' }],
    arguments: { game: ['--username', '${auth_player_name}'], jvm: ['-cp', '${classpath}'] },
    downloads: { client: { url: 'x' } },
    assetIndex: { id: '5' },
  };
  const child = {
    id: 'fabric-loader-0.15.0-1.20.1',
    inheritsFrom: '1.20.1',
    mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
    libraries: [{ name: 'org.ow2.asm:asm:9.6' }, { name: 'net.fabricmc:fabric-loader:0.15.0' }],
    arguments: { game: [], jvm: ['-DFabricMcEmu= net.minecraft.client.main.Main '] },
  };
  const m = mergeVersions(parent, child);
  assert.equal(m.id, child.id);
  assert.equal(m.mainClass, child.mainClass);
  assert.equal(m.jar, '1.20.1');
  assert.deepEqual(
    m.libraries.map((l) => l.name),
    ['org.ow2.asm:asm:9.6', 'net.fabricmc:fabric-loader:0.15.0', 'com.google:gson:2.10'],
  );
  assert.equal(m.arguments.jvm.length, 3);
  assert.equal(m.inheritsFrom, undefined);
});

test('collectLibraries handles natives, rules and maven-style libraries', () => {
  const paths = createPaths('/data');
  const version = {
    libraries: [
      { name: 'a:b:1', downloads: { artifact: { path: 'a/b/1/b-1.jar', url: 'https://x/b.jar', sha1: 'aa', size: 1 } } },
      { name: 'mac:only:1', rules: [{ action: 'allow', os: { name: 'osx' } }], downloads: { artifact: { path: 'm.jar', url: 'u' } } },
      {
        name: 'org.lwjgl.lwjgl:lwjgl-platform:2.9.4',
        natives: { windows: 'natives-windows-${arch}' },
        extract: { exclude: ['META-INF/'] },
        downloads: { classifiers: { 'natives-windows-64': { path: 'n.jar', url: 'https://x/n.jar', sha1: 'bb', size: 2 } } },
      },
      { name: 'net.fabricmc:fabric-loader:0.15.0', url: 'https://maven.fabricmc.net/' },
      { name: 'forge:generated:1', downloads: { artifact: { path: 'g.jar', url: '' } } },
      { name: 'old:forge:1', url: 'http://files.minecraftforge.net/maven/' },
    ],
  };
  const r = collectLibraries(version, winEnv, paths);
  assert.equal(r.classpath.length, 4);
  assert.equal(r.natives.length, 1);
  const urls = r.downloads.map((d) => d.url);
  assert.ok(urls.includes('https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.15.0/fabric-loader-0.15.0.jar'));
  assert.ok(urls.includes('https://x/n.jar'));
  assert.ok(urls.includes('https://maven.minecraftforge.net/old/forge/1/forge-1.jar'));
  assert.ok(!urls.includes(''));
});

test('buildLaunchArgs for a modern version', () => {
  const version = {
    id: '1.20.1',
    mainClass: 'net.minecraft.client.main.Main',
    arguments: {
      game: [
        '--username',
        '${auth_player_name}',
        '--uuid',
        '${auth_uuid}',
        { rules: [{ action: 'allow', features: { is_demo_user: true } }], value: '--demo' },
        { rules: [{ action: 'allow', features: { has_custom_resolution: true } }], value: ['--width', '${resolution_width}', '--height', '${resolution_height}'] },
      ],
      jvm: ['-Djava.library.path=${natives_directory}', '-cp', '${classpath}'],
    },
  };
  const args = buildLaunchArgs({
    version,
    install: { classpath: ['a.jar', 'b.jar'], nativesDir: 'N', assetsRoot: 'A', gameAssets: 'A', assetIndex: '5', librariesDir: 'L' },
    account: { name: 'Steve', uuid: 'u1', accessToken: 't', type: 'offline' },
    instance: { memory: { min: 512, max: 2048 }, jvmArgs: '-XX:+UseG1GC "-Dfoo=a b"', resolution: { width: 1280, height: 720 } },
    gameDir: 'G',
    env: winEnv,
  });
  const sep = process.platform === 'win32' ? ';' : ':';
  assert.deepEqual(args.slice(0, 4), ['-Xms512M', '-Xmx2048M', '-XX:+UseG1GC', '-Dfoo=a b']);
  assert.ok(args.includes('-Djava.library.path=N'));
  assert.ok(args.includes(`a.jar${sep}b.jar`));
  assert.ok(!args.includes('--demo'));
  assert.deepEqual(args.slice(-4), ['--width', '1280', '--height', '720']);
  assert.equal(args[args.indexOf('net.minecraft.client.main.Main') + 2], 'Steve');
});

test('buildLaunchArgs for a legacy version', () => {
  const args = buildLaunchArgs({
    version: { id: '1.7.10', mainClass: 'net.minecraft.launchwrapper.Launch', minecraftArguments: '--username ${auth_player_name} --session ${auth_session} --assetsDir ${game_assets}' },
    install: { classpath: ['a.jar'], nativesDir: 'N', assetsRoot: 'A', gameAssets: 'V', assetIndex: '1.7.10', librariesDir: 'L' },
    account: { name: 'Alex', uuid: 'u2', accessToken: 'tok', type: 'microsoft' },
    instance: { memory: { max: 1024 } },
    gameDir: 'G',
    env: winEnv,
  });
  assert.ok(args.includes('-Djava.library.path=N'));
  assert.ok(args.includes('-cp'));
  assert.ok(args.includes('token:tok:u2'));
  assert.ok(args.includes('V'));
});

test('splitArgs and argfile quoting', () => {
  assert.deepEqual(splitArgs(` -Xss1M  "-Da=b c" '-Dq=1' `), ['-Xss1M', '-Da=b c', '-Dq=1']);
  assert.equal(quoteArgFile('C:\\a "b"'), '"C:\\\\a \\"b\\""');
});

test('discord frames and activity', () => {
  const frame = encode(1, { a: 1 });
  assert.equal(frame.readInt32LE(0), 1);
  assert.equal(frame.readInt32LE(4), 7);
  const a = buildActivity({ state: 'playing', instance: { name: 'Survival', mcVersion: '1.20.1', loader: 'fabric' }, startedAt: 5 });
  assert.equal(a.details, 'using Obsidian Launcher');
  assert.equal(a.state, '1.20.1 Fabric · Survival');
  assert.equal(a.timestamps.start, 5);
  const idle = buildActivity({ state: 'idle' });
  assert.equal(idle.state, 'In the launcher');
});

test('modpack loader detection', () => {
  assert.deepEqual(loaderFromMrpack({ minecraft: '1.20.1', 'fabric-loader': '0.15.0' }), { mcVersion: '1.20.1', loader: 'fabric', loaderVersion: '0.15.0' });
  assert.deepEqual(loaderFromMrpack({ minecraft: '1.20.1', forge: '47.2.0' }).loaderVersion, '1.20.1-47.2.0');
  assert.ok(loaderFromMrpack({ minecraft: '1.20.1', neoforge: '20.1' }).unsupported);
  assert.deepEqual(loaderFromCurseforge({ minecraft: { version: '1.19.2', modLoaders: [{ id: 'forge-43.2.0', primary: true }] } }), {
    mcVersion: '1.19.2',
    loader: 'forge',
    loaderVersion: '1.19.2-43.2.0',
  });
  assert.equal(
    loaderFromPrism({ components: [{ uid: 'net.minecraft', version: '1.20.1' }, { uid: 'net.fabricmc.fabric-loader', version: '0.15.0' }] }).loader,
    'fabric',
  );
});

test('skin validation', () => {
  const png = Buffer.alloc(32);
  Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(png);
  png.writeUInt32BE(64, 16);
  png.writeUInt32BE(64, 20);
  assert.deepEqual(validateSkin(png), { width: 64, height: 64 });
  png.writeUInt32BE(128, 16);
  assert.throws(() => validateSkin(png));
  assert.throws(() => validateSkin(Buffer.from('nope')));
});

test('reads mod names from fabric.mod.json', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'obs-mod-'));
  const jar = path.join(dir, 'm.jar');
  await fsp.writeFile(jar, createZip([{ name: 'fabric.mod.json', data: JSON.stringify({ id: 'x', name: 'Xaero', version: '1.2' }) }]));
  const meta = await readModMeta(jar);
  assert.equal(meta.title, 'Xaero');
  assert.equal(meta.version, '1.2');
});
