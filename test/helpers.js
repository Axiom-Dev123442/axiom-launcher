'use strict';
/** Shared fake Mojang / Fabric / Modrinth server for end-to-end tests. */
const http = require('node:http');
const crypto = require('node:crypto');
const { createZip } = require('../src/core/zip');
const { runtimePlatform } = require('../src/core/java');

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

  const texture = Buffer.from('89504e470d0a1a0a', 'hex');
  const clientJar = add(
    '/client.jar',
    createZip([
      { name: 'net/minecraft/client/main/Main.class', data: 'fake' },
      { name: 'assets/minecraft/textures/block/obsidian.png', data: texture },
      { name: 'assets/minecraft/textures/block/crafting_table_front.png', data: texture },
    ]),
  );
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
    releaseTime: '2023-06-12T13:25:51+00:00',
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
  const realJava = (() => {
    try {
      return require('node:child_process').execSync('command -v java', { encoding: 'utf8' }).trim();
    } catch {
      return '';
    }
  })();
  const fakeJava = add(
    '/java/bin/java',
    `#!/bin/sh\nif [ "$1" = "-cp" ] && [ -n "${realJava}" ]; then exec "${realJava}" "$@"; fi\necho "FAKEJAVA $@"\n`,
  );
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

  return { files, modJar, add, realJava };
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

module.exports = { buildFixtures, startServer, sha1, sha512, osName };
