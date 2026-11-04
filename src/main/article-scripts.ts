import vm from "node:vm";
import type { Platform, PublishDraft } from "../shared/types";
import { currentPack } from "./platform-pack.ts";


export interface ArticleContext {
  title: string;
  body: string;
  bodyHtml: string;
  plainBody: string;
  plainBodyHtml: string;
  description: string;
  topics: string[];
  images: string[];
  imgCount: number;
  question?: string;
  questionId?: string;
  questionTitle?: string;
  hasCover?: boolean;
}
export interface ArticleScriptMeta {
  url?: string;
  upload: boolean;
  uploadOptional: boolean;
  uploadButton?: string[];
  uploadSelectors?: string[];
  readyTimeout: number;
  readyInterval: number;
  afterFillWait: number;
}

export const articleScriptFor = (platform: Platform): string | undefined => currentPack()?.article[platform];

const asExpression = (code: string) =>
  "(" + code.trim().replace(/;+\s*$/, "") + "\n)";

export function parseArticleScript(code: string): {
  meta?: ArticleScriptMeta;
  error?: string;
} {
  try {
    const obj = vm.runInNewContext(asExpression(code), {}, { timeout: 1000 });
    if (!obj || typeof obj !== "object") return { error: "脚本必须是一个对象字面量 ({ ... })" };
    if (typeof obj.fill !== "function") return { error: "脚本缺少 fill(ctx, h) 函数" };
    const num = (v: unknown, d: number) =>
      typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : d;
    const strings = (v: unknown) =>
      Array.isArray(v)
        ? Array.from(v as unknown[]).filter(
            (x: unknown): x is string => typeof x === "string" && !!x.trim(),
          )
        : [];
    const uploadButton = strings(obj.uploadButton);
    const uploadSelectors = strings(obj.uploadSelectors);
    return {
      meta: {
        url: typeof obj.url === "string" && obj.url.trim() ? obj.url.trim() : undefined,
        upload: obj.upload === true,
        uploadOptional: obj.uploadOptional === true,
        uploadButton: uploadButton.length ? uploadButton : undefined,
        uploadSelectors: uploadSelectors.length ? uploadSelectors : undefined,
        readyTimeout: num(obj.readyTimeout, 12000),
        readyInterval: Math.max(200, num(obj.readyInterval, 1000)),
        afterFillWait: num(obj.afterFillWait, 2000),
      },
    };
  } catch (error) {
    return { error: "脚本解析失败：" + (error instanceof Error ? error.message : String(error)) };
  }
}

export const readyExpression = (code: string) =>
  "(()=>{try{const s=" + asExpression(code) +
  ";return typeof s.ready==='function'?!!s.ready():true}catch(e){return false}})()";

export const INPUT_BRIDGE_TIMEOUT = 8000;
const pageHelpers =
  "const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));" +
  "const pause=(min=300,max=900)=>sleep(min+Math.random()*(max-min));" +
  "const selectAll=(el,atEnd)=>{el.focus();if(el.tagName==='TEXTAREA'||el.tagName==='INPUT'){atEnd?el.setSelectionRange(el.value.length,el.value.length):el.select()}else{const r=document.createRange();r.selectNodeContents(el);if(atEnd)r.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(r)}};" +
  "const bridge=async(el,req,fallback,atEnd)=>{if(atEnd!=='keep')selectAll(el,atEnd);window.__lcInputReq=req;const t0=Date.now();while(!(window.__lcInputReq&&window.__lcInputReq.done)){if(Date.now()-t0>" +
  INPUT_BRIDGE_TIMEOUT +
  "){window.__lcInputReq=null;fallback();return false}await sleep(50)}window.__lcInputReq=null;await sleep(150);return true};" +
  "const uploadFiles=async(target,req)=>{document.querySelectorAll('[data-lc-upload]').forEach(e=>e.removeAttribute('data-lc-upload'));if(target)target.setAttribute('data-lc-upload','1');window.__lcInputReq=req;const t0=Date.now();while(!(window.__lcInputReq&&window.__lcInputReq.done)){if(Date.now()-t0>20000){window.__lcInputReq=null;return false}await sleep(50)}const ok=window.__lcInputReq.ok!==false;window.__lcInputReq=null;await sleep(150);return ok};" +
  "const uploadImages=(target,count)=>uploadFiles(target,{kind:'images',count:count||0});" +
  "const uploadImagesFrom=(target,start)=>uploadFiles(target,{kind:'images',count:0,start:start||0});" +
  "const uploadCover=(target,raw)=>uploadFiles(target,{kind:'cover',raw:!!raw});" +
  "const pressKey=async(k)=>{window.__lcInputReq={kind:'key',text:k};const t0=Date.now();while(!(window.__lcInputReq&&window.__lcInputReq.done)){if(Date.now()-t0>5000){window.__lcInputReq=null;return false}await sleep(50)}window.__lcInputReq=null;await sleep(150);return true};" +
  "const h={sleep,pause,uploadImages,uploadImagesFrom,uploadCover,pressKey," +
  "type:(el,text,keep)=>bridge(el,{kind:'text',text},()=>document.execCommand('insertText',false,text),keep)," +
  "paste:(el,text,html)=>bridge(el,{kind:'paste',text,html:html||''},()=>document.execCommand('insertText',false,text))," +
  "append:(el,text)=>bridge(el,{kind:'text',text},()=>document.execCommand('insertText',false,text),true)};";

export const fillExpression = (code: string, ctx: ArticleContext) =>
  "(async()=>{try{const s=" + asExpression(code) +
  ";" + pageHelpers + "const r=await s.fill(" +
  JSON.stringify(ctx) +
  ",h);return typeof r==='string'?r:JSON.stringify(r)}catch(e){return 'err:'+(e&&e.message||e)}})()";

export function buildArticleContext(draft: Pick<PublishDraft, "title" | "description" | "topics" | "mediaPaths" | "question">): ArticleContext {
  const title = (draft.title || "").replace(/`/g, "'").slice(0, 100);
  const topicText = (draft.topics || [])
    .map((t) => (t.startsWith("#") ? t : "#" + t))
    .join(" ");
  const body = [draft.description || "", topicText]
    .filter((x) => x && x.trim())
    .join("\n\n")
    .replace(/`/g, "'");
  const toHtml = (text: string) =>
    text
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => "<p>" + l.replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</p>")
      .join("");
  const bodyHtml = toHtml(body);
  const plainBody = (draft.description || "").replace(/`/g, "'");
  const images = (draft.mediaPaths || []).filter((p) => p && p.trim());
  return {
    title,
    body,
    bodyHtml,
    plainBody,
    plainBodyHtml: toHtml(plainBody),
    description: draft.description || "",
    topics: draft.topics || [],
    images,
    imgCount: images.length,
    ...(draft.question ? { question: draft.question } : {}),
  };
}

