import {
  aiErrorText,
  buildChatBody,
  candidateChatUrls,
  candidateModelUrls,
  chatBaseOf,
  isLocalEndpoint,
  LOCAL_SLOW_HINT,
  parseModelList,
  parseSseData,
  probeTimeoutOf,
  splitSseBuffer,
  streamTimeoutOf,
  stripFence,
  type AiProvider,
  type ChatMessage,
} from "../../shared/ai.ts";

export interface StreamOptions {
  onDelta?: (delta: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface StreamResult {
  ok: boolean;
  text: string;
  error?: string;
  aborted?: boolean;
  /** 真正通了的那条地址对应的 base URL，保存时用它覆盖用户填的 */
  baseUrl?: string;
}

function headersFor(provider: AiProvider) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (provider.apiKey) headers.authorization = "Bearer " + provider.apiKey;
  return { ...headers, ...(provider.headers || {}) };
}

/** 这个响应是不是「地址不对」造成的，值得换下一个候选地址再试一次 */
function worthRetry(status: number, type: string) {
  if (status === 404 || status === 405) return true;
  return /text\/html/i.test(type);
}

function streamBroken(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (/terminated|fetch failed|ECONNRESET|ECONNREFUSED|socket|network/i.test(msg)) return "和模型的连接中途断了";
  return msg;
}

export async function streamChat(provider: AiProvider, messages: ChatMessage[], opts: StreamOptions = {}): Promise<StreamResult> {
  const local = isLocalEndpoint(provider.baseUrl);
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? streamTimeoutOf(provider.baseUrl);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onAbort);
  let text = "";
  let sawReasoning = false;
  try {
    const urls = candidateChatUrls(provider.baseUrl);
    if (!urls.length) return { ok: false, text: "", error: "接口地址为空" };
    const body = JSON.stringify(buildChatBody(provider, messages, { stream: true }));
    let res: Response | undefined;
    let failure: StreamResult | undefined;
    for (const url of urls) {
      const attempt = await fetch(url, { method: "POST", headers: headersFor(provider), body, signal: controller.signal });
      const type = attempt.headers.get("content-type") || "";
      if (attempt.ok && !/text\/html/i.test(type)) {
        res = attempt;
        break;
      }
      const payload = await attempt.text().catch(() => "");
      failure = { ok: false, text: "", error: aiErrorText(attempt.status, payload) };
      if (!worthRetry(attempt.status, type)) break;
      // 地址不对：换下一个候选；已经是最后一个就把这次的结果返回
    }
    if (!res) return failure || { ok: false, text: "", error: "连不上接口" };
    const baseUrl = chatBaseOf(res.url || urls[0]);
    const type = res.headers.get("content-type") || "";
    if (!res.body || !type.includes("event-stream")) {
      const whole = await res.text();
      const parsed = whole ? parseJsonText(whole) : "";
      if (!parsed) return { ok: false, text: "", error: streamFailure(whole), baseUrl };
      opts.onDelta?.(parsed);
      return { ok: true, text: parsed, baseUrl };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { lines, rest } = splitSseBuffer(buffer);
      buffer = rest;
      for (const line of lines) {
        const event = parseSseData(line);
        if (event.error) return { ok: false, text, error: event.error, baseUrl };
        // 思考流只用来判断「模型在说话、只是没说正文」，绝不写进正文
        if (event.reasoning) sawReasoning = true;
        if (event.delta) {
          text += event.delta;
          opts.onDelta?.(event.delta);
        }
      }
    }
    if (buffer.trim()) {
      const tail = parseSseData(buffer);
      if (tail.reasoning) sawReasoning = true;
      if (tail.delta) {
        text += tail.delta;
        opts.onDelta?.(tail.delta);
      }
    }
    if (!text.trim())
      return {
        ok: false,
        text: "",
        error: sawReasoning
          ? "模型只给了思考过程，没有给出正文（多半是输出长度被截断）。把原文拆短一点，或换个非思考型模型"
          : "模型没有输出内容，可能被内容策略拦截",
        baseUrl,
      };
    return { ok: true, text, baseUrl };
  } catch (error) {
    if (controller.signal.aborted) {
      const byUser = opts.signal?.aborted === true;
      return {
        ok: false,
        text,
        aborted: byUser,
        error: byUser ? "已取消" : local ? "等了 " + Math.round(timeoutMs / 1000) + " 秒还没写完。" + LOCAL_SLOW_HINT : "请求超时",
      };
    }
    return { ok: false, text, error: streamBroken(error) };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

/** 200 但拿不到正文时，尽量把服务端给的解释翻出来 */
function streamFailure(whole: string) {
  const raw = (whole || "").trim();
  if (!raw) return "模型返回内容为空";
  const obj = (() => {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  })();
  if (obj && typeof obj.error === "object" && obj.error) return aiErrorText(200, raw);
  if (looksEmptyChoices(raw)) return "模型返回了空内容，换个模型名或稍后再试";
  return aiErrorText(200, raw);
}

const looksEmptyChoices = (raw: string) => /"choices"\s*:\s*\[\s*\]/.test(raw);

function parseJsonText(whole: string, allowReasoning = false) {
  try {
    const obj = JSON.parse(whole) as Record<string, unknown>;
    const choices = Array.isArray(obj.choices) ? obj.choices : [];
    const first = choices[0] as Record<string, unknown> | undefined;
    const message = first && typeof first.message === "object" && first.message ? (first.message as Record<string, unknown>) : undefined;
    const content = message && typeof message.content === "string" ? message.content : "";
    if (content) return stripFence(content);
    // 只有探测才接受「只说了思考过程」；生成阶段把思考当正文会污染稿子
    if (allowReasoning && message) {
      const reasoning = [message.reasoning_content, message.reasoning].find((v) => typeof v === "string" && v.trim());
      if (typeof reasoning === "string") return stripFence(reasoning);
    }
    if (typeof obj.error === "object" && obj.error) return "";
    return "";
  } catch {
    return "";
  }
}

export async function completeChat(provider: AiProvider, messages: ChatMessage[], opts: Omit<StreamOptions, "onDelta"> = {}): Promise<StreamResult> {
  const result = await streamChat(provider, messages, opts);
  return { ...result, text: stripFence(result.text) };
}

export interface ProbeResult {
  ok: boolean;
  ms: number;
  sample?: string;
  model?: string;
  /** 探测通过时建议保存的 base URL（会自动补上 /v1） */
  baseUrl?: string;
  error?: string;
}

/**
 * 保存前的连通性探测：真发一条最短的对话请求。
 * 故意不带 temperature / max_tokens，避免个别模型不认这两个参数导致误判。
 * 本机模型冷启动要加载权重（实测 26B 要 40–90 秒），超时按地址自动放宽到 180 秒。
 */
export async function probeChat(provider: AiProvider, timeoutMs = probeTimeoutOf(provider.baseUrl)): Promise<ProbeResult> {
  const started = Date.now();
  const local = isLocalEndpoint(provider.baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const urls = candidateChatUrls(provider.baseUrl);
    if (!urls.length) return { ok: false, ms: 0, error: "接口地址为空，先填一个以 http:// 或 https:// 开头的地址" };
    if (!provider.model.trim()) return { ok: false, ms: 0, error: "模型名是空的，点「获取列表」选一个" };
    const body = JSON.stringify({ model: provider.model, messages: [{ role: "user", content: "只回复两个字：可用" }], stream: false });
    let failure: ProbeResult | undefined;
    for (const url of urls) {
      const attempt = await fetch(url, { method: "POST", headers: headersFor(provider), body, signal: controller.signal });
      const type = attempt.headers.get("content-type") || "";
      const payload = await attempt.text().catch(() => "");
      if (attempt.ok && !/text\/html/i.test(type)) {
        // 思考型模型可能先吐一堆推理、正文还没开始；只要说了话就算通
        const sample = parseJsonText(payload, true) || "";
        const baseUrl = chatBaseOf(url);
        if (!sample) {
          return { ok: false, ms: Date.now() - started, baseUrl, error: "地址和 Key 都没问题，但模型没说话：" + (looksEmptyChoices(payload) ? "返回了空内容" : "可能是这个模型当前不可用") };
        }
        return { ok: true, ms: Date.now() - started, sample: sample.slice(0, 40), model: provider.model, baseUrl };
      }
      failure = { ok: false, ms: Date.now() - started, error: aiErrorText(attempt.status, payload) };
      if (!worthRetry(attempt.status, type)) break;
    }
    return failure || { ok: false, ms: Date.now() - started, error: "连不上接口" };
  } catch (error) {
    if (controller.signal.aborted)
      return {
        ok: false,
        ms: Date.now() - started,
        error: local
          ? "等了 " + Math.round(timeoutMs / 1000) + " 秒没回。" + LOCAL_SLOW_HINT + "，再点一次「测试连接」通常就快了；还是慢就换个小一点的模型"
          : "探测超时（" + Math.round(timeoutMs / 1000) + " 秒没响应）",
      };
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, ms: Date.now() - started, error: /ENOTFOUND|EAI_AGAIN|getaddrinfo/.test(msg) ? "域名解析不了，检查地址有没有写错" : msg };
  } finally {
    clearTimeout(timer);
  }
}

/** 拉模型列表，省得用户去抄（抄错是最常见的接入失败原因） */
export async function listModels(provider: AiProvider, timeoutMs = 15000): Promise<{ ok: boolean; models: string[]; baseUrl?: string; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const urls = candidateModelUrls(provider.baseUrl);
    if (!urls.length) return { ok: false, models: [], error: "先填接口地址" };
    let failure: { ok: boolean; models: string[]; error?: string } | undefined;
    for (const url of urls) {
      const res = await fetch(url, { headers: headersFor(provider), signal: controller.signal });
      const type = res.headers.get("content-type") || "";
      const payload = await res.text().catch(() => "");
      if (res.ok && !/text\/html/i.test(type)) {
        const models = parseModelList(payload);
        if (models.length) return { ok: true, models, baseUrl: chatBaseOf(url.replace(/\/models$/i, "")) };
        failure = { ok: false, models: [], error: "接口有响应，但没返回模型列表。手动填模型名吧" };
        break;
      }
      failure = { ok: false, models: [], error: aiErrorText(res.status, payload) };
      if (!worthRetry(res.status, type)) break;
    }
    return failure || { ok: false, models: [], error: "拿不到模型列表" };
  } catch (error) {
    if (controller.signal.aborted) return { ok: false, models: [], error: "拉取超时" };
    return { ok: false, models: [], error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}
