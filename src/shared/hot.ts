import type { ContentType, Platform } from "./types.ts";
import { copyRatio } from "./copy-check.ts";

export type HotSourceId = "weibo" | "douyin" | "zhihu" | "bilibili" | "toutiao" | "baidu";

export interface HotSource {
  id: HotSourceId;
  name: string;
  url: string;
}

export const HOT_SOURCES: HotSource[] = [
  { id: "weibo", name: "微博", url: "https://60s.viki.moe/v2/weibo" },
  { id: "douyin", name: "抖音", url: "https://60s.viki.moe/v2/douyin" },
  { id: "toutiao", name: "头条", url: "https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc" },
  { id: "zhihu", name: "知乎", url: "https://api.zhihu.com/topstory/hot-list?limit=50" },
  { id: "bilibili", name: "B站", url: "https://api.bilibili.com/x/web-interface/wbi/search/square?limit=30" },
  { id: "baidu", name: "百度", url: "https://top.baidu.com/api/board?platform=wise&tab=realtime" },
];

export interface HotItem {
  id: string;
  source: HotSourceId;
  title: string;
  url: string;
  heat: number;
  rank: number;
}

export const HOT_MAX_PER_SOURCE = 50;
export const HOT_CACHE_MS = 10 * 60000;
const TITLE_MAX = 200;

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown) => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return 0;
  const m = v.replace(/,/g, "").match(/([\d.]+)\s*(万|亿)?/);
  if (!m) return 0;
  const base = Number(m[1]);
  if (!Number.isFinite(base)) return 0;
  return m[2] === "亿" ? base * 1e8 : m[2] === "万" ? base * 1e4 : base;
};
const httpUrl = (v: unknown) => {
  const s = str(v);
  return /^https?:\/\//i.test(s) ? s.slice(0, 1000) : "";
};

const BAIDU_TOP_HEAT = 5e6;

function rankHeat(index: number, total: number) {
  return Math.round(BAIDU_TOP_HEAT * (1 - index / Math.max(total, 1)));
}

export function parseBigIdJson(text: string): unknown {
  return JSON.parse(text.replace(/("id"\s*:\s*)(\d{16,})/g, '$1"$2"'));
}

function rawItems(source: HotSourceId, body: unknown): Array<{ title: string; url: string; heat: number }> {
  if (!isRecord(body)) return [];
  const data = body.data;
  switch (source) {
    case "weibo":
    case "douyin":
      return Array.isArray(data) ? data.filter(isRecord).map((x) => ({ title: str(x.title), url: httpUrl(x.link), heat: num(x.hot_value) })) : [];
    case "toutiao":
      return Array.isArray(data) ? data.filter(isRecord).map((x) => ({ title: str(x.Title), url: httpUrl(x.Url), heat: num(x.HotValue) })) : [];
    case "zhihu":
      return Array.isArray(data)
        ? data.filter(isRecord).map((x) => {
            const t = isRecord(x.target) ? x.target : {};
            const fromCard = typeof x.card_id === "string" ? x.card_id.replace(/^Q_/, "") : "";
            const raw = typeof t.id === "string" ? t.id : typeof t.id === "number" && Number.isSafeInteger(t.id) ? String(t.id) : "";
            const id = /^\d+$/.test(fromCard) ? fromCard : /^\d+$/.test(raw) ? raw : "";
            return { title: str(t.title), url: id ? "https://www.zhihu.com/question/" + id : "", heat: num(x.detail_text) };
          })
        : [];
    case "bilibili": {
      const list = isRecord(data) && isRecord(data.trending) && Array.isArray(data.trending.list) ? data.trending.list : [];
      return list.filter(isRecord).map((x) => {
        const title = str(x.show_name) || str(x.keyword);
        return { title, url: title ? "https://search.bilibili.com/all?keyword=" + encodeURIComponent(title) : "", heat: num(x.heat_score) };
      });
    }
    case "baidu": {
      const cards = isRecord(data) && Array.isArray(data.cards) ? data.cards : [];
      const first = isRecord(cards[0]) && Array.isArray(cards[0].content) ? cards[0].content : [];
      const list = isRecord(first[0]) && Array.isArray(first[0].content) ? first[0].content : first;
      const rows = list.filter(isRecord).filter((x) => x.isTop !== true);
      return rows.map((x, i) => ({ title: str(x.word) || str(x.query), url: httpUrl(x.url), heat: num(x.hotScore) || num(x.hotTag) || rankHeat(i, rows.length) }));
    }
  }
}

export function parseHotList(source: HotSourceId, body: unknown): HotItem[] {
  const seen = new Set<string>();
  const out: HotItem[] = [];
  for (const raw of rawItems(source, body)) {
    const title = raw.title.replace(/\s+/g, " ").slice(0, TITLE_MAX);
    if (!title || seen.has(title)) continue;
    seen.add(title);
    out.push({ id: source + ":" + title, source, title, url: raw.url, heat: raw.heat, rank: out.length + 1 });
    if (out.length >= HOT_MAX_PER_SOURCE) break;
  }
  return out;
}

export const DEFAULT_HOT_TOPICS: Array<{ pattern: string; label: string }> = [
  { pattern: "习近平|总书记|国家主席|总理|政治局|中央|国务院|外交部|两会|人大|政协|普京|特朗普|拜登|泽连斯基|内塔尼亚胡|APEC|亚太|峰会|会晤|元首|领导人|大使|制裁|关税战|外交|访华|国事", label: "时政/涉领土话题" },
  { pattern: "台独|港独|藏独|疆独|新疆|西藏|台湾|香港|涉台|涉港", label: "时政/涉领土话题" },
  { pattern: "战争|空袭|导弹|军演|冲突|袭击|恐袭|爆炸|枪击", label: "军事冲突话题" },
  { pattern: "遇难|死亡|身亡|去世|逝世|坠亡|溺亡|遇害|命案|杀害|自杀|轻生|跳楼", label: "灾难伤亡话题" },
  { pattern: "地震|火灾|洪水|台风|泥石流|塌方|事故|车祸|空难|坍塌|爆燃", label: "灾难伤亡话题" },
  { pattern: "疫情|确诊|病毒|传染|疫苗", label: "公共卫生话题" },
  { pattern: "被查|落马|双开|受贿|贪污|立案|判处|死刑|公诉|通缉|逮捕|刑拘|调查组|通报|约谈|曝光|处分|问责|整改", label: "司法/反腐话题" },
  { pattern: "股价|股市|A股|沪指|深成指|创业板指|恒指|大盘|涨停|跌停|暴涨|暴跌|爆雷|理财|基金|证监会|币圈|比特币|国民经济|GDP|CPI|PPI|央行|降息|加息|降准|汇率|人民币", label: "金融投资话题" },
  { pattern: "治愈|神药|偏方|根治|抗癌|癌症|肿瘤|白血病|患者|病人|处方|药物|口服药|靶向|化疗|手术|医院|医生|医保|康复", label: "医疗健康话题" },
];

let activeTopics: Array<{ re: RegExp; label: string }> = compileTopics(DEFAULT_HOT_TOPICS);

function compileTopics(list: Array<{ pattern: string; label: string }>) {
  const out: Array<{ re: RegExp; label: string }> = [];
  for (const r of list) {
    try {
      out.push({ re: new RegExp(r.pattern, "iu"), label: r.label });
    } catch {
      void 0;
    }
  }
  return out;
}

export function setHotTopicRules(list: Array<{ pattern: string; label: string }> | undefined) {
  const compiled = list && list.length ? compileTopics(list) : [];
  activeTopics = compiled.length ? compiled : compileTopics(DEFAULT_HOT_TOPICS);
}

export function topicRisk(title: string): string | undefined {
  return activeTopics.find((r) => r.re.test(title))?.label;
}

export interface AccountProfile {
  accountId: string;
  niche: string;
  audience: string;
  tone: string;
  keywords: string[];
  avoid: string[];
  winning: string;
  updatedAt: string;
}

export const PROFILE_TEXT_MAX = 200;
export const PROFILE_KEYWORDS_MAX = 20;
export const WINNING_MAX = 400;

const words = (v: unknown, max: number) =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,，、\s]+/) : [])
    .map((x) => str(x).slice(0, 20))
    .filter(Boolean)
    .filter((x, i, a) => a.indexOf(x) === i)
    .slice(0, max);

export function parseProfile(value: unknown): AccountProfile | undefined {
  if (!isRecord(value) || !str(value.accountId)) return undefined;
  return {
    accountId: str(value.accountId),
    niche: str(value.niche).slice(0, PROFILE_TEXT_MAX),
    audience: str(value.audience).slice(0, PROFILE_TEXT_MAX),
    tone: str(value.tone).slice(0, PROFILE_TEXT_MAX),
    keywords: words(value.keywords, PROFILE_KEYWORDS_MAX),
    avoid: words(value.avoid, PROFILE_KEYWORDS_MAX),
    winning: str(value.winning).slice(0, WINNING_MAX),
    updatedAt: str(value.updatedAt) || new Date(0).toISOString(),
  };
}

export function parseProfiles(value: unknown): AccountProfile[] {
  return Array.isArray(value) ? value.map(parseProfile).filter((p): p is AccountProfile => Boolean(p)) : [];
}

const grams2 = (s: string) => {
  const chars = Array.from(s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, ""));
  const out = new Set<string>();
  for (let i = 0; i + 2 <= chars.length; i++) out.add(chars[i] + chars[i + 1]);
  return out;
};

export interface ScoredTopic extends HotItem {
  score: number;
  match: string[];
  risk?: string;
}

export function scoreTopics(items: HotItem[], profile: Pick<AccountProfile, "keywords" | "avoid" | "niche"> | undefined): ScoredTopic[] {
  const keys = profile ? [...new Set([...profile.keywords, ...profile.niche.split(/[,，、\s]+/)].map((k) => k.trim()).filter((k) => k.length >= 2))] : [];
  const avoid = profile ? profile.avoid.filter((k) => k.length >= 1) : [];
  const maxHeat = Math.max(1, ...items.map((i) => i.heat));
  return items
    .map((item) => {
      const risk = topicRisk(item.title) || (avoid.find((a) => item.title.includes(a)) ? "命中账号禁区词" : undefined);
      const match = keys.filter((k) => item.title.includes(k));
      const title = grams2(item.title);
      const fuzzy = keys.reduce((acc, k) => {
        const g = grams2(k);
        if (!g.size) return acc;
        let hit = 0;
        for (const x of g) if (title.has(x)) hit++;
        return Math.max(acc, hit / g.size);
      }, 0);
      const relevance = match.length ? 1 : fuzzy >= 0.5 ? fuzzy * 0.6 : 0;
      const heat = Math.log10(1 + item.heat) / Math.log10(1 + maxHeat);
      const position = 1 - Math.min(item.rank, 50) / 60;
      const score = Math.round((keys.length ? relevance * 60 : 0) + heat * 25 + position * 15);
      return { ...item, score: risk ? 0 : score, match, ...(risk ? { risk } : {}) };
    })
    .sort((a, b) => b.score - a.score || a.rank - b.rank);
}

export const MATRIX_SIMILAR_AT = 0.55;

export interface SimilarPair {
  a: number;
  b: number;
  ratio: number;
}

export function matrixSimilarity(texts: string[], threshold = MATRIX_SIMILAR_AT): SimilarPair[] {
  const out: SimilarPair[] = [];
  for (let i = 0; i < texts.length; i++)
    for (let j = i + 1; j < texts.length; j++) {
      const ratio = Math.max(copyRatio(texts[i], texts[j]), copyRatio(texts[j], texts[i]));
      if (ratio >= threshold) out.push({ a: i, b: j, ratio });
    }
  return out;
}

export interface GeneratedPiece {
  accountId: string;
  platform: Platform;
  title: string;
  description: string;
  topics: string[];
}

const TOPIC_MAX = 10;

export function parseGenerated(text: string): Omit<GeneratedPiece, "accountId" | "platform"> | undefined {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    const v = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    const title = str(v.title);
    const description = str(v.body) || str(v.description) || str(v.content);
    if (!title || !description) return undefined;
    const topics = words(v.topics, TOPIC_MAX).map((t) => t.replace(/^#+/, ""));
    return { title, description, topics };
  } catch {
    return undefined;
  }
}

export const HOT_TYPES: ContentType[] = ["image_text"];

export const FADE_SECONDS = 0.5;

export function slideshowArgs(images: string[], output: string, opts: { width: number; height: number; seconds: number; fps?: number }): string[] {
  const fps = opts.fps ?? 30;
  const d = Math.max(FADE_SECONDS + 0.5, opts.seconds);
  const args: string[] = ["-y"];
  for (const img of images) args.push("-loop", "1", "-t", String(d), "-i", img);
  args.push("-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo");
  const prep = images.map((_, i) => "[" + i + ":v]scale=" + opts.width + ":" + opts.height + ":force_original_aspect_ratio=decrease,pad=" + opts.width + ":" + opts.height + ":(ow-iw)/2:(oh-ih)/2,setsar=1,fps=" + fps + ",format=yuv420p[v" + i + "]");
  const chain: string[] = [];
  let last = "v0";
  for (let i = 1; i < images.length; i++) {
    const out = i === images.length - 1 ? "vout" : "x" + i;
    chain.push("[" + last + "][v" + i + "]xfade=transition=fade:duration=" + FADE_SECONDS + ":offset=" + (i * (d - FADE_SECONDS)).toFixed(2) + "[" + out + "]");
    last = out;
  }
  const final = images.length === 1 ? "v0" : "vout";
  const total = images.length * d - (images.length - 1) * FADE_SECONDS;
  args.push("-filter_complex", [...prep, ...chain].join(";"));
  args.push("-map", "[" + final + "]", "-map", images.length + ":a", "-t", total.toFixed(2));
  args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", output);
  return args;
}

const POINT_MAX = 42;
const POINTS_MAX = 5;

export function splitPoints(body: string): string[] {
  const out: string[] = [];
  const lines = body
    .split(/\n+|(?=\s*\d+[.、)）]\s*)/u)
    .map((l) => l.replace(/^[\s\-*#>·•]+/u, "").replace(/^\d+[.、)）]\s*/u, "").replace(/^[①-⑩]\s*/u, "").replace(/^(结论前置|结论|先说结论|总结|划重点|重点|注意)[：:]\s*/u, "").trim())
    .filter((l) => Array.from(l).length >= 6);
  for (const line of lines) {
    const head = line.split(/(?<=[。！？!?；;：:])/u)[0].trim();
    const pick = Array.from(head).length >= 6 ? head : line;
    const chars = Array.from(pick);
    const text = (chars.length > POINT_MAX ? chars.slice(0, POINT_MAX - 1).join("") + "…" : pick).replace(/[。；;：:]$/u, "");
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= POINTS_MAX) break;
  }
  return out;
}

export const SAFETY_NOTICE = [
  "热点创作生成的每一篇都会自动勾选「含 AI 生成内容」声明，不能取消——这是《人工智能生成合成内容标识办法》的要求，小红书、抖音对未标识的 AI 内容会限流。",
  "生成的内容先进「待审箱」，你确认后才会存成草稿或进入定时发布。不要不看就发。",
  "同一热点发到多个账号时，软件会检查账号之间内容是否太像（超过 55% 不允许一起发），避免被平台判定为矩阵同质化内容。",
  "时政、涉领土、战争灾难、伤亡、疫情、司法反腐、股市理财、医疗功效类热点不会推荐，也不允许生成。",
  "小红书、抖音明确禁止用 AI 编造新闻热点、批量刷内容。热点只作为切入点，内容要结合账号自己的领域给出观点或经验，不要只复述事件。",
].join("\n");
