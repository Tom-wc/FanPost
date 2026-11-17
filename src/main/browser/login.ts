import type { Session, WebContents } from "electron";
import type { Account, Platform } from "../../shared/types";
import { writeBrowserLog } from "../log-bus";
import { sleep } from "./cdp";
import {
  SETTLE_INTERVAL_MS,
  SETTLE_MAX_MS,
  loginCookieNames,
  pageVerdict,
  settleStep,
  settleTimeout,
  type PageVerdict,
  type Settle,
  type Signals,
} from "./login-rules";

const LOGIN_SIGNALS =
  "(()=>{const visible=e=>!!e&&e.offsetParent!==null;const bodyText=document.body?.innerText||'';const text=bodyText.slice(0,12000);const selectors=['[class*=user-name]','[class*=username]','[class*=nickname]','[class*=account-name]','[class*=userName]','[class*=nickName]'];let name='';for(const selector of selectors){const node=[...document.querySelectorAll(selector)].find(visible);const value=node?.textContent?.trim();if(value&&value.length>1&&value.length<40){name=value;break}}const loginRoots=[...document.querySelectorAll('main#login-form,.login-box-container,[class*=login-box],[class*=login-container],[class*=qrcode],[class*=qr-code]')].filter(visible);const visibleLogin=loginRoots.length>0||[...document.querySelectorAll('img[alt*=qrcode i],img[src*=qrcode i]')].some(visible);const loginText=/扫码登录|手机号登录|验证码登录|QQ登录|微信登录|APP扫一扫登录|立即登录|登录\\/注册|登录\\/ 注册|账号登录|短信登录|密码登录|请登录|登录后/.test(text);return{name,visibleLogin,loginText,text}})()";

const KUAISHOU_NAME =
  "(()=>{const visible=e=>!!e&&e.offsetParent!==null;const invalid=/^(首页|内容管理|互动管理|数据中心|发布作品|创作服务|其他服务|快手|登录|注册|设置|消息|数据|作品|管理)$/;const selectors=['header [class*=name]','header [class*=nickname]','header [class*=user]','aside [class*=name]','[class*=user-info] [class*=name]','[class*=userInfo] [class*=name]','[data-testid*=user]','[data-testid*=nickname]'];for(const selector of selectors){for(const node of document.querySelectorAll(selector)){if(!visible(node))continue;const value=(node.textContent||'').trim().replace(/\\s+/g,' ');if(value.length>1&&value.length<30&&!invalid.test(value)&&!/[|｜]/.test(value)&&!/(发布|内容|数据|作品|管理|设置|登录|平台)/.test(value))return value}}return ''})()";

type PageState = { verdict: PageVerdict; name: string };
export type LoginResult = { loggedIn: boolean; name: string; reason: string };

const LOGIN_PREP: Partial<Record<Platform, string>> = {
  qqmedia:
    "(()=>{if(window.__fpLoginPrep)return;window.__fpLoginPrep=1;let n=0;const t=setInterval(()=>{if(++n>20||!/om\\.qq\\.com/.test(location.host)){clearInterval(t);window.__fpLoginPrep=0;return}const c=document.querySelector('input.lv2-agreement-checkbox,.lv2-agreement input[type=checkbox]');if(c){if(!c.checked)(c.closest('label')||c).click();clearInterval(t);window.__fpLoginPrep=0}},300)})()",
};

export async function prepareLoginPage(platform: Platform, wc: WebContents): Promise<void> {
  const script = LOGIN_PREP[platform];
  if (!script) return;
  await wc.executeJavaScript(script).catch(() => undefined);
}

async function readPage(account: Account, wc: WebContents): Promise<PageState> {
  const url = wc.getURL();
  try {
    const signals = (await wc.executeJavaScript(LOGIN_SIGNALS)) as Signals;
    const verdict = pageVerdict(account.platform, signals, url);
    const name =
      account.platform === "kuaishou" ? await wc.executeJavaScript(KUAISHOU_NAME).catch(() => "") : signals.name;
    void writeBrowserLog(
      "login-signal platform=" + account.platform + " url=" + url + " page=" + (verdict || "-") + " visibleLogin=" + signals.visibleLogin +
        ' name="' + (name || "") + '" textHead="' + (signals.text || "").slice(0, 120).replace(/\s+/g, " ") + '"',
    );
    return { verdict, name };
  } catch {
    return { verdict: undefined, name: "" };
  }
}

export async function hasLoginCookie(session: Session, platform: Platform) {
  const names = loginCookieNames(platform);
  const now = Date.now() / 1000;
  try {
    const cookies = await session.cookies.get({});
    return cookies.some((c) => names.includes(c.name) && (!c.expirationDate || c.expirationDate > now));
  } catch {
    return false;
  }
}

export async function settleLogin(account: Account, wc: WebContents, isStale: () => boolean = () => false): Promise<LoginResult | undefined> {
  const started = Date.now();
  let state: Settle = {};
  let name = "";
  for (;;) {
    if (isStale() || wc.isDestroyed()) return undefined;
    const page = wc.isLoading() ? { verdict: undefined, name: "" } : await readPage(account, wc);
    if (page.name) name = page.name;
    const cookie = await hasLoginCookie(wc.session, account.platform);
    const step = settleStep(state, page.verdict, cookie, Date.now());
    state = step.next;
    if (step.loggedIn !== undefined) return finish(account, step.loggedIn, name, page.verdict === "in" ? "page-in" : cookie ? "page-out-stable" : "page-out-no-cookie");
    if (Date.now() - started >= SETTLE_MAX_MS) return finish(account, settleTimeout(state, cookie), name, "timeout cookie=" + cookie + " last=" + (state.last || "-"));
    await sleep(SETTLE_INTERVAL_MS);
  }
}

function finish(account: Account, loggedIn: boolean, name: string, reason: string): LoginResult {
  void writeBrowserLog("login-result platform=" + account.platform + " account=" + account.id + " loggedIn=" + loggedIn + " reason=" + reason);
  return { loggedIn, name, reason };
}
