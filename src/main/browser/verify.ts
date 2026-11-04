import type { WebContents } from "electron";
import type { Platform } from "../../shared/types";
import { platformMap } from "../../shared/platforms";
import { backendTitleCandidates } from "../publish-verification";
import { writeBrowserLog } from "../log-bus";
import { sleep } from "./cdp";
import { clickSmallestByText } from "./dom";
import { ignoreAborted, platformTitle, xhsOriginFromUrl } from "./common";

export const weixinPostListRecorder = `(()=>{try{if(window.__fanpostPostListRecorder)return true;window.__fanpostPostListRecorder=true;window.__fanpostPostListEvidence=[];const record=(url,body)=>{if(!/\\/post\\/post_list(?:\\?|$)/.test(String(url||""))||typeof body!=="string")return;try{const parsed=JSON.parse(body);const list=parsed?.data?.list;if(!Array.isArray(list))return;const titles=list.map(item=>({objectId:String(item?.objectId||"").slice(0,120),createTime:item?.createTime,titles:[item?.desc?.description,item?.desc?.mpTitle,item?.description,item?.title,...(Array.isArray(item?.desc?.shortTitle)?item.desc.shortTitle.map(value=>typeof value==="string"?value:value?.shortTitle):[])].filter(value=>typeof value==="string"&&value.trim())}));window.__fanpostPostListEvidence.push({url:String(url),titles});if(window.__fanpostPostListEvidence.length>4)window.__fanpostPostListEvidence.shift()}catch(_){}};const fetch0=window.fetch;if(typeof fetch0==="function")window.fetch=function(input,init){const url=typeof input==="string"?input:input?.url||"";return fetch0.call(this,input,init).then(response=>{if(/\\/post\\/post_list(?:\\?|$)/.test(String(url)))response.clone().text().then(body=>record(url,body)).catch(()=>{});return response})};const open0=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(method,url){this.__fanpostPostListUrl=String(url||"");return open0.apply(this,arguments)};const send0=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.send=function(body){if(/\\/post\\/post_list(?:\\?|$)/.test(this.__fanpostPostListUrl||""))this.addEventListener("load",()=>{try{record(this.__fanpostPostListUrl,this.responseText)}catch(_){}});return send0.call(this,body)};return true}catch(_){return false}})()`;

const MANAGER_URLS: Partial<Record<Platform, string>> = {
  douyin: "https://creator.douyin.com/creator-micro/content/manage",
  kuaishou: "https://cp.kuaishou.com/article/manage/video",
  zhihu: "https://www.zhihu.com/creator/manage/creation/article",
  baijiahao: "https://baijiahao.baidu.com/builder/rc/content",
  weibo: "https://weibo.com/",
  toutiao: "https://mp.toutiao.com/profile_v4/manage/content/all",
  bilibili: "https://member.bilibili.com/platform/upload-manager/article",
  weixin: "https://channels.weixin.qq.com/platform/post/list",
  qqmedia: "https://om.qq.com/main/management/articleManage",
};

const VERIFY_TITLE_LIMIT: Partial<Record<Platform, number>> = { xiaohongshu: 20, douyin: 30, toutiao: 30 };

const SNAPSHOT =
  "(()=>{const all=root=>{const result=[];for(const e of root.querySelectorAll('*')){result.push(e);if(e.shadowRoot)result.push(...all(e.shadowRoot))}return result};const text=((document.body?.innerText||'')+' '+all(document).map(e=>e.shadowRoot?(e.shadowRoot.innerText||e.shadowRoot.textContent||''):'').join(' ')).slice(0,120000);return{url:location.href,text,login:/扫码登录|手机号登录|验证码登录|短信登录|密码登录|立即登录/.test(text)||location.pathname.includes('/login')||location.pathname.includes('/auth')}})()";


const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

export type VerifyResult = { ok: boolean; url: string; reason?: string };

async function openManager(wc: WebContents, platform: Platform, managerUrl: string) {
  await wc.loadURL(managerUrl).catch(ignoreAborted);
  await sleep(7000);
  if (platform === "xiaohongshu") {
    if (!(await clickSmallestByText(wc, "笔记管理"))) {
      const href = await wc
        .executeJavaScript("(()=>{const link=[...document.querySelectorAll('a')].find(e=>(e.textContent||'').trim()==='笔记管理');return link?.href||''})()")
        .catch(() => "");
      if (href) await wc.loadURL(href).catch(ignoreAborted);
    }
    await sleep(5000);
  }
  if (platform === "kuaishou" || platform === "douyin") {
    await clickSmallestByText(wc, "已发布");
    await sleep(4000);
  }
}

const WEIXIN_DESC_MATCH = 30;
const FRAME_TEXT = "(document.body&&document.body.innerText)||''";

async function framesText(wc: WebContents) {
  const texts = (await Promise.all(
    [wc.mainFrame, ...wc.mainFrame.framesInSubtree].map((frame) => frame.executeJavaScript(FRAME_TEXT).catch(() => "")),
  )) as string[];
  return normalize(texts.join(" "));
}

export async function verifyPublishedTitle(wc: WebContents, platform: Platform, title: string, timeout: number, alt: string[] = []): Promise<VerifyResult> {
  const managerUrl = platform === "xiaohongshu" ? xhsOriginFromUrl(wc.getURL()) + "/" : MANAGER_URLS[platform];
  if (!managerUrl) return { ok: false, url: wc.getURL(), reason: platformMap[platform].name + "尚未配置后台标题验真" };
  const frameExpected = [normalize(title), ...alt.map((a) => normalize(a).slice(0, WEIXIN_DESC_MATCH))].filter((v) => v.length >= 6);
  const target = platformTitle(title, VERIFY_TITLE_LIMIT[platform]);
  const rawExpected = backendTitleCandidates(platform, target);
  const expected = platform === "weixin" ? [normalize(target)] : rawExpected.map(normalize).filter((v) => v.length >= 2);
  const start = Date.now();
  let lastUrl = "";
  while (Date.now() - start < timeout) {
    await openManager(wc, platform, managerUrl);
    const pollUntil = Math.min(start + timeout, Date.now() + 45000);
    while (Date.now() < pollUntil) {
      if (platform === "weixin") {
        const text = await framesText(wc);
        if (frameExpected.some((value) => text.includes(value))) {
          await writeBrowserLog("backend-title-verified " + JSON.stringify({ platform, title, source: "frames" }));
          return { ok: true, url: wc.getURL() };
        }
      }
      const snapshot = await wc.executeJavaScript(SNAPSHOT).catch(() => ({ url: wc.getURL(), text: "", login: false }));
      lastUrl = snapshot.url;
      if (snapshot.login) return { ok: false, url: snapshot.url, reason: platformMap[platform].name + "作品管理要求重新登录" };
      const text = normalize(snapshot.text);
      if (rawExpected.some((value) => snapshot.text.includes(value)) || expected.some((value) => text.includes(value))) {
        await writeBrowserLog("backend-title-verified " + JSON.stringify({ platform, title: target, url: snapshot.url, source: "manager-dom" }));
        return { ok: true, url: snapshot.url };
      }
      await sleep(3000);
    }
  }
  return { ok: false, url: lastUrl || wc.getURL(), reason: platformMap[platform].name + "作品管理未找到目标标题" };
}
