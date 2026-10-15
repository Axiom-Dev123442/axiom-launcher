'use strict';
/** Microsoft browser sign in against fake Microsoft, Xbox and Minecraft services. */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');
const http = require('node:http');
const crypto = require('node:crypto');

const endpoints = require('../src/core/endpoints');
const ms = require('../src/core/auth/microsoft');
const { AccountStore } = require('../src/core/accounts');
const { createPaths } = require('../src/core/paths');

test('browser sign in redeems the code with PKCE and stores the account', async (t) => {
  const seen = {};
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const send = (obj, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      const url = req.url.split('?')[0];
      if (url === '/ms/token') {
        seen.token = Object.fromEntries(new URLSearchParams(body));
        return send({ access_token: 'ms-access', refresh_token: 'ms-refresh' });
      }
      if (url === '/xbl') return send({ Token: 'xbl-token', DisplayClaims: { xui: [{ uhs: 'user-hash' }] } });
      if (url === '/xsts') return send({ Token: 'xsts-token' });
      if (url === '/mc/authentication/login_with_xbox') {
        seen.identity = JSON.parse(body).identityToken;
        return send({ access_token: 'mc-token', expires_in: 86400 });
      }
      if (url === '/mc/minecraft/profile') {
        return send({ id: 'abc123', name: 'Steve_Builds', skins: [{ state: 'ACTIVE', url: 'https://textures.minecraft.net/x', variant: 'SLIM' }], capes: [] });
      }
      send({ error: 'not found' }, 404);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const saved = { ...endpoints };
  t.after(() => Object.assign(endpoints, saved));
  Object.assign(endpoints, { msLogin: `${base}/ms`, xboxUser: `${base}/xbl`, xsts: `${base}/xsts`, mcServices: `${base}/mc` });

  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'obsidian-auth-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const accounts = new AccountStore(createPaths(root), { getClientId: () => 'client-1' });

  let opened;
  const list = await accounts.loginMicrosoftBrowser(async (url, redirect) => {
    opened = new URL(url);
    return `${redirect}?code=the-code&session_state=x`;
  });

  // The sign in page was asked for a PKCE code for our app and redirect.
  assert.equal(opened.pathname, '/ms/authorize');
  assert.equal(opened.searchParams.get('client_id'), 'client-1');
  assert.equal(opened.searchParams.get('response_type'), 'code');
  assert.equal(opened.searchParams.get('redirect_uri'), ms.REDIRECT_URI);
  assert.equal(opened.searchParams.get('code_challenge_method'), 'S256');

  // The code was redeemed with the verifier matching that challenge.
  assert.equal(seen.token.code, 'the-code');
  assert.equal(seen.token.grant_type, 'authorization_code');
  const challenge = crypto.createHash('sha256').update(seen.token.code_verifier).digest('base64url');
  assert.equal(challenge, opened.searchParams.get('code_challenge'));
  assert.equal(seen.identity, 'XBL3.0 x=user-hash;xsts-token');

  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Steve_Builds');
  assert.equal(list[0].type, 'microsoft');
  assert.equal(list[0].skin.variant, 'slim');
  const launch = await accounts.launchAccount();
  assert.equal(launch.accessToken, 'mc-token');
});

test('sign in page errors are explained', () => {
  assert.throws(() => ms.parseRedirect(`${ms.REDIRECT_URI}?error=access_denied`), /cancelled/);
  assert.throws(() => ms.parseRedirect(`${ms.REDIRECT_URI}?error=invalid_request&error_description=AADSTS70002%3A+x`), /Allow public client flows/);
  assert.equal(ms.parseRedirect(`${ms.REDIRECT_URI}?code=abc`), 'abc');
});
