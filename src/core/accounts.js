'use strict';
const crypto = require('node:crypto');
const { readJson, writeJson } = require('./util');
const ms = require('./auth/microsoft');
const { offlineUuid, validOfflineName } = require('./auth/offline');

/**
 * Stores accounts. Tokens live in an encrypted "secret" blob per account;
 * encrypt/decrypt are supplied by the app (Windows DPAPI via Electron safeStorage).
 */
class AccountStore {
  constructor(paths, { encrypt = (s) => Buffer.from(s).toString('base64'), decrypt = (s) => Buffer.from(s, 'base64').toString(), getClientId = () => '' } = {}) {
    this.file = paths.accountsFile;
    this.encrypt = encrypt;
    this.decrypt = decrypt;
    this.getClientId = getClientId;
    this.data = null;
    this.refreshing = new Map();
  }

  async load() {
    // Callers that arrive while the file is being read share that read, so they all change one object.
    if (!this.data) {
      if (!this._loading) {
        this._loading = readJson(this.file, { active: null, accounts: [] }).then((d) => {
          this.data = d;
        });
      }
      await this._loading;
    }
    return this.data;
  }

  async save() {
    await writeJson(this.file, this.data);
  }

  _secret(acc) {
    if (!acc.secret) return {};
    try {
      return JSON.parse(this.decrypt(acc.secret));
    } catch {
      return {};
    }
  }

  _setSecret(acc, secret) {
    acc.secret = this.encrypt(JSON.stringify(secret));
  }

  /** Accounts without any tokens, safe to send to the interface. */
  async list() {
    const d = await this.load();
    return d.accounts.map((a) => ({
      id: a.id,
      type: a.type,
      name: a.name,
      uuid: a.uuid,
      skin: a.skin || null,
      capes: a.capes || [],
      active: a.id === d.active,
      needsLogin: Boolean(a.needsLogin),
    }));
  }

  async active() {
    const d = await this.load();
    return d.accounts.find((a) => a.id === d.active) || d.accounts[0] || null;
  }

  async setActive(id) {
    const d = await this.load();
    if (d.accounts.some((a) => a.id === id)) d.active = id;
    await this.save();
  }

  async remove(id) {
    const d = await this.load();
    d.accounts = d.accounts.filter((a) => a.id !== id);
    if (d.active === id) d.active = d.accounts[0] ? d.accounts[0].id : null;
    await this.save();
  }

  async addOffline(name) {
    name = String(name || '').trim();
    if (!validOfflineName(name)) throw new Error('Use 3 to 16 letters, numbers or underscores.');
    const d = await this.load();
    const uuid = offlineUuid(name);
    const existing = d.accounts.find((a) => a.type === 'offline' && a.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      d.active = existing.id;
    } else {
      const acc = { id: crypto.randomUUID(), type: 'offline', name, uuid, addedAt: Date.now() };
      d.accounts.push(acc);
      d.active = acc.id;
    }
    await this.save();
    return this.list();
  }

  /**
   * Runs the Microsoft device code flow. onCode({ userCode, verificationUri })
   * is called as soon as there is a code to show.
   */
  async loginMicrosoft(onCode, signal) {
    const clientId = this.getClientId();
    const code = await ms.startDeviceCode(clientId);
    onCode({ userCode: code.userCode, verificationUri: code.verificationUri, expiresIn: code.expiresIn });
    const tokens = await ms.pollDeviceCode(clientId, code, signal);
    const mc = await ms.minecraftLogin(tokens.access_token);
    return this._storeMicrosoft(tokens.refresh_token, mc);
  }

  /**
   * Browser sign in: openPage(url, redirectUri) shows Microsoft's page and
   * resolves with the URL it redirects to once the person accepts.
   */
  async loginMicrosoftBrowser(openPage) {
    const clientId = this.getClientId();
    const start = ms.browserLogin(clientId);
    const redirected = await openPage(start.url, start.redirectUri);
    const code = ms.parseRedirect(redirected);
    const tokens = await ms.redeemCode(clientId, code, start.verifier);
    const mc = await ms.minecraftLogin(tokens.access_token);
    return this._storeMicrosoft(tokens.refresh_token, mc);
  }

  async _storeMicrosoft(refreshToken, mc) {
    const d = await this.load();
    let acc = d.accounts.find((a) => a.type === 'microsoft' && a.uuid === mc.profile.id);
    if (!acc) {
      acc = { id: crypto.randomUUID(), type: 'microsoft', addedAt: Date.now() };
      d.accounts.push(acc);
    }
    this._applyProfile(acc, mc.profile);
    acc.needsLogin = false;
    acc.expiresAt = mc.expiresAt;
    this._setSecret(acc, { refreshToken, mcToken: mc.accessToken });
    d.active = acc.id;
    await this.save();
    return this.list();
  }

  _applyProfile(acc, profile) {
    acc.uuid = profile.id;
    acc.name = profile.name;
    const skin = (profile.skins || []).find((s) => s.state === 'ACTIVE');
    acc.skin = skin ? { url: skin.url, variant: (skin.variant || 'CLASSIC').toLowerCase() } : null;
    acc.capes = (profile.capes || []).map((c) => ({ id: c.id, alias: c.alias, url: c.url, active: c.state === 'ACTIVE' }));
  }

  /**
   * A valid Minecraft token for a Microsoft account, refreshing it when close to
   * expiry. Calls for the same account share one refresh, because Microsoft
   * refresh tokens are single use and a second refresh with the old one fails.
   */
  async minecraftToken(id) {
    if (this.refreshing.has(id)) return this.refreshing.get(id);
    const pending = this._minecraftToken(id);
    this.refreshing.set(id, pending);
    try {
      return await pending;
    } finally {
      this.refreshing.delete(id);
    }
  }

  async _minecraftToken(id) {
    const d = await this.load();
    const acc = d.accounts.find((a) => a.id === id);
    if (!acc || acc.type !== 'microsoft') throw new Error('This needs a Microsoft account.');
    const secret = this._secret(acc);
    if (secret.mcToken && acc.expiresAt && acc.expiresAt - Date.now() > 5 * 60 * 1000) return secret.mcToken;
    if (!secret.refreshToken) {
      acc.needsLogin = true;
      await this.save();
      throw Object.assign(new Error('Please sign in to this account again.'), { code: 'RELOGIN' });
    }
    try {
      const tokens = await ms.refreshMicrosoft(this.getClientId(), secret.refreshToken);
      const mc = await ms.minecraftLogin(tokens.access_token);
      this._applyProfile(acc, mc.profile);
      acc.expiresAt = mc.expiresAt;
      acc.needsLogin = false;
      this._setSecret(acc, { refreshToken: tokens.refresh_token || secret.refreshToken, mcToken: mc.accessToken });
      await this.save();
      return mc.accessToken;
    } catch (err) {
      if (err.code === 'RELOGIN') {
        acc.needsLogin = true;
        await this.save();
      }
      throw err;
    }
  }

  /** Re-reads name, skin and capes from Mojang. */
  async refreshProfile(id) {
    const token = await this.minecraftToken(id);
    const profile = await ms.getProfile(token);
    const d = await this.load();
    const acc = d.accounts.find((a) => a.id === id);
    if (!acc) return this.list();
    this._applyProfile(acc, profile);
    await this.save();
    return this.list();
  }

  /** Everything the game needs to start as this account. */
  async launchAccount(id) {
    const d = await this.load();
    const acc = id ? d.accounts.find((a) => a.id === id) : await this.active();
    if (!acc) throw new Error('Add an account before playing.');
    if (acc.type === 'offline') {
      return { type: 'offline', name: acc.name, uuid: acc.uuid, accessToken: '0' };
    }
    const accessToken = await this.minecraftToken(acc.id);
    return { type: 'microsoft', name: acc.name, uuid: acc.uuid, accessToken, clientId: this.getClientId() };
  }
}

module.exports = { AccountStore };
