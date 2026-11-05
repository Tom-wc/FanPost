import type { WebContents } from "electron";
import type { ContentType, Platform } from "../../shared/types";
import { flatDocument, indexNodes, mouseClick, nodeBox, parentOf, pressKey, readAttrs, backendId, sleep } from "./cdp";
import { submitRuleFor } from "../submit-rules";
import { writeBrowserLog } from "../log-bus";

const findTarget = (texts: string[], scope: string) =>
  "(()=>{const all=root=>{const r=[];for(const e of root.querySelectorAll('*')){r.push(e);if(e.shadowRoot)r.push(...all(e.shadowRoot))}return r};const v=e=>!!e&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';const want=" +
  JSON.stringify(texts) +
  ";const els=all(document).filter(e=>e.matches&&e.matches(" +
  JSON.stringify(scope) +
  ")&&v(e)&&want.includes((e.innerText||e.textContent||'').trim())&&!e.disabled&&!/disabled/.test(String(e.className)));const el=els.sort((a,b)=>b.getBoundingClientRect().y-a.getBoundingClientRect().y)[0];if(!el)return null;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()";

const SUBMIT_SETTLE_MS = 20000;

async function pierceTarget(wc: WebContents, texts: string[]) {
  const nodes = await flatDocument(wc).catch(() => []);
  const byId = indexNodes(nodes);
  let best: { x: number; y: number } | null = null;
  for (const text of nodes.filter((n) => n.nodeName === "#text" && texts.includes((n.nodeValue || "").trim()))) {
    let n = parentOf(byId, text);
    while (n && n.nodeName !== "BUTTON") n = parentOf(byId, n);
    if (!n) continue;
    const attrs = readAttrs(n);
    if (attrs.has("disabled") || attrs.get("aria-disabled") === "true" || /disabled/.test(attrs.get("class") || "")) continue;
    const box = await nodeBox(wc, { backendNodeId: backendId(n) });
    if (box && box.area > 100 && (!best || box.y > best.y)) best = { x: box.x, y: box.y };
  }
  return best;
}
const pageText = "(document.body.innerText||'').slice(0,4000)+' '+location.href";
const UNCOVER_TRIES = 3;
const coverAt = (x: number, y: number, texts: string[]) =>
  "(()=>{const want=" + JSON.stringify(texts) + ";let h=document.elementFromPoint(" + x + "," + y + ");while(h&&h.shadowRoot){const i=h.shadowRoot.elementFromPoint(" + x + "," + y + ");if(!i||i===h)break;h=i}if(!h)return 'nothing';for(let p=h;p;p=p.parentElement)if(want.includes((p.innerText||p.textContent||'').trim()))return '';return (h.tagName+'.'+String(h.className||'')).slice(0,60)})()";
const CLOSE_POINT = (x: number, y: number) =>
  "(()=>{const v=e=>!!e&&e.getClientRects().length>0;const cls=e=>String(e.className&&e.className.baseVal!==undefined?e.className.baseVal:e.className||'');let h=document.elementFromPoint(" + x + "," + y + ");while(h&&h.shadowRoot){const i=h.shadowRoot.elementFromPoint(" + x + "," + y + ");if(!i||i===h)break;h=i}let layer=null;for(let p=h;p;p=p.parentElement)if(/drawer|modal|dialog|popup|overlay|mask/i.test(cls(p))){layer=p}if(!layer)return null;const c=[...layer.querySelectorAll('[class*=drawer-close],[class*=modal-close],[class*=dialog-close],[class*=close-btn],[class*=close-icon],[class*=closeBtn],[aria-label=Close],[aria-label=关闭]')].filter(v).pop();if(!c)return null;const b=c.getBoundingClientRect();return{x:b.left+b.width/2,y:b.top+b.height/2}})()";
const MASK_POINT =
  "(()=>{const isMask=e=>!!e&&/mask|overlay|backdrop/i.test(String(e.className&&e.className.baseVal!==undefined?e.className.baseVal:e.className||''));for(const [fx,fy] of [[0.05,0.5],[0.05,0.1],[0.5,0.05]]){const x=innerWidth*fx,y=innerHeight*fy;if(isMask(document.elementFromPoint(x,y)))return{x,y}}return null})()";

async function clickPoint(wc: WebContents, script: string) {
  const p = (await wc.executeJavaScript(script).catch(() => null)) as { x: number; y: number } | null;
  if (p) await mouseClick(wc, p.x, p.y);
}

async function uncover(wc: WebContents, point: { x: number; y: number }, texts: string[]) {
  let cover = String(await wc.executeJavaScript(coverAt(point.x, point.y, texts)).catch(() => ""));
  for (let i = 0; cover && i < UNCOVER_TRIES; i++) {
    await writeBrowserLog("submit-covered by=" + cover + " try=" + i);
    if (i === 0) await pressKey(wc, "Escape");
    else await clickPoint(wc, i === 1 ? CLOSE_POINT(point.x, point.y) : MASK_POINT);
    await sleep(700);
    cover = String(await wc.executeJavaScript(coverAt(point.x, point.y, texts)).catch(() => ""));
  }
  return cover;
}
const CAPTCHA = /安全验证|请完成下方验证|拖动.{0,6}滑块|滑块验证|扫码验证|请完成短信验证|短信验证码/;
const VERIFY_LAYER = /verify|captcha/i;

export async function autoSubmit(wc: WebContents, platform: Platform, type: ContentType): Promise<{ ok: boolean; reason: string; captcha?: boolean; settled?: boolean }> {
  const rule = submitRuleFor(platform, type);
  if (!rule) return { ok: false, reason: "该平台暂未接入自动发布" };
  let target: { x: number; y: number } | null = null;
  for (let i = 0; i < 20 && !target; i++) {
    target = await wc.executeJavaScript(findTarget(rule.texts, rule.scope || "button")).catch(() => null);
    if (!target) await sleep(500);
  }
  const pierced = !target;
  if (pierced) target = await pierceTarget(wc, rule.texts);
  if (!target) return { ok: false, reason: "未找到可点击的「" + rule.texts[0] + "」按钮" };
  await sleep(400);
  if (!pierced) {
    const cover = await uncover(wc, target, rule.texts);
    if (VERIFY_LAYER.test(cover) || CAPTCHA.test(await wc.executeJavaScript(pageText).catch(() => ""))) return { ok: false, captcha: true, reason: "平台弹出了短信或安全验证，需要你本人完成" };
    if (cover) return { ok: false, reason: "「" + rule.texts[0] + "」按钮被页面上的弹层挡住了（" + cover + "），请关掉弹层后手动点发布" };
  }
  const fresh = pierced ? await pierceTarget(wc, rule.texts) : await wc.executeJavaScript(findTarget(rule.texts, rule.scope || "button")).catch(() => null);
  await mouseClick(wc, (fresh || target).x, (fresh || target).y);
  const deadline = Date.now() + SUBMIT_SETTLE_MS;
  let confirmed = false;
  let settled = false;
  let lastText = "";
  while (Date.now() < deadline) {
    await sleep(1500);
    const text: string = await wc.executeJavaScript(pageText).catch(() => "");
    lastText = text;
    if (CAPTCHA.test(text)) return { ok: false, captcha: true, reason: "平台弹出了安全验证（拖动滑块/扫码），需要你本人完成" };
    if (rule.done.test(text)) {
      settled = true;
      break;
    }
    if (rule.confirm && !confirmed) {
      const c = await wc.executeJavaScript(findTarget(rule.confirm, "button,[role=button]")).catch(() => null);
      if (c) {
        await mouseClick(wc, c.x, c.y);
        confirmed = true;
      }
    }
  }
  await sleep(1500);
  if (CAPTCHA.test(await wc.executeJavaScript(pageText).catch(() => ""))) return { ok: false, captcha: true, reason: "平台弹出了安全验证（拖动滑块/扫码），需要你本人完成" };
  if (!settled) await writeBrowserLog(platform + "-submit-unsettled confirmed=" + confirmed + " text=" + lastText.replace(/\s+/g, " ").slice(-1500));
  return { ok: true, reason: "", settled };
}
