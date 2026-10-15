'use strict';
const path = require('node:path');
const fsp = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { isAllowed } = require('./rules');

/** Splits a user supplied argument string, honouring simple quotes. */
function splitArgs(str) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(str || ''))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function substitute(str, vars) {
  return str.replace(/\$\{([^}]+)\}/g, (whole, key) => (key in vars ? String(vars[key]) : whole));
}

function expandArgs(list, env, vars) {
  const out = [];
  for (const arg of list || []) {
    if (typeof arg === 'string') {
      out.push(substitute(arg, vars));
    } else if (arg && isAllowed(arg.rules, env)) {
      const values = Array.isArray(arg.value) ? arg.value : [arg.value];
      for (const v of values) out.push(substitute(v, vars));
    }
  }
  return out;
}

/**
 * Builds the full java argument list (everything after the java executable).
 * account: { name, uuid, accessToken, type: 'microsoft' | 'offline', xuid }
 */
function buildLaunchArgs({ version, install, account, instance, gameDir, env, launcherVersion = '1.0.0' }) {
  const sep = process.platform === 'win32' ? ';' : ':';
  const res = instance.resolution || {};
  const hasResolution = Boolean(res.width && res.height);
  const argEnv = { ...env, features: { ...env.features, has_custom_resolution: hasResolution } };

  const vars = {
    auth_player_name: account.name,
    version_name: version.id,
    game_directory: gameDir,
    assets_root: install.assetsRoot,
    game_assets: install.gameAssets,
    assets_index_name: install.assetIndex,
    auth_uuid: account.uuid,
    auth_access_token: account.accessToken,
    auth_session: `token:${account.accessToken}:${account.uuid}`,
    auth_xuid: account.xuid || '0',
    clientid: account.clientId || '',
    user_type: account.type === 'microsoft' ? 'msa' : 'legacy',
    user_properties: '{}',
    version_type: 'Obsidian',
    natives_directory: install.nativesDir,
    launcher_name: 'Obsidian',
    launcher_version: launcherVersion,
    classpath: install.classpath.join(sep),
    classpath_separator: sep,
    library_directory: install.librariesDir,
    resolution_width: res.width || 854,
    resolution_height: res.height || 480,
  };

  const mem = instance.memory || {};
  const jvm = [];
  if (mem.min) jvm.push(`-Xms${mem.min}M`);
  if (mem.max) jvm.push(`-Xmx${mem.max}M`);
  jvm.push(...splitArgs(instance.jvmArgs));

  if (version.arguments && version.arguments.jvm) {
    jvm.push(...expandArgs(version.arguments.jvm, argEnv, vars));
  } else {
    if (process.platform === 'win32') {
      jvm.push('-XX:HeapDumpPath=MojangTricksIntelDriversForPerformance_javaw.exe_minecraft.exe.heapdump');
    }
    jvm.push(`-Djava.library.path=${install.nativesDir}`, '-cp', vars.classpath);
  }
  if (install.loggingArg) jvm.push(install.loggingArg);

  let game;
  if (version.arguments && version.arguments.game) {
    game = expandArgs(version.arguments.game, argEnv, vars);
  } else {
    game = splitArgs(version.minecraftArguments).map((a) => substitute(a, vars));
    if (hasResolution) game.push('--width', String(res.width), '--height', String(res.height));
  }
  if (instance.fullscreen && !game.includes('--fullscreen')) game.push('--fullscreen');
  if (instance.joinServer) {
    const [host, port] = String(instance.joinServer).split(':');
    game.push('--server', host, '--port', port || '25565');
  }

  return [...jvm, version.mainClass, ...game];
}

/** Hides tokens before a command line is shown in the console. */
function redactArgs(args, account) {
  return args.map((a) => (account.accessToken && a.includes(account.accessToken) ? a.split(account.accessToken).join('********') : a));
}

function quoteArgFile(arg) {
  return `"${arg.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Starts the game. Windows limits command lines to about 32k characters, so
 * long command lines go through a Java @argfile (Java 9 and newer only).
 */
async function spawnGame({ javaPath, args, cwd, javaMajor, tempDir, env = {} }) {
  let finalArgs = args;
  const length = args.reduce((n, a) => n + a.length + 3, javaPath.length);
  if (length > 30000 && javaMajor >= 9) {
    await fsp.mkdir(tempDir, { recursive: true });
    const file = path.join(tempDir, `launch-${Date.now()}.args`);
    await fsp.writeFile(file, args.map(quoteArgFile).join('\n'));
    finalArgs = [`@${file}`];
  }
  await fsp.mkdir(cwd, { recursive: true });
  return spawn(javaPath, finalArgs, {
    cwd,
    env: { ...process.env, ...env },
    windowsHide: false,
    detached: false,
  });
}

module.exports = { buildLaunchArgs, spawnGame, splitArgs, substitute, expandArgs, redactArgs, quoteArgFile };
