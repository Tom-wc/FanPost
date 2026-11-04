import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { isSealed, openWith, sealWith } from "./sealed.ts";
import { PersistentJsonStore } from "./persistent-store.ts";

const enc = (t: string) => Buffer.from([...Buffer.from(t, "utf8")].map((b) => b ^ 0x5a));
const dec = (b: Buffer) => Buffer.from([...b].map((x) => x ^ 0x5a)).toString("utf8");
const codec = { seal: (t: string) => sealWith(enc, t), open: (r: string) => openWith(dec, r), sealed: isSealed };

test("加密后看不到原文，解密还原；旧的明文照样能读", () => {
  const sealed = sealWith(enc, '{"title":"我的标题"}');
  assert.ok(isSealed(sealed));
  assert.ok(!sealed.includes("我的标题"));
  assert.equal(openWith(dec, sealed), '{"title":"我的标题"}');
  assert.equal(openWith(dec, '{"a":1}'), '{"a":1}');
  assert.equal(openWith(dec, "﻿{}"), "{}");
});

test("数据文件：旧明文读进来后改成加密保存，明文备份删掉", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fanpost-seal-"));
  const file = path.join(dir, "data.json");
  await fs.writeFile(file, JSON.stringify({ items: ["账号备注"] }), "utf8");
  await fs.writeFile(file + ".bak", JSON.stringify({ items: ["旧备注"] }), "utf8");
  const parse = (v: unknown) => v as { items: string[] };
  const store = new PersistentJsonStore({ directory: dir, fileName: "data.json", empty: { items: [] as string[] }, parse, codec });
  await store.load();
  const raw = await fs.readFile(file, "utf8");
  assert.ok(isSealed(raw) && !raw.includes("账号备注"));
  assert.equal(await fs.readFile(file + ".bak", "utf8").catch(() => "gone"), "gone");
  await store.update((d) => d.items.push("新"));
  assert.ok(isSealed(await fs.readFile(file + ".bak", "utf8")));
  const again = new PersistentJsonStore({ directory: dir, fileName: "data.json", empty: { items: [] as string[] }, parse, codec });
  await again.load();
  assert.deepEqual(again.get().items, ["账号备注", "新"]);
});
