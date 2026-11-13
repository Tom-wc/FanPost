export type AiAction = "polish" | "expand" | "shorten" | "title" | "topics" | "rewrite" | "reply";

export interface AiProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  headers?: Record<string, string>;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface AiConfig {
  active: string;
  providers: AiProvider[];
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ProviderTemplate {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  note: string;
}

export const EMPTY_CONFIG: AiConfig = { active: "", providers: [] };

export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-flash", note: "需填 API Key；模型可选 deepseek-flash / deepseek-v4-pro" },
  { id: "ollama", name: "本地 Ollama", baseUrl: "http://127.0.0.1:11434/v1", model: "", note: "Key 留空即可，模型名填 ollama list 里的名字。实测 8B 润色一句 8–12 秒可日常用；26B 冷启动 89 秒、热后 22 秒，只适合长文改写" },
  { id: "custom", name: "自定义（OpenAI 兼容）", baseUrl: "", model: "", note: "填厂商文档里的 base URL（一般以 /v1 结尾）和模型名" },
];

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const rawText = (v: unknown) => (typeof v === "string" ? v : "");

const cleanHeaders = (v: unknown): Record<string, string> | undefined => {
  if (!isRecord(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) if (typeof val === "string" && k.trim() && val.trim()) out[k.trim()] = val.trim();
  return Object.keys(out).length ? out : undefined;
};

export function normalizeBaseUrl(raw: string) {
  return raw.trim().replace(/\/+$/, "");
}

export function chatEndpoint(baseUrl: string) {
  const base = normalizeBaseUrl(baseUrl);
  return /\/chat\/completions$/.test(base) ? base : base + "/chat/completions";
}

/** base 里有没有版本段（/v1、/v1beta、/openai/v1 …） */
const hasVersionSeg = (base: string) => /\/v\d+[a-z]*$/i.test(base);

/**
 * 能拼出的对话地址，按可能性排序。
 * 用户往往只粘「https://us.oojj.top/」这种首页地址，缺 /v1 时该地址会把前端页面当 200 返回，
 * 所以这里额外给一个补 /v1 的候选，调用时逐个试，谁真通了就存谁。
 */
export function candidateChatUrls(baseUrl: string): string[] {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return [];
  if (/\/chat\/completions$/i.test(base)) return [base];
  const list = [base + "/chat/completions"];
  if (!hasVersionSeg(base)) list.push(base + "/v1/chat/completions");
  return [...new Set(list)];
}

/** 能拼出的模型列表地址 */
export function candidateModelUrls(baseUrl: string): string[] {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return [];
  if (/\/models$/i.test(base)) return [base];
  const list = [base + "/models"];
  if (!hasVersionSeg(base)) list.push(base + "/v1/models");
  return [...new Set(list)];
}

/** 把命中的对话地址还原成该保存的 base URL */
export function chatBaseOf(url: string) {
  return normalizeBaseUrl(url).replace(/\/chat\/completions$/i, "");
}

/**
 * 地址是不是在本机 / 局域网。本地模型的冷启动和逐字生成比云端慢一个量级，
 * 探针和生成都得给更长的超时，否则 25 秒一到就被判「连不通」。
 */
export function isLocalEndpoint(baseUrl: string) {
  const host = (normalizeBaseUrl(baseUrl).match(/^https?:\/\/(\[[^\]]+\]|[^/:]+)/i)?.[1] || "").toLowerCase();
  if (!host) return false;
  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "[::1]" || host === "::1") return true;
  if (host.endsWith(".local") || host.endsWith(".lan")) return true;
  if (/^192\.168\.\d+\.\d+$/.test(host)) return true;
  if (/^10\.\d+\.\d+\.\d+$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host)) return true;
  return false;
}

/** 保存前探测：本地模型首次要加载权重，给足 3 分钟；云端 25 秒足够 */
export const probeTimeoutOf = (baseUrl: string) => (isLocalEndpoint(baseUrl) ? 180_000 : 25_000);

/** 正文生成：本地 26B 这类模型写一段话要几十秒到几分钟，云端 2 分钟兜底 */
export const streamTimeoutOf = (baseUrl: string) => (isLocalEndpoint(baseUrl) ? 600_000 : 120_000);

/** 本地模型慢是因为要在本机算，不是配置错了，提示里要说清楚 */
export const LOCAL_SLOW_HINT = "本机模型要自己算，首次还得加载权重（几十秒到几分钟不等），比云端慢是正常的";

const looksHtml = (body: string) => /^\s*<(!doctype|html)/i.test(body || "");

/** 从各家五花八门的错误响应里抠出一句人话 */
export function aiErrorText(status: number, body: string): string {
  const raw = (body || "").trim();
  const brief = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 150);
  if (!raw) return "接口返回 " + status + "，没给原因";
  if (looksHtml(raw)) return "这个地址返回的是一张网页，不是接口。地址多半少了 /v1，或者填成了中转站首页";
  let msg = "";
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const err = obj.error;
    if (typeof err === "string") msg = err;
    else if (err && typeof err === "object") msg = String((err as Record<string, unknown>).message || "");
    if (!msg && typeof obj.message === "string") msg = obj.message;
    if (!msg && typeof obj.detail === "string") msg = obj.detail;
  } catch {
    msg = raw;
  }
  const low = (msg || "").toLowerCase();
  // Ollama 这类本机服务对「模型名写错」也回 404，正文是 model 'x' not found ——
  // 先认模型，否则会被下面的 404 分支误判成「地址不存在」。
  if (
    /model_not_found|no available channel|model not found|does not exist|invalid model|unknown model|无可用渠道|模型不存在|没有可用渠道/.test(low) ||
    (/not found/.test(low) && /model|模型/.test(low))
  )
    return "模型名不对，这家没有叫这个的模型（" + brief(msg) + "）。点「获取列表」从里面选一个";
  if (status === 401 || /invalid token|invalid api key|incorrect api key|unauthorized|无效的令牌|令牌无效/.test(low))
    return "Key 不对或已失效（HTTP 401）。检查有没有复制完整、带没带多余空格";
  if (status === 402 || /insufficient|quota|balance|exceeded your current/.test(low))
    return "账户余额或额度不够了（HTTP 402）";
  if (status === 403 || /permission|forbidden|not allowed|无权/.test(low))
    return "这个 Key 没有该模型的权限（HTTP 403），可能被分组或白名单限制了";
  if (status === 404) return "接口地址不存在（HTTP 404）。base URL 一般形如 https://服务商/v1";
  if (status === 429 || /rate limit|too many requests/.test(low)) return "请求太频繁被限流了（HTTP 429），等一会儿再试";
  if (status >= 500) return "服务端出错（HTTP " + status + "）：" + brief(msg || "没给原因");
  return "接口返回 " + status + "：" + brief(msg);
}

/** 模型列表响应里可能是 data[].id、data[]、models[]，都认 */
export function parseModelList(raw: string): string[] {
  const obj = safeJson(raw);
  const pick = (arr: unknown[]): string[] =>
    arr
      .map((x) => {
        if (typeof x === "string") return x;
        if (isRecord(x) && typeof x.id === "string") return x.id;
        return "";
      })
      .map((x) => x.trim())
      .filter(Boolean);
  if (!isRecord(obj)) return [];
  const list = Array.isArray(obj.data) ? obj.data : Array.isArray(obj.models) ? obj.models : [];
  return [...new Set(pick(list))].sort((a, b) => a.localeCompare(b));
}

function parseProvider(v: unknown, index: number): AiProvider | undefined {
  if (!isRecord(v)) return undefined;
  const baseUrl = text(v.baseUrl);
  if (!/^https?:\/\//i.test(baseUrl)) return undefined;
  const model = text(v.model);
  if (!model) return undefined;
  const id = text(v.id) || "p" + index;
  const temperature = typeof v.temperature === "number" && v.temperature >= 0 && v.temperature <= 2 ? v.temperature : undefined;
  const maxOutputTokens = typeof v.maxOutputTokens === "number" && v.maxOutputTokens > 0 && v.maxOutputTokens <= 393216 ? Math.round(v.maxOutputTokens) : undefined;
  return {
    id,
    name: text(v.name) || id,
    baseUrl: normalizeBaseUrl(baseUrl),
    apiKey: text(v.apiKey),
    model,
    ...(cleanHeaders(v.headers) ? { headers: cleanHeaders(v.headers) } : {}),
    ...(temperature === undefined ? {} : { temperature }),
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
  };
}

export function parseAiConfig(raw: unknown): AiConfig {
  const obj = typeof raw === "string" ? safeJson(raw) : raw;
  if (!isRecord(obj)) return { ...EMPTY_CONFIG };
  const list = Array.isArray(obj.providers) ? obj.providers : [];
  const providers: AiProvider[] = [];
  list.forEach((item, i) => {
    const p = parseProvider(item, i);
    if (p && !providers.some((x) => x.id === p.id)) providers.push(p);
  });
  const active = text(obj.active);
  return { active: providers.some((p) => p.id === active) ? active : providers[0]?.id || "", providers };
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function activeProvider(config: AiConfig): AiProvider | undefined {
  return config.providers.find((p) => p.id === config.active);
}

export function providerReady(p: AiProvider | undefined): boolean {
  if (!p) return false;
  return Boolean(p.model) && Boolean(p.apiKey || isLocalEndpoint(p.baseUrl));
}

export function maskKey(key: string) {
  const k = key.trim();
  if (!k) return "";
  if (k.length <= 8) return "••••";
  return k.slice(0, 3) + "••••" + k.slice(-4);
}

/**
 * 输出 token 预算。思考型模型（gemma4 / r1 这类）会先烧掉一两千推理 token，
 * 预算给小了会出现「只思考、正文 0 字」。所以：本地没填就给 1024，填小了抬到 512。
 * 云端不填就交给服务端默认，别自作主张限制。
 */
export function effectiveMaxTokens(provider: AiProvider): number | undefined {
  const raw = provider.maxOutputTokens;
  const filled = typeof raw === "number" && Number.isFinite(raw) && raw > 0;
  if (!filled) return isLocalEndpoint(provider.baseUrl) ? 1024 : undefined;
  return Math.max(512, Math.round(raw));
}

export function buildChatBody(provider: AiProvider, messages: ChatMessage[], opts: { stream?: boolean } = {}) {
  const maxTokens = effectiveMaxTokens(provider);
  return {
    model: provider.model,
    messages,
    stream: opts.stream !== false,
    ...(provider.temperature === undefined ? {} : { temperature: provider.temperature }),
    ...(maxTokens === undefined ? {} : { max_tokens: maxTokens }),
  };
}

export interface SseEvent {
  done: boolean;
  delta: string;
  /** 思考型模型（deepseek-r1 / gemma4 等）单独的推理流，不能混进正文 */
  reasoning?: string;
  error?: string;
}

export function parseSseData(line: string): SseEvent {
  const raw = line.trim();
  if (!raw.startsWith("data:")) return { done: false, delta: "" };
  const payload = raw.slice(5).trim();
  if (!payload) return { done: false, delta: "" };
  if (payload === "[DONE]") return { done: true, delta: "" };
  const obj = safeJson(payload);
  if (!isRecord(obj)) return { done: false, delta: "" };
  if (isRecord(obj.error)) return { done: true, delta: "", error: text(obj.error.message) || "模型返回错误" };
  const choices = Array.isArray(obj.choices) ? obj.choices : [];
  const first = choices[0];
  if (!isRecord(first)) return { done: false, delta: "" };
  const d = isRecord(first.delta) ? first.delta : {};
  const delta = rawText(d.content);
  const reasoning = rawText(d.reasoning_content) || rawText(d.reasoning);
  const finish = text(first.finish_reason);
  return { done: finish.length > 0 && !delta, delta, ...(reasoning ? { reasoning } : {}) };
}

export function splitSseBuffer(buffer: string): { lines: string[]; rest: string } {
  const idx = buffer.lastIndexOf("\n");
  if (idx < 0) return { lines: [], rest: buffer };
  const head = buffer.slice(0, idx);
  const rest = buffer.slice(idx + 1);
  const lines = head.split("\n").filter((l) => l.trim().length > 0);
  return { lines, rest };
}

export function clipToChars(value: string, max: number): string {
  const chars = Array.from(value || "");
  if (!max || chars.length <= max) return value;
  return chars.slice(0, max).join("");
}

export function stripFence(value: string) {
  return value
    .replace(/^```[a-zA-Z]*\n?/, "")
    .replace(/\n?```\s*$/, "")
    .trim();
}

export function parseTopicLine(value: string): string[] {  return stripFence(value)
    .split(/[\n,，、;；]+/)
    .map((x) => x.trim().replace(/^#+/, "").replace(/\s+/g, ""))
    .filter(Boolean);
}

const trimTitle = (raw: string) =>
  raw
    .replace(/^\s*(?:\d+[.、)]|[-*•])\s*/, "")
    .replace(/^["'“”『』《》]+|["'“”『』《》]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

export function parseTitleCandidates(value: string, limit?: number): string[] {
  const body = stripFence(value).trim();
  const out: string[] = [];
  const push = (x: unknown) => {
    if (typeof x !== "string") return;
    const title = trimTitle(x);
    if (title && !out.includes(title)) out.push(limit ? clipToChars(title, limit) : title);
  };
  const json = (() => {
    try {
      return JSON.parse(body) as unknown;
    } catch {
      const start = body.indexOf("[");
      const end = body.lastIndexOf("]");
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(body.slice(start, end + 1)) as unknown;
        } catch {
          return undefined;
        }
      }
      return undefined;
    }
  })();
  if (Array.isArray(json)) json.forEach(push);
  if (!out.length) {
    body
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => line && !/[{}[\]"]/.test(line))
      .forEach(push);
  }
  return out.slice(0, 5);
}

export interface AiProviderView {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  keyMask: string;
  hasKey: boolean;
  headers?: Record<string, string>;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface AiConfigView {
  active: string;
  providers: AiProviderView[];
}

export function toConfigView(config: AiConfig): AiConfigView {
  return {
    active: config.active,
    providers: config.providers.map((p) => ({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      model: p.model,
      keyMask: maskKey(p.apiKey),
      hasKey: Boolean(p.apiKey),
      ...(p.headers ? { headers: p.headers } : {}),
      ...(p.temperature === undefined ? {} : { temperature: p.temperature }),
      ...(p.maxOutputTokens === undefined ? {} : { maxOutputTokens: p.maxOutputTokens }),
    })),
  };
}

export interface AiRunInput {
  requestId: string;
  action: AiAction;
  text: string;
  platform?: string;
  type?: "video" | "image_text";
  limit?: number;
  instruction?: string;
}

export const AI_ERRORS = {
  missing: "还没配置模型。到「设置 → 模型」里填一个 OpenAI 兼容的接口地址和 API Key。",
  notReady: "当前模型缺少 API Key 或模型名，去「设置 → 模型」补上。",
  empty: "没有可处理的文本。",
} as const;

/* ---------- 选区改写 ---------- */

export interface AiSelection {
  start: number;
  end: number;
}

export interface AiRange {
  start: number;
  end: number;
  /** 选中时的原文，用来校验位置有没有被改动 */
  raw: string;
}

/**
 * 光标停在哪就改哪一段：选区必须落在正文内、且不是纯空白才算数，
 * 否则退回整篇处理（宁可按全文来，也不要按一个错位的区间去替换）。
 */
export function readRange(text: string, selection?: AiSelection): AiRange | undefined {
  if (!selection) return undefined;
  const { start, end } = selection;
  if (!(start >= 0 && end > start && end <= text.length)) return undefined;
  const raw = text.slice(start, end);
  if (!raw.trim()) return undefined;
  return { start, end, raw };
}

/**
 * 选区还能不能对上原文：位置没变最优先；否则要求全文唯一命中，
 * 多处命中就不猜——猜错会把不相干的段落覆盖掉。
 */
export function sameEndpoint(a: string, b: string): boolean {
  const origin = (u: string) => {
    try {
      return new URL(normalizeBaseUrl(u)).origin.toLowerCase();
    } catch {
      return "";
    }
  };
  const oa = origin(a);
  return Boolean(oa) && oa === origin(b);
}

export function keepEdgeSpace(raw: string, text: string): string {
  const lead = raw.match(/^\s*/)?.[0] || "";
  const tail = raw.match(/\s*$/)?.[0] || "";
  return lead + text + tail;
}

export function locateRange(base: string, range: AiRange): { start: number; end: number } | undefined {
  if (base.slice(range.start, range.end) === range.raw) return { start: range.start, end: range.end };
  const first = base.indexOf(range.raw);
  if (first < 0) return undefined;
  if (base.indexOf(range.raw, first + 1) >= 0) return undefined;
  return { start: first, end: first + range.raw.length };
}
