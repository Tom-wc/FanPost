import assert from "node:assert/strict";
import test from "node:test";
import { activeProvider, aiErrorText, buildChatBody, chatEndpoint, clipToChars, effectiveMaxTokens, isLocalEndpoint, locateRange, maskKey, parseAiConfig, parseSseData, parseTitleCandidates, parseTopicLine, probeTimeoutOf, providerReady, readRange, splitSseBuffer, streamTimeoutOf } from "./ai.ts";

test("config keeps valid providers, drops invalid ones and dedupes ids", () => {
  const cfg = parseAiConfig({
    active: "b",
    providers: [
      { id: "a", name: "A", baseUrl: "https://api.example.com/v1/", apiKey: "k", model: "m" },
      { id: "a", name: "dup", baseUrl: "https://dup.example.com", model: "m" },
      { id: "bad", baseUrl: "ftp://x", model: "m" },
      { id: "nomodel", baseUrl: "https://x.com", model: "  " },
      { id: "b", name: "B", baseUrl: "http://127.0.0.1:11434/v1", apiKey: "", model: "qwen" },
    ],
  });
  assert.deepEqual(cfg.providers.map((p) => p.id), ["a", "b"]);
  assert.equal(cfg.providers[0].baseUrl, "https://api.example.com/v1");
  assert.equal(cfg.active, "b");
  assert.equal(activeProvider(cfg)?.model, "qwen");
});

test("active falls back to the first provider when it points nowhere", () => {
  const cfg = parseAiConfig({ active: "missing", providers: [{ id: "x", baseUrl: "https://a.com", model: "m" }] });
  assert.equal(cfg.active, "x");
});

test("garbage input yields an empty config instead of throwing", () => {
  for (const raw of [null, undefined, 42, "not json", { providers: "no" }]) {
    const cfg = parseAiConfig(raw);
    assert.deepEqual(cfg, { active: "", providers: [] });
  }
});

test("chat endpoint is appended once and accepts a full endpoint", () => {
  assert.equal(chatEndpoint("https://api.deepseek.com/v1"), "https://api.deepseek.com/v1/chat/completions");
  assert.equal(chatEndpoint("https://api.deepseek.com/v1/"), "https://api.deepseek.com/v1/chat/completions");
  assert.equal(chatEndpoint("https://x.com/v1/chat/completions"), "https://x.com/v1/chat/completions");
});

test("provider is only ready when model and key are present, or it is local", () => {
  assert.equal(providerReady({ id: "a", name: "a", baseUrl: "https://x.com/v1", apiKey: "", model: "m" }), false);
  assert.equal(providerReady({ id: "a", name: "a", baseUrl: "https://x.com/v1", apiKey: "k", model: "m" }), true);
  assert.equal(providerReady({ id: "a", name: "a", baseUrl: "http://127.0.0.1:11434/v1", apiKey: "", model: "m" }), true);
  assert.equal(providerReady(undefined), false);
});

test("sse lines are parsed into deltas, done markers and errors", () => {
  assert.deepEqual(parseSseData('data: {"choices":[{"delta":{"content":"你"}}]}'), { done: false, delta: "你" });
  assert.deepEqual(parseSseData("data: [DONE]"), { done: true, delta: "" });
  assert.deepEqual(parseSseData("data: {\"error\":{\"message\":\"额度不足\"}}"), { done: true, delta: "", error: "额度不足" });
  assert.deepEqual(parseSseData('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}'), { done: true, delta: "" });
  assert.deepEqual(parseSseData(": keep-alive"), { done: false, delta: "" });
  assert.deepEqual(parseSseData("data: not-json"), { done: false, delta: "" });
});

test("partial sse buffers keep the trailing bytes for the next chunk", () => {
  const first = splitSseBuffer('data: {"a":1}\ndata: {"b":');
  assert.deepEqual(first.lines, ['data: {"a":1}']);
  assert.equal(first.rest, 'data: {"b":');
  const second = splitSseBuffer(first.rest + "2}\n");
  assert.deepEqual(second.lines, ['data: {"b":2}']);
  assert.equal(second.rest, "");
  const none = splitSseBuffer("no newline");
  assert.deepEqual(none.lines, []);
  assert.equal(none.rest, "no newline");
});

test("clipping counts code points, not utf-16 units", () => {
  assert.equal(clipToChars("发票打印助手", 3), "发票打");
  assert.equal(clipToChars("👍🏻好", 2), "👍🏻");
  assert.equal(clipToChars("abc", 0), "abc");
});

test("topic parsing strips hashes, fence and separators", () => {
  assert.deepEqual(parseTopicLine("```\n#办公技巧, 发票打印、财务\n报税；\n```"), ["办公技巧", "发票打印", "财务", "报税"]);
});

test("keys are masked for display", () => {
  assert.equal(maskKey("sk-1234567890abcdef1234567890abcdef"), "sk-••••cdef");
  assert.equal(maskKey("short"), "••••");
  assert.equal(maskKey(""), "");
});

test("title candidates come from a json array and are clipped to the platform limit", () => {
  const raw = '["发票排版终于不用一张张点，10 平台一键填写","发票图乱成一锅粥？电脑批量排好再发布","这个工具让我每天少加班一小时","批量排版加多平台发布，办公效率翻倍","自媒体人必备：一份内容扇出十个平台"]';
  const titles = parseTitleCandidates(raw, 20);
  assert.equal(titles.length, 5);
  assert.ok(titles.every((t) => Array.from(t).length <= 20));
  assert.equal(titles[0], "发票排版终于不用一张张点，10 平台一键");
});

test("title candidates survive fenced json, numbering and plain lines", () => {
  assert.deepEqual(parseTitleCandidates("```json\n[\"甲\",\"乙\"]\n```"), ["甲", "乙"]);
  assert.deepEqual(parseTitleCandidates("1. 甲\n2. 乙\n"), ["甲", "乙"]);
  assert.deepEqual(parseTitleCandidates("说明一下：[{\"t\":1}] 之后\n真正的标题"), ["真正的标题"]);
  assert.deepEqual(parseTitleCandidates("《发票助手》\n- 第二版"), ["发票助手", "第二版"]);
  assert.deepEqual(parseTitleCandidates("   "), []);
});
test("本机 / 局域网地址认得出来，云端地址不会被误判", () => {
  for (const url of [
    "http://127.0.0.1:11434/v1",
    "http://localhost:11434/v1",
    "http://[::1]:11434/v1",
    "http://0.0.0.0:8080/v1",
    "http://192.168.10.20:8000/v1",
    "http://10.0.0.5/v1",
    "http://172.20.1.1/v1",
    "http://mac-mini.local:11434/v1",
  ])
    assert.equal(isLocalEndpoint(url), true, url);
  for (const url of ["https://api.deepseek.com/v1", "https://us.oojj.top/v1", "http://172.32.0.1/v1", "https://127.0.0.1.example.com/v1", ""])
    assert.equal(isLocalEndpoint(url), false, url);
});

test("本地模型的超时放宽到 3 分钟探测 / 10 分钟生成，云端保持原样", () => {
  assert.equal(probeTimeoutOf("http://127.0.0.1:11434/v1"), 180_000);
  assert.equal(streamTimeoutOf("http://127.0.0.1:11434/v1"), 600_000);
  assert.equal(probeTimeoutOf("https://api.deepseek.com/v1"), 25_000);
  assert.equal(streamTimeoutOf("https://api.deepseek.com/v1"), 120_000);
});

test("思考型模型的推理流单独标记，不能混进正文", () => {
  const think = parseSseData('data: {"choices":[{"delta":{"reasoning_content":"先想想"},"finish_reason":null}]}');
  assert.equal(think.delta, "");
  assert.equal(think.reasoning, "先想想");
  const answer = parseSseData('data: {"choices":[{"delta":{"content":"你好"},"finish_reason":null}]}');
  assert.equal(answer.delta, "你好");
  assert.equal(answer.reasoning, undefined);
  const stop = parseSseData('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}');
  assert.equal(stop.done, true);
  assert.equal(stop.delta, "");
});

test("模型名写错时不会被当成地址错误（Ollama 的 404 也回 not found）", () => {
  const ollama = aiErrorText(404, '{"error":"model \'gemma3:1b\' not found, try pulling it first"}');
  assert.match(ollama, /模型名不对/);
  const openai = aiErrorText(404, '{"error":{"message":"The model `gpt-9` does not exist"}}');
  assert.match(openai, /模型名不对/);
  // 真·地址错仍旧报地址
  assert.match(aiErrorText(404, '404 page not found'), /接口地址不存在/);
  assert.match(aiErrorText(404, ""), /接口地址不存在|没给原因/);
});

test("思考型模型给足输出预算，否则只会「只思考不写正文」", () => {
  const local = (maxOutputTokens?: number) => ({ id: "a", name: "a", baseUrl: "http://127.0.0.1:11434/v1", apiKey: "", model: "gemma4:latest", ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }) });
  // 本地没填：给 1024，让推理有地方烧
  assert.equal(effectiveMaxTokens(local()), 1024);
  // 本地填太小：抬起到底线 512
  assert.equal(effectiveMaxTokens(local(128)), 512);
  // 本地填得够：原样
  assert.equal(effectiveMaxTokens(local(4096)), 4096);
  // 云端没填：交给服务端默认，不自作主张
  assert.equal(effectiveMaxTokens({ id: "b", name: "b", baseUrl: "https://api.deepseek.com/v1", apiKey: "k", model: "deepseek-flash" }), undefined);
  // 云端填了也尊重用户，但同样有下限
  assert.equal(effectiveMaxTokens({ id: "b", name: "b", baseUrl: "https://api.deepseek.com/v1", apiKey: "k", model: "m", maxOutputTokens: 100 }), 512);
});

test("选区改写只认落在正文内、且非空白的区间", () => {
  const body = "第一段写点背景。\r\n第二段是重点。\r\n第三段收尾。";
  const start = body.indexOf("第二段是重点。");
  const range = readRange(body, { start, end: start + "第二段是重点。".length });
  assert.equal(range?.raw, "第二段是重点。");
  // 没选区 / 空选区 / 越界 / 纯空白 → 一律退回整篇
  assert.equal(readRange(body, undefined), undefined);
  assert.equal(readRange(body, { start: 4, end: 4 }), undefined);
  assert.equal(readRange(body, { start: 0, end: body.length + 5 }), undefined);
  const blank = "abc   def";
  assert.equal(readRange(blank, { start: 3, end: 6 }), undefined);
});

test("原文被改过时，选区靠位置或唯一命中重定位，多处命中就不猜", () => {
  const body = "甲段。乙段。丙段。";
  const raw = "乙段。";
  const start = body.indexOf(raw);
  const range = { start, end: start + raw.length, raw };
  assert.deepEqual(locateRange(body, range), { start, end: start + raw.length });
  // 位置变了但内容还在（前面插了字）
  const moved = "新加一句。甲段。乙段。丙段。";
  const hit = locateRange(moved, range);
  assert.equal(moved.slice(hit!.start, hit!.end), raw);
  // 同一段出现两次：不敢猜，返回 undefined，界面上改为提示手动复制
  const dup = "乙段。甲段。乙段。";
  assert.equal(locateRange(dup, range), undefined);
  // 内容被删了
  assert.equal(locateRange("甲段。丙段。", range), undefined);
});

test("buildChatBody 把算好的预算写进 max_tokens", () => {
  const local = buildChatBody(
    { id: "a", name: "a", baseUrl: "http://127.0.0.1:11434/v1", apiKey: "", model: "gemma4:latest" },
    [{ role: "user", content: "hi" }],
    { stream: true },
  ) as Record<string, unknown>;
  assert.equal(local.max_tokens, 1024);
  assert.equal(local.stream, true);

  const cloud = buildChatBody(
    { id: "b", name: "b", baseUrl: "https://api.deepseek.com/v1", apiKey: "k", model: "deepseek-flash" },
    [{ role: "user", content: "hi" }],
  ) as Record<string, unknown>;
  assert.equal("max_tokens" in cloud, false);
});

test("流式片段保留换行和前导空格", () => {
  const nl = parseSseData(String.raw`data: {"choices":[{"delta":{"content":"\n\n"}}]}`);
  assert.equal(nl.delta, "\n\n");
  const word = parseSseData('data: {"choices":[{"delta":{"content":" world"}}]}');
  assert.equal(word.delta, " world");
});

test("局域网模型不填 Key 也算就绪", () => {
  assert.equal(providerReady({ id: "a", name: "", baseUrl: "http://192.168.1.5:11434/v1", model: "qwen", apiKey: "" }), true);
  assert.equal(providerReady({ id: "a", name: "", baseUrl: "https://api.example.com/v1", model: "x", apiKey: "" }), false);
});

test("换了接口地址就不复用旧 Key", async () => {
  const { sameEndpoint } = await import("./ai.ts");
  assert.equal(sameEndpoint("https://api.deepseek.com/v1", "https://api.deepseek.com/v1/"), true);
  assert.equal(sameEndpoint("https://api.deepseek.com/v1", "https://relay.example.com/v1"), false);
});

test("替换选区时保留选区首尾的换行", async () => {
  const { keepEdgeSpace } = await import("./ai.ts");
  assert.equal(keepEdgeSpace("\n原段落\n\n", "新段落"), "\n新段落\n\n");
});
