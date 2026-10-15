'use strict';
const crypto = require('node:crypto');

/** The same UUID a vanilla server in offline mode assigns to this name. */
function offlineUuid(name) {
  const hash = crypto.createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest();
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  return hash.toString('hex');
}

function validOfflineName(name) {
  return /^[A-Za-z0-9_]{3,16}$/.test(name);
}

module.exports = { offlineUuid, validOfflineName };
