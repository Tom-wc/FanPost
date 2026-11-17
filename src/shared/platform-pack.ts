import type { ContentType, Platform } from "./types.ts";
import { platforms } from "./platforms.ts";

export interface PackSubmitRule {
  texts: string[];
  scope?: string;
  confirm?: string[];
  done: RegExp;
}

export interface PlatformPack {
  version: string;
  article: Partial<Record<Platform, string>>;
  submit: Partial<Record<Platform, Partial<Record<ContentType, PackSubmitRule>>>>;
  flows?: string;
}

const ids = new Set<string>(platforms.map((p) => p.id));
const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function parseRule(v: unknown): PackSubmitRule | undefined {
  if (!isRecord(v) || typeof v.done !== "string") return undefined;
  const texts = strings(v.texts);
  if (!texts.length) return undefined;
  try {
    return { texts, ...(typeof v.scope === "string" ? { scope: v.scope } : {}), ...(Array.isArray(v.confirm) ? { confirm: strings(v.confirm) } : {}), done: new RegExp(v.done) };
  } catch {
    return undefined;
  }
}

export function parsePack(text: string): PlatformPack | undefined {
  try {
    const p = JSON.parse(text) as Record<string, unknown>;
    if (p.kind !== "pack" || typeof p.version !== "string" || !isRecord(p.article) || !isRecord(p.submit)) return undefined;
    const article: PlatformPack["article"] = {};
    for (const [k, v] of Object.entries(p.article)) if (ids.has(k) && typeof v === "string") article[k as Platform] = v;
    const submit: PlatformPack["submit"] = {};
    for (const [k, types] of Object.entries(p.submit)) {
      if (!ids.has(k) || !isRecord(types)) continue;
      const out: Partial<Record<ContentType, PackSubmitRule>> = {};
      for (const t of ["video", "image_text"] as const) {
        const r = parseRule(types[t]);
        if (r) out[t] = r;
      }
      submit[k as Platform] = out;
    }
    return { version: p.version, article, submit, ...(typeof p.flows === "string" && p.flows ? { flows: p.flows } : {}) };
  } catch {
    return undefined;
  }
}

export const PACK_MISSING = "平台脚本还没下载到本机（或授权已失效），请联网后到设置里点「重新验证」再发布。";
