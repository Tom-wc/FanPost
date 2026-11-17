import assert from "node:assert/strict";
import test from "node:test";
import type { Platform } from "../shared/types.ts";
import {
  OUT_CONFIRM_MS,
  loginCookieNames,
  pageVerdict,
  settleStep,
  settleTimeout,
  type PageVerdict,
  type Signals,
} from "./browser/login-rules.ts";

const page = (text: string, visibleLogin = false): Signals => ({ name: "", visibleLogin, loginText: false, text });

const loggedOut: Array<[Platform, string, Signals]> = [
  ["douyin", "https://creator.douyin.com/", page("抖音创作者的一站式创作与服务平台 我是创作者 扫码登录 验证码登录 密码登录", true)],
  ["kuaishou", "https://cp.kuaishou.com/profile", page("平台介绍 机构入驻 视频上传 快手创作者服务平台", true)],
  ["xiaohongshu", "https://creator.xiaohongshu.com/login", page("创作服务平台 短信登录 发送验证码", true)],
  ["toutiao", "https://mp.toutiao.com/auth/page/login?redirect_url=JTJG", page("注册 登录 验证码登录 扫码登录", true)],
  ["weixin", "https://channels.weixin.qq.com/login.html", page("视频号助手 加热平台 一站式服务， 让创作更简单。")],
  ["bilibili", "https://passport.bilibili.com/login", page("扫码登录 密码登录 短信登录", true)],
  ["qqmedia", "https://om.qq.com/userAuth/index", page("企鹅号 登录 QQ登录 微信登录 立即登录", true)],
  ["zhihu", "https://www.zhihu.com/signin?next=%2F", page("打开知乎App 扫一扫 验证码登录密码登录", true)],
  ["baijiahao", "https://baijiahao.baidu.com/builder/theme/bjh/login", page("登录 百度内容创作经营平台 登录/注册百家号", true)],
  ["weibo", "https://weibo.com/newlogin?tabtype=weibo&url=https://weibo.com/", page("搜索 登录/注册 热门推荐 热门榜单 微博热搜")],
];

const loggedIn: Array<[Platform, string, Signals]> = [
  ["douyin", "https://creator.douyin.com/creator-micro/home", page("作品发布 首页 内容管理 数据中心 收入变现")],
  ["kuaishou", "https://cp.kuaishou.com/profile", page("Jackie 发布作品 首页 内容管理 互动管理 数据中心")],
  ["xiaohongshu", "https://creator.xiaohongshu.com/new/home", page("创作服务平台 Jackie 发布笔记 首页 笔记管理")],
  ["toutiao", "https://mp.toutiao.com/profile_v4/index", page("头条号 消息 欢迎来到你的创作中心 开始创作")],
  ["toutiao", "https://mp.toutiao.com/profile_v4/index", page("头条号 消息 4 在头条创作的第 2 天 Jackie-dou 主页 创作 文章 视频 微头条")],
  ["weixin", "https://channels.weixin.qq.com/platform", page("视频号 · 助手 Jackie989 申请认证 视频号ID: sphh")],
  ["bilibili", "https://member.bilibili.com/platform/upload/video/frame", page("主站 试试更多AI创作工具吧 在bilibili星球的第2033天")],
  ["qqmedia", "https://om.qq.com/main", page("企鹅号.腾讯内容开放平台 lcofo 正式运营 退出 我的主页")],
  ["zhihu", "https://www.zhihu.com/", page("关注 推荐 热榜 专栏 圈子")],
  ["baijiahao", "https://baijiahao.baidu.com/", page("切换 发布作品 首页 内容管理 作品管理")],
  ["weibo", "https://weibo.com/", page("首页 全部关注 最新微博 特别关注 好友圈")],
];

const loading: Array<[Platform, string, Signals]> = [
  ["weixin", "https://channels.weixin.qq.com/", page("")],
  ["douyin", "https://creator.douyin.com/", page("加载中，请稍候...")],
  ["kuaishou", "https://cp.kuaishou.com/profile", page("")],
  ["toutiao", "https://mp.toutiao.com/profile_v4/", page("")],
  ["bilibili", "https://member.bilibili.com/", page("")],
  ["xiaohongshu", "https://creator.xiaohongshu.com/", page("")],
];

test("real logged-out pages of all 10 platforms are recognised as out", () => {
  for (const [p, url, s] of loggedOut) assert.equal(pageVerdict(p, s, url), "out", p);
});

test("real logged-in pages of all 10 platforms are recognised as in", () => {
  for (const [p, url, s] of loggedIn) assert.equal(pageVerdict(p, s, url), "in", p);
});

test("blank or loading pages before redirect give no verdict", () => {
  for (const [p, url, s] of loading) assert.equal(pageVerdict(p, s, url), undefined, p);
  assert.equal(pageVerdict("douyin", page("首页"), ""), undefined);
});

test("weixin root page already showing the account counts as logged in", () => {
  assert.equal(pageVerdict("weixin", page("视频号 · 助手 Jackie989 视频号ID: sphh"), "https://channels.weixin.qq.com/"), "in");
});

test("every platform declares at least one login cookie", () => {
  for (const [p] of loggedIn) assert.ok(loginCookieNames(p).length > 0, p);
});

const run = (steps: Array<[PageVerdict, boolean, number]>) => {
  let state = {};
  for (const [verdict, cookie, at] of steps) {
    const r = settleStep(state, verdict, cookie, at);
    state = r.next;
    if (r.loggedIn !== undefined) return r.loggedIn;
  }
  return undefined;
};

test("a logged-in page answers immediately", () => {
  assert.equal(run([[undefined, true, 0], ["in", true, 1500]]), true);
});

test("login page without the login cookie is offline immediately", () => {
  assert.equal(run([["out", false, 0]]), false);
});

test("login page while the cookie still exists must persist before offline", () => {
  assert.equal(run([["out", true, 0], ["out", true, 1500]]), undefined);
  assert.equal(run([["out", true, 0], ["out", true, OUT_CONFIRM_MS]]), false);
  assert.equal(run([["out", true, 0], ["in", true, 1500]]), true);
});

test("timeout falls back to the last page verdict, then to the cookie", () => {
  assert.equal(settleTimeout({}, true), true);
  assert.equal(settleTimeout({}, false), false);
  assert.equal(settleTimeout({ last: "out" }, true), false);
});
