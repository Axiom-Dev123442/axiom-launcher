'use strict';
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const { safeJoin } = require('./util');

const MAX = 0xffffffff;

let CRC_TABLE;
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A minimal random-access zip reader (stored and deflate, zip64 aware). */
class ZipFile {
  static async open(file) {
    const fh = await fsp.open(file, 'r');
    try {
      const zip = new ZipFile(fh);
      await zip._readDirectory();
      return zip;
    } catch (err) {
      await fh.close();
      throw err;
    }
  }

  constructor(fh) {
    this.fh = fh;
    this.entries = [];
    this.byName = new Map();
  }

  async _read(pos, len) {
    const buf = Buffer.alloc(len);
    let off = 0;
    while (off < len) {
      const { bytesRead } = await this.fh.read(buf, off, len - off, pos + off);
      if (!bytesRead) break;
      off += bytesRead;
    }
    return buf.subarray(0, off);
  }

  async _readDirectory() {
    const { size } = await this.fh.stat();
    const tailLen = Math.min(size, 65557);
    const tail = await this._read(size - tailLen, tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd === -1) throw new Error('Not a zip file');
    let count = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);

    if (cdOffset === MAX || count === 0xffff) {
      const loc = eocd - 20;
      if (loc >= 0 && tail.readUInt32LE(loc) === 0x07064b50) {
        const z64Offset = Number(tail.readBigUInt64LE(loc + 8));
        const z64 = await this._read(z64Offset, 56);
        if (z64.readUInt32LE(0) !== 0x06064b50) throw new Error('Bad zip64 record');
        count = Number(z64.readBigUInt64LE(32));
        cdSize = Number(z64.readBigUInt64LE(40));
        cdOffset = Number(z64.readBigUInt64LE(48));
      }
    }

    const cd = await this._read(cdOffset, cdSize);
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt zip directory');
      const flags = cd.readUInt16LE(p + 8);
      const method = cd.readUInt16LE(p + 10);
      let compressedSize = cd.readUInt32LE(p + 20);
      let size = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      let offset = cd.readUInt32LE(p + 42);
      const rawName = cd.subarray(p + 46, p + 46 + nameLen);
      const name = (flags & 0x800 ? rawName.toString('utf8') : rawName.toString('latin1')).replace(/\\/g, '/');
      const extra = cd.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);
      let e = 0;
      while (e + 4 <= extra.length) {
        const id = extra.readUInt16LE(e);
        const len = extra.readUInt16LE(e + 2);
        if (id === 0x0001) {
          let q = e + 4;
          if (size === MAX) (size = Number(extra.readBigUInt64LE(q))), (q += 8);
          if (compressedSize === MAX) (compressedSize = Number(extra.readBigUInt64LE(q))), (q += 8);
          if (offset === MAX) offset = Number(extra.readBigUInt64LE(q));
        }
        e += 4 + len;
      }
      const entry = { name, method, compressedSize, size, offset, isDirectory: name.endsWith('/') };
      this.entries.push(entry);
      this.byName.set(name, entry);
      p += 46 + nameLen + extraLen + commentLen;
    }
  }

  has(name) {
    return this.byName.has(name);
  }

  async read(nameOrEntry) {
    const entry = typeof nameOrEntry === 'string' ? this.byName.get(nameOrEntry) : nameOrEntry;
    if (!entry) throw new Error(`Missing zip entry: ${nameOrEntry}`);
    const header = await this._read(entry.offset, 30);
    if (header.readUInt32LE(0) !== 0x04034b50) throw new Error('Corrupt zip entry');
    const dataStart = entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
    const raw = await this._read(dataStart, entry.compressedSize);
    if (entry.method === 0) return raw;
    if (entry.method === 8) return zlib.inflateRawSync(raw);
    throw new Error(`Unsupported zip compression method ${entry.method}`);
  }

  async readText(name) {
    return (await this.read(name)).toString('utf8');
  }

  async readJson(name) {
    return JSON.parse((await this.readText(name)).replace(/^﻿/, ''));
  }

  /**
   * Extracts entries under prefix into dest (prefix stripped). filter(name)
   * can skip entries. Returns the list of written relative paths.
   */
  async extractTo(dest, { prefix = '', filter, overwrite = true } = {}) {
    const written = [];
    for (const entry of this.entries) {
      if (entry.isDirectory || !entry.name.startsWith(prefix)) continue;
      const rel = entry.name.slice(prefix.length);
      if (!rel || (filter && !filter(entry.name))) continue;
      const target = safeJoin(dest, rel);
      if (!overwrite) {
        try {
          await fsp.access(target);
          continue;
        } catch {}
      }
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, await this.read(entry));
      written.push(rel);
    }
    return written;
  }

  async close() {
    await this.fh.close();
  }
}

async function withZip(file, fn) {
  const zip = await ZipFile.open(file);
  try {
    return await fn(zip);
  } finally {
    await zip.close();
  }
}

/** Builds a zip in memory from [{ name, data }]. Fine for small archives. */
function createZip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name.replace(/\\/g, '/'), 'utf8');
    const body = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const deflated = zlib.deflateRawSync(body);
    const useDeflate = deflated.length < body.length;
    const stored = useDeflate ? deflated : body;
    const crc = crc32(body);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, stored);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x800, 8);
    cd.writeUInt16LE(useDeflate ? 8 : 0, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(stored.length, 20);
    cd.writeUInt32LE(body.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += 30 + nameBuf.length + stored.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, end]);
}

module.exports = { ZipFile, withZip, createZip, crc32 };
