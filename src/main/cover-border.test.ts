import assert from "node:assert/strict";
import test from "node:test";
import { detectContentBox } from "./cover-border.ts";

function frame(width: number, height: number, box: { x: number; y: number; w: number; h: number }, border = 30) {
  const gray = new Uint8Array(width * height).fill(border);
  for (let y = box.y; y < box.y + box.h; y++)
    for (let x = box.x; x < box.x + box.w; x++) gray[y * width + x] = (x * 37 + y * 91) % 256;
  return gray;
}

test("finds side bars around landscape content", () => {
  const gray = frame(160, 90, { x: 46, y: 0, w: 69, h: 90 });
  assert.deepEqual(detectContentBox(gray, 160, 90), { x: 48, y: 0, w: 65, h: 90 });
});

test("keeps full frame when there is no border", () => {
  const gray = frame(120, 160, { x: 0, y: 0, w: 120, h: 160 });
  assert.deepEqual(detectContentBox(gray, 120, 160), { x: 0, y: 0, w: 120, h: 160 });
});

test("never trims more than the allowed share of a flat image", () => {
  const gray = new Uint8Array(100 * 100).fill(200);
  const box = detectContentBox(gray, 100, 100);
  assert.ok(box.w >= 40 && box.h >= 40);
});
