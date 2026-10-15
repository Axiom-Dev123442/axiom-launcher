'use strict';
const os = require('node:os');

function currentEnv(features = {}) {
  const osName = { win32: 'windows', darwin: 'osx', linux: 'linux' }[process.platform] || process.platform;
  const arch = process.arch === 'ia32' ? 'x86' : process.arch === 'arm64' ? 'arm64' : 'x86_64';
  return { os: osName, arch, version: os.release(), features };
}

function ruleMatches(rule, env) {
  if (rule.os) {
    if (rule.os.name && rule.os.name !== env.os) return false;
    if (rule.os.arch && rule.os.arch !== env.arch) return false;
    if (rule.os.version) {
      try {
        if (!new RegExp(rule.os.version).test(env.version)) return false;
      } catch {
        return false;
      }
    }
  }
  if (rule.features) {
    for (const [key, value] of Object.entries(rule.features)) {
      if (Boolean(env.features[key]) !== value) return false;
    }
  }
  return true;
}

/** Evaluates a Mojang rules array. No rules means allowed. The last matching rule wins. */
function isAllowed(rules, env) {
  if (!rules || !rules.length) return true;
  let allowed = false;
  for (const rule of rules) {
    if (ruleMatches(rule, env)) allowed = rule.action === 'allow';
  }
  return allowed;
}

module.exports = { currentEnv, isAllowed, ruleMatches };
