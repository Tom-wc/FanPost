import type { Platform } from "../../shared/types";

export interface CommentPageConfig {
  label: string;
  /** 该平台的后台评论管理页 */
  listUrl: string;
  /** 没有独立评论页、必须先进某个作品详情的平台（如抖音） */
  itemUrl?: (itemId: string) => string;
  /** 回复字数上限（平台限制，超了会被截断或拒收） */
  replyMax?: number;
  /** 平台专用抓取脚本（页面不是常规评论列表时用，比如小红书走的是通知中心） */
  extract?: string;
  /** 「回复」按钮选择器，给了就按它定位，比按文本猜更稳 */
  replySel?: string;
  /** 页面内容渲染慢的，多等一会儿再抓 */
  waitMs?: number;
}

/**
 * 小红书没有「评论管理」页，评论落在前台通知中心（/notification → 评论和@）。
 * 结构：.notification-page > .tabs-content-container > .container > .main > .info
 *       .info 里有 .user-info a（作者）、.interaction-content（正文）、.actions .action-reply（回复）
 */
const XHS_EXTRACT = `(() => {
  const clean = (s) => (s || "").replace(/\\s+/g, " ").trim();
  const rows = [...document.querySelectorAll(".main")].filter((el) => el.offsetParent && el.querySelector(".action-reply"));
  const items = [];
  for (const row of rows) {
    const author = clean((row.querySelector(".user-info a") || {}).innerText || "");
    const content = clean((row.querySelector(".interaction-content") || {}).innerText || "");
    const time = clean((row.querySelector(".interaction-time") || {}).innerText || "");
    if (!content || /该评论已删除|评论已删除/.test(content)) continue;
    items.push({ author: author.slice(0, 40), content: content.slice(0, 500), itemTitle: "", time });
    if (items.length >= 60) break;
  }
  return JSON.stringify({ ok: true, url: location.href, title: document.title, replyButtons: rows.length, items });
})()`;

/**
 * 已实测能打开的后台评论页（2026-11-11 用开发版 18 个登录账号逐个验证）。
 * 视频号暂不纳入：页面渲染为空且账号掉线。公众号走另一套接口，见 README/教程说明。
 */
export const COMMENT_PAGES: Partial<Record<Platform, CommentPageConfig>> = {
  toutiao: { label: "头条号", listUrl: "https://mp.toutiao.com/profile_v4/manage/comment/all" },
  qqmedia: { label: "企鹅号", listUrl: "https://om.qq.com/main/interactive/comment" },
  kuaishou: { label: "快手", listUrl: "https://cp.kuaishou.com/article/comment" },
  baijiahao: { label: "百家号", listUrl: "https://baijiahao.baidu.com/builder/rc/commentmanage/comment/all" },
  zhihu: { label: "知乎", listUrl: "https://www.zhihu.com/creator/manage/comment/answer" },
  weibo: { label: "微博", listUrl: "https://weibo.com/comment/inbox" },
  bilibili: { label: "哔哩哔哩", listUrl: "https://member.bilibili.com/platform/comment/article" },
  xiaohongshu: {
    label: "小红书",
    listUrl: "https://www.xiaohongshu.com/notification",
    replyMax: 300,
    replySel: ".main .action-reply",
    extract: XHS_EXTRACT,
    waitMs: 8000,
  },
  douyin: {
    label: "抖音",
    listUrl: "https://creator.douyin.com/creator-micro/content/manage",
    itemUrl: (itemId) => "https://creator.douyin.com/creator-micro/work-management/work-detail/" + itemId + "?tabKey=commentManagement",
    replyMax: 100,
  },
};

export const SCANNABLE: Platform[] = Object.keys(COMMENT_PAGES) as Platform[];

/** 平台改版自检：把评论页的按钮、链接、疑似评论行都摊开，用来定位适配点（只在开发版可用）。 */
export const PROBE_SCRIPT = `(() => {
  const clean = (s) => (s || "").replace(/\\s+/g, " ").trim();
  const vis = (el) => !!el.offsetParent;
  const btns = [...document.querySelectorAll("button, [role=button], a, span, div")]
    .filter((el) => vis(el) && el.children.length === 0 && clean(el.textContent).length > 0 && clean(el.textContent).length <= 10)
    .map((el) => clean(el.textContent));
  const counts = {};
  for (const t of btns) counts[t] = (counts[t] || 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([t, n]) => t + " ×" + n);
  const replyLike = [...document.querySelectorAll("*")].filter((el) => vis(el) && /^(回复|reply)$/i.test(clean(el.textContent))).length;
  const anchors = [...document.querySelectorAll("a[href]")]
    .filter((a) => vis(a) && a.getAttribute("href") && !a.getAttribute("href").startsWith("javascript"))
    .slice(0, 15)
    .map((a) => clean(a.textContent).slice(0, 24) + " -> " + a.getAttribute("href").slice(0, 60));
  const rows = [...document.querySelectorAll("li, article, [class*=comment], [class*=list-item], [class*=item]")].filter(vis).length;
  return JSON.stringify({
    url: location.href,
    title: document.title,
    replyLike,
    rows,
    top,
    anchors,
    text: clean(document.body ? document.body.innerText : "").slice(0, 700),
  });
})()`;

/** 抓取脚本：通用启发式 —— 找「回复」按钮，取它所在评论块里的作者、正文和时间，不依赖各平台 class 名。 */
export const EXTRACT_SCRIPT = `(() => {
  const REPLY = /^(回复|reply|回复ta|回复ta$|回复\\s*ta)$/i;
  const clean = (s) => (s || "").replace(/\\s+/g, " ").trim();
  const norm = (s) => (s || "").replace(/\\s+/g, "").toLowerCase();
  // 平台上的时间文本：5天前 / 3小时前 / 昨天 10:20 / 2024-10-02 / 11-10 10:34 / 10:34
  const RE_TIME = /^(刚刚|刚才|just now|now|\\d{1,4}\\s*(秒|秒钟|分钟|分|小时|钟头|天|日|周|星期|个?月|年)\\s*(前|以前)|\\d{1,4}\\s*(s|m|h|d|w)\\s+ago|(今天|今日|昨天|昨日|前天)\\s*\\d{0,2}:?\\d{0,2}|\\d{1,2}:\\d{2}(:\\d{2})?|\\d{4}\\s*[-/.年]\\s*\\d{1,2}\\s*[-/.月]\\s*\\d{1,2}\\s*日?(\\s+\\d{1,2}:\\d{2}(:\\d{2})?)?|\\d{1,2}\\s*[-/.月]\\s*\\d{1,2}\\s*日?(\\s+\\d{1,2}:\\d{2})?)$/i;
  const looksTime = (s) => {
    const v = clean(s);
    return v && v.length <= 24 && RE_TIME.test(v) ? v : "";
  };
  // 评论块里的时间：先认 time 标签 / datetime / data-* / class 带 time 的节点，再退回逐行文本
  const pickTime = (box) => {
    const nodes = [...box.querySelectorAll("time, [datetime], [data-time], [data-timestamp], [data-created-at], [class*=time], [class*=Time], [class*=date], [class*=Date], [title]")];
    for (const el of nodes) {
      for (const attr of ["datetime", "data-time", "data-timestamp", "data-created-at", "title"]) {
        const hit = looksTime(el.getAttribute(attr));
        if (hit) return hit;
      }
      const hit = looksTime(el.textContent);
      if (hit) return hit;
    }
    const lines = (box.innerText || "").split("\\n").map(clean).filter(Boolean);
    for (const l of lines) {
      const hit = looksTime(l);
      if (hit) return hit;
    }
    return "";
  };
  const all = [...document.querySelectorAll("button, a, span, div, p")];
  const hits = all.filter((el) => {
    if (!el.offsetParent) return false;
    const t = norm(el.textContent);
    return t.length > 0 && t.length <= 8 && REPLY.test(t);
  });
  const anchors = hits.filter((el) => !hits.some((o) => o !== el && el.contains(o)));
  const seen = new Set();
  const items = [];
  for (const btn of anchors) {
    let box = btn;
    for (let i = 0; i < 8 && box.parentElement; i++) {
      box = box.parentElement;
      if (clean(box.innerText).length >= 12) break;
    }
    if (!box || seen.has(box)) continue;
    seen.add(box);
    const lines = (box.innerText || "").split("\\n").map(clean).filter(Boolean);
    const body = lines.filter((l) => {
      const n = norm(l);
      if (!n || REPLY.test(n)) return false;
      if (looksTime(l)) return false;
      if (/^(赞|点赞|回复|删除|置顶|展开|收起|举报|分享|收藏|转发)$/.test(n)) return false;
      if (/^\\d+([万亿])?$/.test(n)) return false;
      return true;
    });
    if (!body.length) continue;
    const author = body.find((l) => l.length <= 20 && !/[，。！？；：,.!?;:]/.test(l)) || "";
    const rest = body.filter((l) => l !== author);
    const content = (rest.sort((a, b) => b.length - a.length)[0] || "").slice(0, 500);
    if (!content) continue;
    const links = [...box.querySelectorAll("a")]
      .map((a) => clean(a.innerText))
      .filter((t) => t.length >= 4 && t.length <= 60 && t !== author && t !== content)
      .filter((t) => !/^\\d{2,4}[-/年]\\d{1,2}([-/月]\\d{1,2})?/.test(t))
      .filter((t) => !/^(网页链接|查看详情|展开|全文|回复)$/.test(t));
    items.push({ author: author.slice(0, 40), content, itemTitle: (links[0] || "").slice(0, 80), time: pickTime(box) });
    if (items.length >= 60) break;
  }
  return JSON.stringify({
    ok: true,
    url: location.href,
    title: document.title,
    replyButtons: anchors.length,
    items,
  });
})()`;

/**
 * 把一条回复填进第 index 个评论的输入框。
 * send=true 时点「发送」，并用「输入框是否被清空」反推是否真的提交成功，不盲猜。
 */
export const fillScript = (index: number, body: string, send: boolean, replySel?: string) => `(async () => {
  const REPLY = /^(回复|reply)$/i;
  const norm = (s) => (s || "").replace(/\\s+/g, "").toLowerCase();
  const clean = (s) => (s || "").replace(/\\s+/g, " ").trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const SEL = ${JSON.stringify(replySel || "")};
  let anchors;
  if (SEL) {
    anchors = [...document.querySelectorAll(SEL)].filter((el) => el.offsetParent);
  } else {
    const all = [...document.querySelectorAll("button, a, span, div, p")];
    const hits = all.filter((el) => {
      if (!el.offsetParent) return false;
      const t = norm(el.textContent);
      return t.length > 0 && t.length <= 8 && REPLY.test(t);
    });
    anchors = hits.filter((el) => !hits.some((o) => o !== el && el.contains(o)));
  }
  const btn = anchors[${index}];
  if (!btn) return JSON.stringify({ ok: false, error: "没找到第 ${index + 1} 个回复按钮，页面可能已刷新" });
  btn.click();
  await sleep(SEL ? 1200 : 700);
  const boxes = [...document.querySelectorAll("textarea, [contenteditable=true]")].filter((el) => el.offsetParent);
  const box = boxes[boxes.length - 1];
  if (!box) return JSON.stringify({ ok: false, error: "点了回复但没找到输入框" });
  box.focus();
  if (box.tagName === "TEXTAREA") {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(box, ${JSON.stringify(body)});
    box.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    box.innerText = ${JSON.stringify(body)};
    box.dispatchEvent(new InputEvent("input", { bubbles: true, data: ${JSON.stringify(body)} }));
  }
  await sleep(400);
  const filled = (box.value || box.innerText || "").trim();
  if (!filled) return JSON.stringify({ ok: false, error: "输入框没吃进内容，平台可能限制了脚本填入" });

  // 发送按钮必须和输入框在同一个容器里找：全页扫描会命中列表里每条评论的「回复」小按钮
  const pickSend = (re) => {
    let scope = box;
    for (let i = 0; i < 10 && scope.parentElement; i++) {
      scope = scope.parentElement;
      const cands = [...scope.querySelectorAll("button, span, div, a")].filter((el) => {
        if (!el.offsetParent) return false;
        const n = norm(el.textContent);
        if (!n || !re.test(n)) return false;
        if (el.contains(box)) return false;
        if (el.querySelector("textarea, [contenteditable=true]")) return false;
        if (el.disabled === true || el.getAttribute("aria-disabled") === "true") return false;
        // 「回复」小按钮和它里面的文字不能当成发送键
        if (/action-reply|action-text|reply-btn/i.test(String(el.className || ""))) return false;
        return true;
      });
      const flat = cands.filter((el) => !cands.some((o) => o !== el && el.contains(o)));
      if (flat.length) return flat[flat.length - 1];
    }
    return null;
  };
  // 先认「发送/发布/提交」，都没有才退回「回复」（有些平台发送键就叫回复）
  const sendBtn = pickSend(/^(发送|发布|提交|评论|发表)$/) || pickSend(/^回复$/);
  const label = sendBtn ? clean(sendBtn.textContent) : "";
  if (!${send}) return JSON.stringify({ ok: true, sent: false, sendButton: label, chars: filled.length });
  if (!sendBtn) return JSON.stringify({ ok: true, sent: false, sendButton: "", error: "内容已填好，但没认出「发送」按钮，请手动点一下" });

  // 发送结果以平台接口返回为准：输入框被清空并不代表发出去了（可能被内容风控挡掉）
  if (!window.__fpReplyLog) {
    window.__fpReplyLog = [];
    const keep = (m, u, s, b) => {
      if (!/post/i.test(String(m || ""))) return;
      if (!/comment|reply|publish|create/i.test(String(u || ""))) return;
      window.__fpReplyLog.push({ u: String(u).slice(0, 140), s, b: String(b || "").slice(0, 300) });
    };
    const of = window.fetch;
    window.fetch = async function (...a) {
      const init = a[1] || {};
      const r = await of.apply(this, a);
      try { keep(init.method || "GET", r.url, r.status, await r.clone().text()); } catch (e) {}
      return r;
    };
    const oo = window.XMLHttpRequest.prototype.open;
    const os = window.XMLHttpRequest.prototype.send;
    window.XMLHttpRequest.prototype.open = function (m, u, ...rest) { this.__fpM = m; this.__fpU = u; return oo.call(this, m, u, ...rest); };
    window.XMLHttpRequest.prototype.send = function (...a) {
      this.addEventListener("load", () => keep(this.__fpM, this.__fpU || this.responseURL, this.status, this.responseText));
      return os.apply(this, a);
    };
  }
  const mark = (window.__fpReplyLog || []).length;
  sendBtn.click();
  let hit = null;
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    const list = (window.__fpReplyLog || []).slice(mark);
    if (list.length) { hit = list[list.length - 1]; break; }
  }
  if (hit) {
    const okApi = hit.s >= 200 && hit.s < 300 && !/"ok"\\s*:\\s*0/.test(hit.b);
    let msg = "";
    try { msg = JSON.parse(hit.b).message || ""; } catch (e) {}
    return JSON.stringify({ ok: true, sent: okApi, verify: "api", status: hit.s, message: msg, sendButton: label });
  }
  const left = [...document.querySelectorAll("textarea, [contenteditable=true]")]
    .filter((el) => el.offsetParent)
    .some((el) => (el.value || el.innerText || "").trim() === filled);
  return JSON.stringify({ ok: true, sent: !left, verify: "dom", sendButton: label });
})()`;
