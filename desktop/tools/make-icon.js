/* Tom icon — flat letterpress style: warm paper, ink mask-bubble, vermilion seal.
   No gradients, no glow, no geometric letter mark. Pure Node, no dependencies. */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    let c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
const PAPER = [242, 234, 216];
const INK = [35, 48, 47];
const SEAL = [193, 87, 63];

function inRound(u, v, x0, y0, x1, y1, r) {
  if (u < x0 || u > x1 || v < y0 || v > y1) return false;
  const cx = Math.min(Math.max(u, x0 + r), x1 - r);
  const cy = Math.min(Math.max(v, y0 + r), y1 - r);
  const dx = u - cx, dy = v - cy;
  return dx * dx + dy * dy <= r * r;
}
function inTri(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  return !(((d1 < 0) || (d2 < 0) || (d3 < 0)) && ((d1 > 0) || (d2 > 0) || (d3 > 0)));
}
function grain(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1274126177 | 0;
  return ((h ^ (h >> 16)) & 7) - 3;
}
function ellipse(u, v, cx, cy, rx, ry) {
  const dx = (u - cx) / rx, dy = (v - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

function png(size) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  const small = size <= 32;
  const t = small ? 0 : 1.4 / size;
  for (let y = 0; y < size; y++) {
    const row = y * stride;
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const i = row + 1 + x * 4;
      const u = (x + 0.5) / size, v = (y + 0.5) / size;
      const bg = inRound(u, v, 0.02, 0.02, 0.98, 0.98, 0.10);
      if (!bg) { raw[i + 3] = 0; continue; }
      let col = PAPER.slice();
      if (!small) {
        const g = grain(x, y);
        col = col.map(c => Math.max(0, Math.min(255, c + g)));
        const outer = inRound(u, v, 0.075, 0.075, 0.925, 0.925, 0.055);
        const inner = inRound(u, v, 0.075 + t, 0.075 + t, 0.925 - t, 0.925 - t, 0.055 - t);
        if (outer && !inner) col = INK.slice();
      }
      const bubble = inRound(u, v, 0.20, 0.245, 0.80, 0.675, 0.085) ||
                     inTri(u, v, 0.275, 0.635, 0.235, 0.795, 0.415, 0.675);
      if (bubble) col = INK.slice();
      const erx = small ? 0.088 : 0.075, ery = small ? 0.062 : 0.052;
      const eye = ellipse(u, v, 0.385, 0.435, erx, ery) || ellipse(u, v, 0.615, 0.435, erx, ery);
      if (bubble && eye) col = PAPER.slice();
      // subtle smile arc, lower half of a circle
      const rr = Math.sqrt((u - 0.5) * (u - 0.5) + (v - 0.395) * (v - 0.395));
      if (bubble && !eye && v > 0.505 && v < 0.595 && Math.abs(rr - 0.145) < (small ? 0.020 : 0.013)) col = PAPER.slice();
      if (!small) {
        const dx = u - 0.815, dy = v - 0.185;
        if (dx * dx + dy * dy < 0.0016) col = SEAL.slice();
      }
      raw[i] = col[0]; raw[i + 1] = col[1]; raw[i + 2] = col[2]; raw[i + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const sizes = [16, 32, 48, 64, 128, 256];
const images = sizes.map(png);
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = 6 + 16 * images.length;
const entries = images.map((img, idx) => {
  const e = Buffer.alloc(16);
  e[0] = sizes[idx] === 256 ? 0 : sizes[idx];
  e[1] = sizes[idx] === 256 ? 0 : sizes[idx];
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(img.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += img.length;
  return e;
});
const buildDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(buildDir, { recursive: true });
fs.writeFileSync(path.join(buildDir, 'icon.ico'), Buffer.concat([header].concat(entries, images)));
fs.writeFileSync(path.join(buildDir, 'icon-preview.png'), images[images.length - 1]);
fs.writeFileSync(path.join(__dirname, '..', '..', 'icon.png'), images[images.length - 1]);
console.log('icon.ico / icon-preview.png / icon.png written');
