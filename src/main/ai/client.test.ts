import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { listModels, probeChat, streamChat } from "./client.ts";
import type { AiProvider } from "../../shared/ai.ts";

const provider = (port: number): AiProvider => ({ id: "t", name: "t", baseUrl: "http://127.0.0.1:" + port + "/v1", apiKey: "k", model: "m" });

function serve(handler: http.RequestListener) {
  const server = http.createServer(handler);
  return new Promise<{ port: number; close: () => Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({ port, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

test("streams chunks in order and calls onDelta per chunk", async () => {
  let seenAuth = "";
  let seenBody = "";
  const s = await serve((req, res) => {
    seenAuth = String(req.headers.authorization || "");
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      seenBody = raw;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"choices":[{"delta":{"content":"发票"}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":"打印"}}]}\n\n');
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });
  const deltas: string[] = [];
  const r = await streamChat(provider(s.port), [{ role: "user", content: "hi" }], { onDelta: (d) => deltas.push(d) });
  await s.close();
  assert.equal(r.ok, true);
  assert.equal(r.text, "发票打印");
  assert.deepEqual(deltas, ["发票", "打印"]);
  assert.equal(seenAuth, "Bearer k");
  assert.equal(JSON.parse(seenBody).stream, true);
});

test("non-200 responses surface status and body", async () => {
  const s = await serve((_req, res) => {
    res.writeHead(401, { "content-type": "application/json" });
    res.end('{"error":{"message":"invalid key"}}');
  });
  const r = await streamChat(provider(s.port), [{ role: "user", content: "hi" }]);
  await s.close();
  assert.equal(r.ok, false);
  assert.match(String(r.error), /401/);
  assert.match(String(r.error), /Key 不对/);
});

test("plain json responses are accepted as a single delta", async () => {
  const s = await serve((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: "```\n成品\n```" } }] }));
  });
  const r = await streamChat(provider(s.port), [{ role: "user", content: "hi" }]);
  await s.close();
  assert.equal(r.ok, true);
  assert.equal(r.text, "成品");
});

test("abort signal cancels the request", async () => {
  const s = await serve((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write('data: {"choices":[{"delta":{"content":"慢"}}]}\n\n');
  });
  const controller = new AbortController();
  const pending = streamChat(provider(s.port), [{ role: "user", content: "hi" }], { signal: controller.signal });
  setTimeout(() => controller.abort(), 120);
  const r = await pending;
  await s.close();
  assert.equal(r.ok, false);
  assert.equal(r.aborted, true);
});

test("empty stream reports a friendly error", async () => {
  const s = await serve((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end("data: [DONE]\n\n");
  });
  const r = await streamChat(provider(s.port), [{ role: "user", content: "hi" }]);
  await s.close();
  assert.equal(r.ok, false);
  assert.match(String(r.error), /没有输出内容/);
});

/* ------------------------------------------------------------------ *
 * 地址填错 / 模型名填错时的表现（中转站接入失败的两个真实原因）
 * ------------------------------------------------------------------ */

/** 只填域名时先试 /chat/completions，会把前端页面当 200 返回；补 /v1 才通 */
test("地址少了 /v1 时自动补上去，并把正确的 base 带回来", async () => {
  const hits: string[] = [];
  const s = await serve((req, res) => {
    hits.push(String(req.url));
    if (req.url === "/chat/completions") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<!doctype html><html><title>New API</title></html>");
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write('data: {"choices":[{"delta":{"content":"可用"}}]}\n\n');
    res.end("data: [DONE]\n\n");
  });
  const p: AiProvider = { id: "t", name: "t", baseUrl: "http://127.0.0.1:" + s.port + "/", apiKey: "k", model: "m" };
  const r = await streamChat(p, [{ role: "user", content: "hi" }]);
  await s.close();
  assert.equal(r.ok, true);
  assert.equal(r.text, "可用");
  assert.deepEqual(hits, ["/chat/completions", "/v1/chat/completions"]);
  assert.equal(r.baseUrl, "http://127.0.0.1:" + s.port + "/v1");
});

test("只会返回网页的地址，错误信息说清是地址少了 /v1", async () => {
  const s = await serve((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><html><body>welcome</body></html>");
  });
  const p: AiProvider = { id: "t", name: "t", baseUrl: "http://127.0.0.1:" + s.port, apiKey: "k", model: "m" };
  const r = await streamChat(p, [{ role: "user", content: "hi" }]);
  await s.close();
  assert.equal(r.ok, false);
  assert.match(String(r.error), /网页/);
  assert.match(String(r.error), /\/v1/);
});

test("模型名不存在时提示去列表里选，不再甩一串英文", async () => {
  const s = await serve((_req, res) => {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: { code: "model_not_found", message: "No available channel for model aws0 0.26 4.8 under group aws0" },
      }),
    );
  });
  const p: AiProvider = { id: "t", name: "t", baseUrl: "http://127.0.0.1:" + s.port + "/v1", apiKey: "k", model: "aws0 0.26 4.8" };
  const r = await streamChat(p, [{ role: "user", content: "hi" }]);
  await s.close();
  assert.equal(r.ok, false);
  assert.match(String(r.error), /模型名不对/);
  assert.match(String(r.error), /获取列表/);
});

test("保存前探测能区分「通了」和「模型名不对」", async () => {
  const s = await serve((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const model = JSON.parse(raw).model;
      if (model !== "good") {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "model not found" } }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "可用" } }] }));
    });
  });
  const good: AiProvider = { id: "t", name: "t", baseUrl: "http://127.0.0.1:" + s.port + "/v1", apiKey: "k", model: "good" };
  const bad: AiProvider = { ...good, model: "aws0 0.26 4.8" };
  const ok = await probeChat(good, 5000);
  const no = await probeChat(bad, 5000);
  await s.close();
  assert.equal(ok.ok, true);
  assert.equal(ok.sample, "可用");
  assert.equal(ok.baseUrl, "http://127.0.0.1:" + s.port + "/v1");
  assert.equal(no.ok, false);
  assert.match(String(no.error), /模型名不对/);
});

test("模型列表能读 data[].id，地址少了 /v1 也能补", async () => {
  const s = await serve((req, res) => {
    if (req.url !== "/v1/models") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<!doctype html><html></html>");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "claude-sonnet-4-6" }, { id: "claude-opus-4-5" }] }));
  });
  const p: AiProvider = { id: "t", name: "t", baseUrl: "http://127.0.0.1:" + s.port + "/", apiKey: "k", model: "-" };
  const r = await listModels(p, 5000);
  await s.close();
  assert.equal(r.ok, true);
  assert.deepEqual(r.models, ["claude-opus-4-5", "claude-sonnet-4-6"]);
});
