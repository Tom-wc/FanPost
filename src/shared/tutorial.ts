export type TutorialTopic = "start" | "accounts" | "compose" | "pick" | "launch" | "records" | "drafts" | "notify" | "settings" | "mp" | "license" | "safety" | "lookup" | "verify" | "faq";

export const TUTORIAL_SECTIONS: Record<TutorialTopic, string> = {
  start: "5 分钟上手：发一篇图文到 4 个平台",
  accounts: "操作 1：添加平台账号",
  compose: "操作 2：填写内容",
  pick: "操作 3：选账号、给单个平台改文案",
  launch: "操作 4：一键填写，暂停与停止",
  records: "操作 5：查看进度和预览，去平台点发布",
  drafts: "操作 6：保存草稿，下次接着填",
  notify: "操作 7：处理通知和掉线账号",
  settings: "操作 8：调整设置",
  mp: "操作 9：公众号文章",
  license: "会员到期与授权提醒",
  safety: "安全检查：敏感词、每日次数、照搬比例",
  lookup: "在哪里查看：常用信息速查",
  verify: "首次使用会遇到的验证与弹窗",
  faq: "常见问题",
};

export function slugify(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
}

export const topicSlug = (topic: TutorialTopic) => slugify(TUTORIAL_SECTIONS[topic]);

export interface TutorialHeading {
  depth: number;
  text: string;
  slug: string;
}

export function tutorialHeadings(markdown: string): TutorialHeading[] {
  const out: TutorialHeading[] = [];
  let fenced = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^```/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const m = line.match(/^(#{1,3})\s+(.+?)\s*#*$/);
    if (m) out.push({ depth: m[1].length, text: m[2], slug: slugify(m[2]) });
  }
  return out;
}
