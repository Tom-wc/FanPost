import type { Platform } from "../../shared/types.ts";

export type Signals = { name: string; visibleLogin: boolean; loginText: boolean; text: string };
export type PageVerdict = "in" | "out" | undefined;

type Page = { host: string; path: string; s: Signals };
type Rule = { cookies: string[]; out: (p: Page) => boolean; in: (p: Page) => boolean };

const has = (re: RegExp, s: Signals) => re.test(s.text);

const rules: Record<Platform, Rule> = {
  douyin: {
    cookies: ["sessionid"],
    out: ({ host, s }) => host === "creator.douyin.com" && s.visibleLogin && has(/扫码登录|验证码登录|密码登录/, s),
    in: ({ host, path, s }) => host === "creator.douyin.com" && path.startsWith("/creator-micro") && !s.visibleLogin,
  },
  kuaishou: {
    cookies: ["kuaishou.web.cp.api_st"],
    out: ({ host, path, s }) =>
      /passport\.kuaishou\.com$/.test(host) || /\/login/.test(path) || (host === "cp.kuaishou.com" && has(/平台介绍/, s) && has(/机构入驻/, s)),
    in: ({ host, s }) => host === "cp.kuaishou.com" && has(/发布作品/, s) && has(/内容管理|数据中心/, s),
  },
  xiaohongshu: {
    cookies: ["galaxy_creator_session_id"],
    out: ({ path }) => path.startsWith("/login"),
    in: ({ host, path, s }) => /^creator\.(xiaohongshu|rednote)\.com$/.test(host) && !path.startsWith("/login") && has(/发布笔记|笔记管理/, s),
  },
  toutiao: {
    cookies: ["sessionid"],
    out: ({ path }) => path.startsWith("/auth/page/login"),
    in: ({ host, path, s }) => host === "mp.toutiao.com" && path.startsWith("/profile_v4") && has(/开始创作|创作中心|发布文章|发布视频|在头条创作|微头条/, s) && !s.visibleLogin,
  },
  weixin: {
    cookies: ["sessionid"],
    out: ({ path }) => path.startsWith("/login"),
    in: ({ host, path, s }) => host === "channels.weixin.qq.com" && (/^\/platform(\/|$)/.test(path) || has(/视频号ID/, s)) && !s.visibleLogin,
  },
  bilibili: {
    cookies: ["SESSDATA"],
    out: ({ host }) => host === "passport.bilibili.com",
    in: ({ host, path, s }) => host === "member.bilibili.com" && (path.startsWith("/platform") || has(/投稿|主站|创作中心/, s)) && !s.visibleLogin,
  },
  qqmedia: {
    cookies: ["omaccesstoken"],
    out: ({ path }) => path.startsWith("/userAuth"),
    in: ({ host, path, s }) => host === "om.qq.com" && path.startsWith("/main") && !has(/立即登录/, s),
  },
  zhihu: {
    cookies: ["z_c0"],
    out: ({ path }) => /^\/(signin|login)/.test(path),
    in: ({ host, path, s }) => /(^|\.)zhihu\.com$/.test(host) && !/^\/(signin|login)/.test(path) && has(/关注|推荐|热榜|写文章/, s) && !s.visibleLogin,
  },
  baijiahao: {
    cookies: ["BDUSS"],
    out: ({ host, path }) => /passport\.baidu\.com$/.test(host) || /\/login/.test(path),
    in: ({ host, path, s }) => host === "baijiahao.baidu.com" && !/\/login/.test(path) && has(/发布作品|内容管理|百家号平台服务/, s),
  },
  weibo: {
    cookies: ["ALF"],
    out: ({ host, path }) => host === "passport.weibo.com" || /^\/(newlogin|login|signin)/.test(path),
    in: ({ host, path, s }) => /^(www\.)?weibo\.com$/.test(host) && !/^\/(newlogin|login|signin)/.test(path) && has(/全部关注|最新微博|有什么新鲜事|内容声明/, s),
  },
};

export const loginCookieNames = (platform: Platform) => rules[platform].cookies;

export function pageVerdict(platform: Platform, s: Signals, url: string): PageVerdict {
  let page: Page;
  try {
    const u = new URL(url);
    page = { host: u.hostname, path: u.pathname, s };
  } catch {
    return undefined;
  }
  const rule = rules[platform];
  if (rule.out(page)) return "out";
  if (rule.in(page)) return "in";
  return undefined;
}

export const SETTLE_MAX_MS = 15000;
export const SETTLE_INTERVAL_MS = 1500;
export const OUT_CONFIRM_MS = 5000;

export type Settle = { outSince?: number; last?: PageVerdict };
export type SettleStep = { loggedIn?: boolean; next: Settle };

export function settleStep(prev: Settle, page: PageVerdict, hasCookie: boolean, now: number): SettleStep {
  if (page === "in") return { loggedIn: true, next: { last: page } };
  if (page !== "out") return { next: { last: prev.last } };
  if (!hasCookie) return { loggedIn: false, next: { last: page } };
  const outSince = prev.outSince ?? now;
  return now - outSince >= OUT_CONFIRM_MS ? { loggedIn: false, next: { last: page, outSince } } : { next: { last: page, outSince } };
}

export const settleTimeout = (state: Settle, hasCookie: boolean) => (state.last ? state.last === "in" : hasCookie);
