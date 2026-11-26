// @ts-check
// SPDX-License-Identifier: MIT
//
// Dependency-free ZIP writer: table CRC-32, deflateRaw, central directory.

import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { deflateRawSync } from 'node:zlib';

/** @typedef {{name:string, data:Uint8Array, mtime?:Date}} ZipEntry  name uses forward slashes */

/** CRC-32 lookup table (IEEE 802.3, poly 0xEDB88320). */
export const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

/**
 * @param {Uint8Array} bytes
 * @returns {number} unsigned CRC-32
 */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const MAX_ENTRIES = 0xffff;
const MAX_SIZE = 0xffffffff;

/** @param {Date} d @returns {{time:number, date:number}} MS-DOS time and date (local time, 1980 minimum) */
function dosDateTime(d) {
  const year = Math.max(d.getFullYear(), 1980);
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** @param {string} name */
function assertSafeName(name) {
  if (!name || name.includes('\\') || name.startsWith('/') || name.split('/').includes('..')) {
    throw new Error(`Refusing to zip an unsafe entry name: ${JSON.stringify(name)}`);
  }
}

/**
 * Write a ZIP archive (atomic: temp file + rename). No ZIP64.
 * @param {string} out output file path
 * @param {ZipEntry[]} entries
 * @returns {void}
 */
export function writeZip(out, entries) {
  if (entries.length > MAX_ENTRIES) throw new Error(`Too many files for a ZIP without ZIP64: ${entries.length} (limit ${MAX_ENTRIES})`);
  /** @type {Buffer[]} */
  const chunks = [];
  /** @type {Buffer[]} */
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    assertSafeName(entry.name);
    const name = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.from(entry.data.buffer, entry.data.byteOffset, entry.data.byteLength);
    if (raw.length > MAX_SIZE) throw new Error(`File too large for a ZIP without ZIP64: ${entry.name}`);
    const deflated = raw.length ? deflateRawSync(raw, { level: 9 }) : raw;
    const stored = deflated.length >= raw.length;
    const payload = stored ? raw : deflated;
    const method = stored ? 0 : 8;
    const crc = crc32(raw);
    const { time, date } = dosDateTime(entry.mtime ?? new Date());

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE((3 << 8) | 20, 4); // made by: unix, 2.0
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(0x0800, 8);
    head.writeUInt16LE(method, 10);
    head.writeUInt16LE(time, 12);
    head.writeUInt16LE(date, 14);
    head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(payload.length, 20);
    head.writeUInt32LE(raw.length, 24);
    head.writeUInt16LE(name.length, 28);
    head.writeUInt32LE(((0o100644 << 16) >>> 0), 38);
    head.writeUInt32LE(offset, 42);
    central.push(head, name);

    chunks.push(local, name, payload);
    offset += local.length + name.length + payload.length;
    if (offset > MAX_SIZE) throw new Error('Archive too large for a ZIP without ZIP64 (4 GiB)');
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  chunks.push(centralBytes, end);

  mkdirSync(dirname(out), { recursive: true });
  const tmp = `${out}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, Buffer.concat(chunks));
    renameSync(tmp, out);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* tmp may not exist */ }
    throw err;
  }
}
