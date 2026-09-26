// Emulator screenshot (PNG) → the 22×48 pixel grid the phone view draws as ▀ half-blocks.
import { PNG } from 'pngjs';
import { PHONE_H, PHONE_W } from '../demo/phone.ts';

const hex = (n: number) => n.toString(16).padStart(2, '0');

/** Averages each block of source pixels, so thin UI lines still show up. */
export function downsample(png: { width: number; height: number; data: Uint8Array | Buffer }, w = PHONE_W, h = PHONE_H): { w: number; h: number; px: string[] } {
  const px: string[] = [];
  for (let gy = 0; gy < h; gy++) {
    const y0 = Math.floor((gy * png.height) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * png.height) / h));
    for (let gx = 0; gx < w; gx++) {
      const x0 = Math.floor((gx * png.width) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * png.width) / w));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      // Sample a sparse lattice; full averaging of a 1080×2400 frame is needless work per second.
      const sy = Math.max(1, Math.floor((y1 - y0) / 6));
      const sx = Math.max(1, Math.floor((x1 - x0) / 6));
      for (let y = y0; y < y1; y += sy) {
        for (let x = x0; x < x1; x += sx) {
          const i = (y * png.width + x) * 4;
          r += png.data[i] ?? 0;
          g += png.data[i + 1] ?? 0;
          b += png.data[i + 2] ?? 0;
          n++;
        }
      }
      px.push(`#${hex(Math.round(r / n))}${hex(Math.round(g / n))}${hex(Math.round(b / n))}`);
    }
  }
  return { w, h, px };
}

export function decodeScreen(bytes: Uint8Array): { frame: { w: number; h: number; px: string[] }; width: number; height: number } {
  const png = PNG.sync.read(Buffer.from(bytes));
  return { frame: downsample(png), width: png.width, height: png.height };
}

/** Screen coordinates of a tap → the cell of the phone view (column, half-block row). */
export function tapCell(x: number, y: number, screenW: number, screenH: number): { col: number; row: number } {
  const col = Math.min(PHONE_W - 1, Math.max(0, Math.round((x / screenW) * PHONE_W)));
  const row = Math.min(PHONE_H / 2 - 1, Math.max(0, Math.floor(((y / screenH) * PHONE_H) / 2)));
  return { col, row };
}
