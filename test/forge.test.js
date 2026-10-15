'use strict';
/**
 * End-to-end Forge install against a fake Forge installer. The installer's
 * processor is a real compiled Java program, so this exercises the same
 * steps (data resolution, processor runs, output checks) as real Forge.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');
const { execFileSync } = require('node:child_process');

const endpoints = require('../src/core/endpoints');
const { createPaths } = require('../src/core/paths');
const { createZip } = require('../src/core/zip');
const { TaskManager } = require('../src/core/tasks');
const { VersionService } = require('../src/core/versions');
const { JavaService } = require('../src/core/java');
const { InstanceStore } = require('../src/core/instances');
const { AccountStore } = require('../src/core/accounts');
const { Settings } = require('../src/core/settings');
const { GameManager } = require('../src/core/game');
const { buildFixtures, startServer, sha1 } = require('./helpers');

const PROC_SOURCE = `
import java.nio.file.*;
public class Proc {
  public static void main(String[] a) throws Exception {
    String in = null, out = null, mc = null;
    for (int i = 0; i < a.length; i++) {
      if (a[i].equals("--input")) in = a[++i];
      else if (a[i].equals("--output")) out = a[++i];
      else if (a[i].equals("--minecraft")) mc = a[++i];
    }
    if (!Files.exists(Paths.get(mc))) throw new RuntimeException("minecraft jar missing: " + mc);
    Path o = Paths.get(out);
    Files.createDirectories(o.getParent());
    Files.copy(Paths.get(in), o, StandardCopyOption.REPLACE_EXISTING);
  }
}`;

function hasJavac() {
  try {
    execFileSync('javac', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

test('forge: runs installer processors and launches', { skip: process.platform === 'win32' || !hasJavac() }, async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'obsidian-forge-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));

  // Compile the processor and pack it as a jar with a Main-Class.
  const src = path.join(root, 'src');
  await fsp.mkdir(src, { recursive: true });
  await fsp.writeFile(path.join(src, 'Proc.java'), PROC_SOURCE);
  execFileSync('javac', ['--release', '8', '-d', src, path.join(src, 'Proc.java')], { stdio: 'ignore' });
  const procJar = createZip([
    { name: 'META-INF/MANIFEST.MF', data: 'Manifest-Version: 1.0\r\nMain-Class: Proc\r\n\r\n' },
    { name: 'Proc.class', data: await fsp.readFile(path.join(src, 'Proc.class')) },
  ]);

  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  server.fixtures = buildFixtures(base);
  t.after(() => server.close());
  const { add } = server.fixtures;

  const FORGE = '1.20.1-47.2.0';
  const proc = add('/forge-maven/com/example/proc/1.0/proc-1.0.jar', procJar);
  const binpatch = Buffer.from('patched client bytes');
  const fmlcore = createZip([{ name: 'fml.class', data: 'fml' }]);
  const installer = createZip([
    {
      name: 'install_profile.json',
      data: JSON.stringify({
        spec: 1,
        version: `1.20.1-forge-47.2.0`,
        minecraft: '1.20.1',
        data: {
          BINPATCH: { client: '/data/client.lzma', server: '/data/server.lzma' },
          PATCHED: { client: `[net.minecraftforge:forge:${FORGE}:client]`, server: '[x:y:1]' },
          PATCHED_SHA: { client: `'${sha1(binpatch)}'`, server: "''" },
        },
        processors: [
          { sides: ['server'], jar: 'does:not:exist', args: [] },
          {
            jar: 'com.example:proc:1.0',
            classpath: [],
            args: ['--input', '{BINPATCH}', '--output', '{PATCHED}', '--minecraft', '{MINECRAFT_JAR}'],
            outputs: { '{PATCHED}': '{PATCHED_SHA}' },
          },
        ],
        libraries: [{ name: 'com.example:proc:1.0', downloads: { artifact: { path: 'com/example/proc/1.0/proc-1.0.jar', url: proc.url, sha1: proc.sha1, size: proc.size } } }],
      }),
    },
    {
      name: 'version.json',
      data: JSON.stringify({
        id: '1.20.1-forge-47.2.0',
        inheritsFrom: '1.20.1',
        mainClass: 'cpw.mods.bootstraplauncher.BootstrapLauncher',
        arguments: {
          game: ['--launchTarget', 'forgeclient'],
          jvm: ['-DlibraryDirectory=${library_directory}', '-p', '${library_directory}/a.jar${classpath_separator}${library_directory}/b.jar'],
        },
        libraries: [
          { name: `net.minecraftforge:forge:${FORGE}:client`, downloads: { artifact: { path: `net/minecraftforge/forge/${FORGE}/forge-${FORGE}-client.jar`, url: '' } } },
          { name: `net.minecraftforge:fmlcore:${FORGE}`, downloads: { artifact: { path: `net/minecraftforge/fmlcore/${FORGE}/fmlcore-${FORGE}.jar`, url: '' } } },
        ],
      }),
    },
    { name: `maven/net/minecraftforge/fmlcore/${FORGE}/fmlcore-${FORGE}.jar`, data: fmlcore },
    { name: 'data/client.lzma', data: binpatch },
  ]);
  add(`/forge-maven/net/minecraftforge/forge/${FORGE}/forge-${FORGE}-installer.jar`, installer);

  const saved = { ...endpoints };
  t.after(() => Object.assign(endpoints, saved));
  Object.assign(endpoints, {
    versionManifest: `${base}/manifest.json`,
    javaRuntimes: `${base}/java/all.json`,
    resources: `${base}/resources`,
    libraries: `${base}/libs/`,
    forgeMaven: `${base}/forge-maven`,
  });

  const paths = createPaths(path.join(root, 'data'));
  const tasks = new TaskManager();
  const settings = new Settings(paths);
  await settings.load();
  const versions = new VersionService(paths);
  const java = new JavaService(paths);
  const instances = new InstanceStore(paths);
  const accounts = new AccountStore(paths);
  const game = new GameManager({ paths, versions, java, instances, accounts, settings, tasks, launcherVersion: '0.1.0' });
  await accounts.addOffline('ForgeTester');

  const inst = await instances.create({ name: 'Forge Test', mcVersion: '1.20.1', loader: 'forge', loaderVersion: FORGE });
  const exited = new Promise((resolve) => game.on('exit', (id, info) => id === inst.id && resolve(info)));
  await game.launch(inst.id);
  assert.equal((await exited).code, 0);

  // The processor produced the patched client jar with the expected checksum.
  const patched = path.join(paths.libraries, `net/minecraftforge/forge/${FORGE}/forge-${FORGE}-client.jar`);
  assert.deepEqual(await fsp.readFile(patched), binpatch);
  // Files bundled in the installer were extracted.
  assert.ok(await fsp.stat(path.join(paths.libraries, `net/minecraftforge/fmlcore/${FORGE}/fmlcore-${FORGE}.jar`)));

  const updated = await instances.get(inst.id);
  assert.equal(updated.versionId, '1.20.1-forge-47.2.0');
  assert.equal(updated.installedLoaderVersion, '47.2.0');

  const log = game.getLog(inst.id).map((l) => l.line).join('\n');
  assert.match(log, /cpw\.mods\.bootstraplauncher\.BootstrapLauncher/);
  assert.match(log, /--launchTarget forgeclient/);
  assert.match(log, new RegExp(`-DlibraryDirectory=${paths.libraries.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`));
  assert.match(log, /forge-1\.20\.1-47\.2\.0-client\.jar/);
  assert.match(log, /--username ForgeTester/);

  // A second launch reuses the installed profile without re-running processors.
  const again = new Promise((resolve) => game.on('exit', (id, info) => id === inst.id && resolve(info)));
  await game.launch(inst.id);
  await again;
});
