export interface ContentBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const FLAT_SD = 6;
const FLAT_DRIFT = 10;
const MIN_KEEP = 0.4;
const INSET = 2;

function stats(values: number[]) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  return { mean, sd };
}

function flatRun(count: number, line: (i: number) => number[]) {
  const first = stats(line(0));
  if (first.sd > FLAT_SD) return 0;
  const limit = Math.floor((count * (1 - MIN_KEEP)) / 2);
  let run = 0;
  while (run < limit) {
    const s = stats(line(run));
    if (s.sd > FLAT_SD || Math.abs(s.mean - first.mean) > FLAT_DRIFT) break;
    run++;
  }
  return run ? Math.min(run + INSET, limit) : 0;
}

export function detectContentBox(gray: Uint8Array, width: number, height: number): ContentBox {
  const px = (x: number, y: number) => gray[y * width + x];
  const column = (x: number) => Array.from({ length: height }, (_, y) => px(x, y));
  const row = (y: number) => Array.from({ length: width }, (_, x) => px(x, y));
  const left = flatRun(width, (i) => column(i));
  const right = flatRun(width, (i) => column(width - 1 - i));
  const top = flatRun(height, (i) => row(i));
  const bottom = flatRun(height, (i) => row(height - 1 - i));
  return { x: left, y: top, w: width - left - right, h: height - top - bottom };
}
