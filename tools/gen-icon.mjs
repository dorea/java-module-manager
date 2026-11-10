// 生成扩展图标 media/icon.png（128×128 RGBA PNG，纯 node:zlib，无第三方依赖）
// 设计：圆角方块背景 #7A8FA3，三根白色竖条代表模块，最右侧一根变暗并被斜线划掉（= 关闭的模块）
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const W = 128, H = 128;
const BG = [0x7a, 0x8f, 0xa3, 255];       // 品牌色 #7A8FA3
const BAR = [0xff, 0xff, 0xff, 255];      // 启用模块：白
const BAR_OFF = [0x9f, 0xb0, 0xbf, 255];  // 关闭模块：暗一档
const SLASH = [0x2c, 0x3e, 0x50, 255];    // 斜线：深色
const R = 26;                              // 圆角半径

// 三根竖条：x 范围 + 颜色
const bars = [
  { x0: 22, x1: 48, on: true },
  { x0: 53, x1: 79, on: true },
  { x0: 84, x1: 110, on: false },
];
const BAR_Y0 = 28, BAR_Y1 = 100;

// 斜线段（穿过第三根条）：(x0,y0)-(x1,y1)，线宽 w
const seg = { x0: 88, y0: 30, x1: 108, y1: 98 };
const SLASH_W = 9;

function distToSeg(px, py, s) {
  const dx = s.x1 - s.x0, dy = s.y1 - s.y0;
  const t = Math.max(0, Math.min(1, ((px - s.x0) * dx + (py - s.y0) * dy) / (dx * dx + dy * dy)));
  const cx = s.x0 + t * dx, cy = s.y0 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function inRounded(x, y) {
  if (x >= R && x < W - R) return true;
  if (y >= R && y < H - R) return true;
  const cx = Math.min(Math.max(x, R), W - 1 - R);
  const cy = Math.min(Math.max(y, R), H - 1 - R);
  return Math.hypot(x - cx, y - cy) <= R;
}

const px = new Uint8Array(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    let c = [0, 0, 0, 0];
    if (inRounded(x, y)) {
      c = BG;
      for (const b of bars) {
        if (x >= b.x0 && x <= b.x1 && y >= BAR_Y0 && y <= BAR_Y1) {
          c = b.on ? BAR : BAR_OFF;
        }
      }
      if (!bars[2].on && distToSeg(x, y, seg) < SLASH_W / 2) {
        c = SLASH;
      }
    }
    const i = (y * W + x) * 4;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = c[3];
  }
}

// --- PNG 编码 ---
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
// 每行前加 filter byte 0
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0;
  Buffer.from(px.buffer, y * W * 4, W * 4).copy(raw, y * (W * 4 + 1) + 1);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
mkdirSync('media', { recursive: true });
writeFileSync('media/icon.png', png);
console.log('media/icon.png 已生成:', png.length, 'bytes,', W + 'x' + H);
