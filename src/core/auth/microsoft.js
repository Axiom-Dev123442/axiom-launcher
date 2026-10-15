'use strict';
const endpoints = require('../endpoints');
const { request, postJson, getJson, HttpError, sleep } = require('../http');

const crypto = require('node:crypto');

const SCOPE = 'XboxLive.signin offline_access';
/** The redirect registered for the app in Azure (Public client/native). */
const REDIRECT_URI = 'https://login.microsoftonline.com/common/oauth2/nativeclient';

const base64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * Starts a browser sign in (authorization code flow with PKCE). Returns the
 * page to open and the verifier needed to redeem the code afterwards.
 */
function browserLogin(clientId) {
  if (!clientId) throw new Error('No Microsoft app ID is set. Add one in Settings → Accounts.');
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return { url: `${endpoints.msLogin}/authorize?${params}`, verifier, redirectUri: REDIRECT_URI };
}

/** Reads the result of the sign in page from the URL it redirected to. */
function parseRedirect(url) {
  const u = new URL(url);
  const params = u.searchParams;
  if (params.get('error')) {
    if (params.get('error') === 'access_denied') throw Object.assign(new Error('Sign in was cancelled.'), { cancelled: true });
    throw azureError({ error: params.get('error'), error_description: params.get('error_description') });
  }
  const code = params.get('code');
  if (!code) throw new Error('Microsoft did not return a sign in code.');
  return code;
}

async function redeemCode(clientId, code, verifier) {
  const r = await postForm(`${endpoints.msLogin}/token`, {
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
    scope: SCOPE,
  });
  if (!r.access_token) throw azureError(r);
  return r;
}

async function postForm(url, form, signal) {
  try {
    const res = await request(url, {
      method: 'POST',
      retries: 0,
      signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    });
    return await res.json();
  } catch (err) {
    if (err instanceof HttpError && err.body) {
      try {
        return { ...JSON.parse(err.body), httpStatus: err.status };
      } catch {}
    }
    throw err;
  }
}

/** Starts a device code login. The person enters userCode at verificationUri. */
/** Turns Azure's error codes into something a person can act on. */
function azureError(r) {
  const text = r.error_description || r.error || 'Microsoft sign in failed';
  if (/AADSTS70002/.test(text)) {
    return new Error('Microsoft login is not switched on for this app yet. In Azure, open the app’s Authentication page and set "Allow public client flows" to Yes.');
  }
  if (/AADSTS700016/.test(text)) {
    return new Error('Microsoft doesn’t recognise this app ID. Check the Microsoft app ID in Settings → Accounts.');
  }
  return new Error(text.split(/\r?\n/)[0]);
}

async function startDeviceCode(clientId) {
  if (!clientId) throw new Error('No Microsoft app ID is set. Add one in Settings → Accounts.');
  const r = await postForm(`${endpoints.msLogin}/devicecode`, { client_id: clientId, scope: SCOPE });
  if (r.error) throw azureError(r);
  return {
    userCode: r.user_code,
    deviceCode: r.device_code,
    verificationUri: r.verification_uri,
    interval: r.interval || 5,
    expiresIn: r.expires_in || 900,
  };
}

/** Polls until the person finishes signing in. Returns Microsoft OAuth tokens. */
async function pollDeviceCode(clientId, { deviceCode, interval, expiresIn }, signal) {
  const deadline = Date.now() + expiresIn * 1000;
  let wait = interval;
  while (Date.now() < deadline) {
    await sleep(wait * 1000, signal);
    const r = await postForm(
      `${endpoints.msLogin}/token`,
      { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: clientId, device_code: deviceCode },
      signal,
    );
    if (r.access_token) return r;
    if (r.error === 'authorization_pending') continue;
    if (r.error === 'slow_down') {
      wait += 5;
      continue;
    }
    if (r.error === 'authorization_declined') throw new Error('Sign in was cancelled.');
    if (r.error === 'expired_token') break;
    throw azureError(r);
  }
  throw new Error('The sign in code expired. Please try again.');
}

async function refreshMicrosoft(clientId, refreshToken) {
  const r = await postForm(`${endpoints.msLogin}/token`, {
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: refreshToken,
    scope: SCOPE,
  });
  if (!r.access_token) {
    const err = new Error('Your Microsoft login expired. Please sign in again.');
    err.code = 'RELOGIN';
    throw err;
  }
  return r;
}

const XERR = {
  2148916233: 'This Microsoft account has no Xbox profile. Sign in once at minecraft.net to create one.',
  2148916235: 'Xbox Live is not available in your country.',
  2148916236: 'This account needs adult verification on the Xbox website.',
  2148916237: 'This account needs adult verification on the Xbox website.',
  2148916238: 'This is a child account. An adult must add it to a Microsoft family first.',
};

/** Trades a Microsoft access token for a Minecraft token and profile. */
async function minecraftLogin(msAccessToken) {
  const xbl = await postJson(endpoints.xboxUser, {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccessToken}` },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT',
  });
  const uhs = xbl.DisplayClaims.xui[0].uhs;

  let xsts;
  try {
    xsts = await postJson(endpoints.xsts, {
      Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT',
    });
  } catch (err) {
    let code;
    if (err instanceof HttpError && err.body) {
      try {
        code = JSON.parse(err.body).XErr;
      } catch {}
    }
    if (code && XERR[code]) throw new Error(XERR[code]);
    throw err;
  }

  let mc;
  try {
    mc = await postJson(`${endpoints.mcServices}/authentication/login_with_xbox`, {
      identityToken: `XBL3.0 x=${uhs};${xsts.Token}`,
    });
  } catch (err) {
    if (err instanceof HttpError && err.status === 403) {
      throw Object.assign(
        new Error('Minecraft refused this app. The Microsoft app ID needs Mojang approval (see Settings → Accounts → Help).'),
        { code: 'APP_NOT_APPROVED' },
      );
    }
    throw err;
  }

  const profile = await getProfile(mc.access_token);
  return {
    accessToken: mc.access_token,
    expiresAt: Date.now() + (mc.expires_in || 86400) * 1000,
    profile,
  };
}

async function getProfile(mcToken) {
  try {
    return await getJson(`${endpoints.mcServices}/minecraft/profile`, {
      retries: 1,
      headers: { Authorization: `Bearer ${mcToken}` },
    });
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      throw new Error("This Microsoft account doesn't own Minecraft Java Edition.");
    }
    throw err;
  }
}

module.exports = {
  startDeviceCode,
  pollDeviceCode,
  refreshMicrosoft,
  minecraftLogin,
  getProfile,
  browserLogin,
  parseRedirect,
  redeemCode,
  REDIRECT_URI,
};
