// Zips extension/ (excluding extension/test) into public/hangup-extension.zip.
// Pure Node, store-only (no compression), deterministic output.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SRC = path.join(__dirname, '..', 'extension');
const OUT = path.join(__dirname, '..', 'public', 'hangup-extension.zip');
const ROOT = 'hangup-extension';

function walk(dir, rel) {
  let out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const r = rel ? rel + '/' + name : name;
    if (r === 'test' || name === '.DS_Store') continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) out = out.concat(walk(full, r));
    else out.push({ rel: r, data: fs.readFileSync(full) });
  }
  return out;
}

function buildZip(files) {
  const DOS_TIME = 0, DOS_DATE = (46 << 9) | (1 << 5) | 1; // fixed 2026-01-01 for reproducible output
  const locals = [], centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(ROOT + '/' + f.rel, 'utf8');
    const crc = zlib.crc32 ? zlib.crc32(f.data) : crc32(f.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(DOS_TIME, 10); lh.writeUInt16LE(DOS_DATE, 12); lh.writeUInt32LE(crc >>> 0, 14);
    lh.writeUInt32LE(f.data.length, 18); lh.writeUInt32LE(f.data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(DOS_TIME, 12); ch.writeUInt16LE(DOS_DATE, 14); ch.writeUInt32LE(crc >>> 0, 16);
    ch.writeUInt32LE(f.data.length, 20); ch.writeUInt32LE(f.data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(0o100644 << 16 >>> 0, 38); ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, f.data); centrals.push(ch, name);
    offset += 30 + name.length + f.data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

let table;
function crc32(buf) {
  if (!table) { table = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; } }
  let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const files = walk(SRC, '');
fs.writeFileSync(OUT, buildZip(files));
console.log(`wrote ${path.relative(process.cwd(), OUT)} (${files.length} files)`);
