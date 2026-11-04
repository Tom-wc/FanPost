import { clipboard, type WebContents } from "electron";
import path from "node:path";
import type { Account, PublishDraft } from "../../shared/types";
import { platformMap } from "../../shared/platforms";
import { writeBrowserLog } from "../log-bus";
import {
  buildArticleContext,
  fillExpression,
  articleScriptFor,
  parseArticleScript,
  readyExpression,
  type ArticleContext,
  type ArticleScriptMeta,
} from "../article-scripts";
import { attach, cdp, sleep } from "./cdp";
import { chooseFilesFromButton, dispatchFileChange, getFileInputs, setFileInput, waitForFileInputs } from "./dom";
import { ignoreAborted, type PublishProgress, type PublishResult } from "./common";
import { withInputLock } from "../input-lock";
import { fitCover } from "../video-cover";
import { flows } from "../flow-runtime";

async function runArticleFill(wc: WebContents, code: string, ctx: ArticleContext, images: string[] = [], cover?: string) {
  let finished = false;
  const fill = wc
    .executeJavaScript(fillExpression(code, ctx))
    .then((x) => String(x))
    .catch((e) => "err:" + e)
    .finally(() => (finished = true));
  while (!finished) {
    await sleep(100);
    const req = await wc
      .executeJavaScript("(()=>{const r=window.__lcInputReq;if(!r||r.taken||r.done)return null;r.taken=true;return{kind:r.kind,text:r.text,html:r.html,count:r.count,start:r.start,raw:r.raw}})()")
      .catch(() => null);
    if (!req) continue;
    if (req.kind === "images" || req.kind === "cover") {
      const from = images.slice(Math.max(0, Number(req.start) || 0));
      const picked = req.kind === "cover" ? (cover ? [cover] : []) : req.count > 0 ? from.slice(0, req.count) : from;
      const ok = await injectImageInput(wc, picked, !!req.raw).catch((e) => {
        void writeBrowserLog("article-image-inject-fail err=" + (e?.message || e));
        return false;
      });
      await wc.executeJavaScript(`(()=>{if(window.__lcInputReq){window.__lcInputReq.ok=${ok ? "true" : "false"};window.__lcInputReq.done=true}return 1})()`).catch(() => undefined);
      continue;
    }
    await withInputLock(async () => {
      if (!wc.isFocused()) wc.focus();
      if (req.kind === "key") {
        const key = String(req.text);
        const codes: Record<string, number> = { Enter: 13, Escape: 27, End: 35 };
        const base = { key, code: key, windowsVirtualKeyCode: codes[key] || 0, nativeVirtualKeyCode: codes[key] || 0 };
        await cdp(wc, "Input.dispatchKeyEvent", { type: "keyDown", ...base, ...(key === "Enter" ? { text: "\r" } : {}) });
        await cdp(wc, "Input.dispatchKeyEvent", { type: "keyUp", ...base });
        return;
      }
      if (req.kind !== "paste") return wc.insertText(req.text);
      const saved = { text: clipboard.readText(), html: clipboard.readHTML() };
      clipboard.write({ text: req.text, html: req.html || undefined });
      wc.paste();
      await sleep(300);
      clipboard.write({ text: saved.text, html: saved.html || undefined });
    });
    await wc.executeJavaScript("(()=>{if(window.__lcInputReq)window.__lcInputReq.done=true;return 1})()").catch(() => undefined);
  }
  return fill;
}

const DISPATCH_MARKED_CHANGE =
  "(()=>{const i=document.querySelector('input[type=file][data-lc-upload]');if(i){i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}))}return 1})()";

async function injectImageInput(wc: WebContents, images: string[], raw = false) {
  if (!images.length) return false;
  for (let i = 0; i < 20; i++) {
    const inputs = await getFileInputs(wc).catch(() => []);
    const input = inputs.find((x) => x.attributes["data-lc-upload"]) || [...inputs].reverse().find((x) => /image/i.test(x.accept));
    if (input) {
      await setFileInput(wc, input.nodeId, images);
      if (raw) return true;
      if (input.attributes["data-lc-upload"]) await wc.executeJavaScript(DISPATCH_MARKED_CHANGE).catch(() => undefined);
      else await dispatchFileChange(wc);
      return true;
    }
    await sleep(500);
  }
  return false;
}

const ASSIST_ARM_MS = 30 * 60 * 1000;

function prepareManualAssist(wc: WebContents, caption: string, files: string[]) {
  if (caption.trim()) void withInputLock(async () => clipboard.writeText(caption));
  if (files.length) void armUploadOnClick(wc, files.map((f) => path.resolve(f)));
}

async function armUploadOnClick(wc: WebContents, files: string[]) {
  if (wc.isDestroyed()) return;
  const api = attach(wc);
  const disarm = () => {
    clearTimeout(timer);
    api.removeListener("message", listener);
    wc.removeListener("did-start-navigation", onNavigate);
    if (!wc.isDestroyed()) void cdp(wc, "Page.setInterceptFileChooserDialog", { enabled: false }).catch(() => undefined);
  };
  const listener = (_event: Electron.Event, method: string, params: { backendNodeId?: number; mode?: string }) => {
    if (method !== "Page.fileChooserOpened" || !params?.backendNodeId) return;
    disarm();
    const chosen = params.mode === "selectSingle" ? files.slice(0, 1) : files;
    void setFileInput(wc, params.backendNodeId, chosen)
      .then(() => dispatchFileChange(wc))
      .then(() => writeBrowserLog("assist-upload-filled files=" + chosen.length))
      .catch((e) => writeBrowserLog("assist-upload-fail err=" + (e?.message || e)));
  };
  const onNavigate = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
    if (details.isMainFrame && !details.isSameDocument) disarm();
  };
  const timer = setTimeout(disarm, ASSIST_ARM_MS);
  api.on("message", listener);
  try {
    await cdp(wc, "Page.enable");
    await cdp(wc, "DOM.enable");
    await cdp(wc, "Page.setInterceptFileChooserDialog", { enabled: true });
    wc.on("did-start-navigation", onNavigate);
  } catch (e) {
    disarm();
    void writeBrowserLog("assist-upload-arm-fail err=" + String(e));
  }
}

const joinCaption = (...parts: Array<string | undefined>) => parts.filter((x) => x && x.trim()).join("\n\n");

export function assistedMessage(account: Account, draft: PublishDraft, wc: WebContents): PublishResult {
  const tag = (t: string) => (account.platform === "weibo" ? "#" + t.replace(/^#|#$/g, "") + "#" : t.startsWith("#") ? t : "#" + t);
  const topics = (draft.topics || []).map(tag).join(" ");
  const files = draft.mediaPaths || [];
  prepareManualAssist(wc, joinCaption(draft.title, draft.description, topics), files);
  const what = draft.type === "video" ? "点页面上的「上传视频」会自动选好视频" : "点页面上的「上传图片」会自动选好这 " + files.length + " 张图";
  return {
    status: "manual_required",
    message: platformMap[account.platform].name + "官方发布页已打开，文案已复制到剪贴板（直接粘贴）" + (files.length ? "，" + what : "") + "。请检查后由你本人手动点击发布。",
  };
}

async function uploadImages(wc: WebContents, meta: ArticleScriptMeta, images: string[], account: Account) {
  await sleep(3000);
  if (meta.uploadButton?.length) {
    const injected = await chooseFilesFromButton(wc, meta.uploadButton, images, meta.uploadSelectors).catch((e) => {
      void writeBrowserLog("article-upload-button-fail account=" + account.id + " err=" + (e?.message || e));
      return false;
    });
    if (injected) return true;
  }
  const inputs = await waitForFileInputs(wc, meta.uploadButton?.length ? 15000 : 30000);
  const input = inputs.find((i) => /image/i.test(i.accept)) || inputs[0];
  if (!input) return false;
  await setFileInput(wc, input.nodeId, images);
  await dispatchFileChange(wc);
  return true;
}

async function waitArticleReady(wc: WebContents, code: string, meta: ArticleScriptMeta) {
  const tries = Math.max(1, Math.ceil(meta.readyTimeout / meta.readyInterval));
  for (let i = 0; i < tries; i++) {
    await sleep(meta.readyInterval);
    if (await wc.executeJavaScript(readyExpression(code)).then((x) => x === true).catch(() => false)) return true;
  }
  return false;
}

const ZHIHU_BROKEN_IMAGES =
  "(()=>{const ed=document.querySelector('.public-DraftEditor-content');if(!ed)return 0;let n=0;for(const i of ed.querySelectorAll('img')){const f=i.closest('figure');if((i.complete&&i.naturalWidth===0)||(f&&/加载失败/.test(f.innerText||''))){const s=(i.getAttribute('src')||'').replace(/&_r=[0-9]+$/,'');if(s)i.setAttribute('src',s+(s.includes('?')?'&':'?')+'_r='+Date.now());n++}}return n})()";
const ZHIHU_HEAL_ROUNDS = 5;
const ZHIHU_HEAL_WAIT_MS = 2500;

export async function healZhihuImages(wc: WebContents) {
  let broken = 0;
  for (let round = 0; round < ZHIHU_HEAL_ROUNDS; round++) {
    broken = Number(await wc.executeJavaScript(ZHIHU_BROKEN_IMAGES).catch(() => 0)) || 0;
    if (!broken) return 0;
    await writeBrowserLog("zhihu-image-heal round=" + round + " broken=" + broken);
    await sleep(ZHIHU_HEAL_WAIT_MS);
  }
  return broken;
}

const imageHint = (n: number, text: string) => (n ? "（本篇有" + n + "张配图，" + text + "）" : "");

function doneMessage(account: Account, meta: ArticleScriptMeta, n: number, inserted = 0) {
  const name = platformMap[account.platform].name;
  switch (account.platform) {
    case "weibo":
      if (!n) return "微博文案已自动填好。请检查后点击「发送」。";
      return inserted >= n
        ? "微博文案已自动填好，" + inserted + "张图也已上传。请检查后点击「发送」。"
        : "微博文案已自动填好，但图片只上传成功" + inserted + "/" + n + "张，请在发布框里点「图片」补齐。请检查后点击「发送」。";
    case "toutiao":
      if (!n) return "头条标题和正文已自动填好（请设置封面）。请检查后点击「预览并发布」。";
      return inserted >= n
        ? "头条标题、正文已填好，" + inserted + "张图已自动插入正文末尾。"
        : "头条标题和正文已自动填好，但自动插图只成功" + inserted + "/" + n + "张，请在正文中补齐并设置封面。请检查后点击「预览并发布」。";
    case "zhihu":
      if (!n) return "知乎标题和正文已自动填好。";
      return inserted >= n
        ? "知乎标题、正文已填好，" + inserted + "张图已自动插入正文末尾，封面为正文首图，话题已添加。"
        : "知乎标题和正文已自动填好，但自动插图只成功" + inserted + "/" + n + "张，请用工具栏「图片」补齐并设置封面。";
    case "baijiahao":
      if (!n) return "百家号标题和正文已自动填好。请检查后点击「发布」。";
      return inserted >= n
        ? "百家号标题、正文已填好，" + inserted + "张图也已自动插入正文。"
        : "百家号标题和正文已自动填好，但自动插图只成功" + inserted + "/" + n + "张，请在正文中手动补齐。";
    default:
      return meta.upload
        ? name + "图文已自动上传" + n + "张图并填好标题/描述。请检查后点击「发布」。"
        : name + "标题和正文已自动填好" + imageHint(n, "请手动插入") + "。请检查后点击「发布」。";
  }
}

async function makeCover(source: string | undefined, taskId: string) {
  if (!source) return undefined;
  return fitCover(source, 1440, 1080, taskId).catch((e) => {
    void writeBrowserLog("cover-fit-fail err=" + (e?.message || e));
    return undefined;
  });
}

const FIT_COVER: Account["platform"][] = ["baijiahao", "toutiao"];

function zhihuQuestionHint(title: unknown, miss: unknown) {
  if (title === "已有") return "投稿问题沿用页面已选的问题。";
  if (typeof title === "string" && title) return "已投稿至问题「" + title + "」。";
  if (miss === "spec") return "未找到你指定的问题，本次未投稿至问题。";
  if (miss === "none") return "没有找到相关度足够的问题，本次未投稿至问题。";
  if (miss) return "投稿至问题未完成，可在发布设置里手动选择。";
  return "";
}

async function withZhihuQuestion(wc: WebContents, ctx: ArticleContext): Promise<ArticleContext> {
  const id = ctx.question?.match(/question\/(\d+)/)?.[1];
  if (!id) return ctx;
  const title = await wc.session
    .fetch("https://www.zhihu.com/question/" + id)
    .then((r) => r.text())
    .then((html) => html.match(/<title[^>]*>([^<]+)<\/title>/)?.[1]?.replace(/\s*-\s*知乎\s*$/, "").trim())
    .catch(() => undefined);
  return { ...ctx, questionId: id, ...(title && !/安全验证|知乎$/.test(title) ? { questionTitle: title } : {}) };
}

export async function publishArticle(account: Account, draft: PublishDraft, progress: PublishProgress, wc: WebContents, publishUrl: string, taskId: string): Promise<PublishResult> {
  const name = platformMap[account.platform].name;
  await progress("opening", "正在打开" + name + "写文章页");
  const code = articleScriptFor(account.platform);
  if (!code)
    return { status: "manual_required", message: name + "发布页已打开，该平台图文暂不支持自动填写，请手动填写并发布。" };
  const parsed = parseArticleScript(code);
  if (!parsed.meta)
    return { status: "manual_required", message: name + "图文脚本有误：" + parsed.error + "，请手动填写并发布。" };
  const meta = parsed.meta;
  const ctx = account.platform === "zhihu" ? await withZhihuQuestion(wc, buildArticleContext(draft)) : buildArticleContext(draft);
  await wc.loadURL(meta.url || publishUrl).catch(ignoreAborted).catch(() => undefined);
  if (meta.upload && !ctx.images.length && !meta.uploadOptional)
    return { status: "failed", message: name + "图文需要至少一张图片，当前草稿无图片。" };
  if (meta.upload && ctx.images.length && !(await uploadImages(wc, meta, ctx.images, account)) && !meta.uploadButton?.length)
    return { status: "manual_required", message: name + "图文页未找到图片上传控件，请手动上传并发布。" };
  if (!(await waitArticleReady(wc, code, meta))) {
    void writeBrowserLog("article-not-ready account=" + account.id + " platform=" + account.platform);
    if (!meta.upload || !ctx.images.length)
      return { status: "manual_required", message: name + "写文章页未就绪（可能加载慢或改版）" + "，请手动填写并发布。" };
    prepareManualAssist(wc, joinCaption(ctx.title, ctx.body), ctx.images);
    return {
      status: "manual_required",
      message: name + "图文自动上传未生效（该平台上传方式特殊）。文案已复制到剪贴板；在页面上点「上传图片」会自动选好这 " + ctx.images.length + " 张图，粘贴文案后发布。",
    };
  }
  const cover = FIT_COVER.includes(account.platform) ? await makeCover(draft.coverPath || ctx.images[0], taskId) : undefined;
  const result = await runArticleFill(wc, code, { ...ctx, hasCover: !!cover }, ctx.images, cover);
  await sleep(meta.afterFillWait);
  void writeBrowserLog("article-fill account=" + account.id + " platform=" + account.platform + " result=" + result);
  if (result.startsWith("no"))
    return { status: "manual_required", message: name + "页面已打开，但未定位到编辑器(页面可能改版)" + "：" + result + "，请手动填写并发布。" };
  if (result.startsWith("err")) return { status: "manual_required", message: name + "自动填写出错" + "：" + result + "，请手动完成。" };
  let inserted = 0;
  let broken = 0;
  let questionHint = "";
  try {
    const parsed = JSON.parse(result);
    inserted = Number(parsed.images) || 0;
    broken = Number(parsed.broken) || 0;
    if (account.platform === "toutiao" && inserted >= ctx.imgCount && ctx.imgCount) questionHint = (parsed.cover ? (parsed.coverFit ? "封面已按首图生成 4:3 完整版（单图）。" : "封面为平台默认裁切的首图（单图），可点「替换」调整。") : "封面未设置成功，请在「展示封面」里手动选择。") + "请检查后点击「预览并发布」。";
    if (account.platform === "baijiahao") questionHint = (parsed.cover ? (parsed.coverFit ? "封面已按首图生成 4:3 完整版（单图）。" : "封面为平台默认裁切的首图（单图），可点「更换」调整。") : "封面未设置成功，请在「设置封面」里手动选择。") + "请检查后点击「发布」。";
    if (account.platform === "zhihu") questionHint = zhihuQuestionHint(parsed.question, parsed.questionMiss) + "请检查后点击右上角「发布」。";
  } catch { inserted = 0; }
  if (account.platform === "zhihu" && inserted) broken = await healZhihuImages(wc);
  const brokenHint = broken
    ? "注意：其中" + broken + "张图暂时显示「加载失败」（平台刚上传完还在处理），请稍后刷新页面确认图片正常再发布。"
    : "";
  const f = flows();
  const declareHint = await f.applyDeclaration(wc, account.platform, "image_text", draft.declaration);
  const originalHint = await f.applyOriginal(wc, account.platform, draft.original);
  const musicHint = await f.addMusic(wc, account.platform, "image_text");
  const checkHint = await f.runContentCheck(wc, account.platform, "image_text");
  return { status: "manual_required", message: doneMessage(account, meta, ctx.imgCount, inserted) + questionHint + declareHint + originalHint + musicHint + brokenHint + checkHint };
}
