import { useRef, useState } from "react";
import { Alert, Button, Input, Select, Switch, Tag, Typography, message } from "antd";
import type { InputRef } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { UndoOutlined } from "@ant-design/icons";
import { EmojiPicker } from "./EmojiPicker";
import { TopicInput } from "./TopicInput";
import type { ContentType, Platform, PlatformContent } from "../../shared/types";
import { platformMap } from "../../shared/platforms";
import { checkContent, isAssisted, platformRule, titleLength, type ContentIssue } from "../../shared/platform-rules";
import { PlatformLogo } from "./PlatformLogo";
import { AiAssist, MultiDraft } from "./AiPanel";
import { BILIBILI_ZONES, DEFAULT_BILIBILI_ZONE } from "../../shared/declarations";

export interface CommonContent {
  title: string;
  description: string;
  topics: string[];
}
export interface OverrideState extends PlatformContent {
  enabled: boolean;
}

export function effective(common: CommonContent, own?: OverrideState) {
  return own?.enabled
    ? {
        title: own.title ?? common.title,
        description: own.description ?? common.description,
        topics: own.topics ?? common.topics,
      }
    : common;
}

export function ContentFields({
  value,
  onChange,
  topicOptions,
  type,
  hideTitle,
  titleMax,
  titleMin,
  bodyMax,
  issues = [],
  disabled,
  platform,
  platforms,
  onPlatformDraft,
}: {
  value: CommonContent;
  onChange: (next: CommonContent) => void;
  topicOptions: string[];
  type: ContentType;
  hideTitle?: boolean;
  titleMax?: number;
  titleMin?: number;
  bodyMax?: number;
  issues?: ContentIssue[];
  disabled?: boolean;
  platform?: Platform;
  platforms?: Platform[];
  /**
   * 一稿多平台：生成好的平台版本写到该平台的独立文案里。
   * 只有「通用内容」这一层能提供，所以没传就不显示入口。
   */
  onPlatformDraft?: (platform: Platform, text: string) => void;
}) {
  const len = titleLength(value.title);
  const bodyLen = titleLength(value.description);
  const titleIssues = issues.filter((i) => i.field === "title");
  const bodyIssues = issues.filter((i) => i.field === "body");
  const topicIssues = issues.filter((i) => i.field === "topics");
  const over = titleIssues.length > 0;
  const titleRef = useRef<InputRef>(null);
  const bodyRef = useRef<TextAreaRef>(null);
  const [focused, setFocused] = useState<"title" | "description">("description");
  /**
   * 正文里选中的区间。有值时 AI 只改这一段——现在改一句话不用重写全文。
   * 用对象存而不是数字对，切换 tab / 重新挂载时自然归零。
   */
  const [range, setRange] = useState<{ start: number; end: number } | undefined>(undefined);
  /**
   * 上一次 AI 写到正文之前的原文。AI 面板一关就回不去，这个按钮是唯一退路；
   * 用户手动改正文后作废，免得把人新写的东西盖掉。
   */
  const [undo, setUndo] = useState<string | undefined>(undefined);
  const syncRange = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    if (start === end) {
      setRange((prev) => (prev ? undefined : prev));
      return;
    }
    setRange((prev) => (prev && prev.start === start && prev.end === end ? prev : { start, end }));
  };
  const bodyEl = () => bodyRef.current?.resizableTextArea?.textArea ?? null;
  const restore = () => {
    if (undo === undefined) return;
    onChange({ ...value, description: undo });
    setUndo(undefined);
    setRange(undefined);
    message.success("已还原到 AI 修改之前");
  };
  const field = hideTitle ? "description" : focused;
  const insertEmoji = (emoji: string) => {
    const el = field === "title" ? titleRef.current?.input : bodyRef.current?.resizableTextArea?.textArea;
    const current = value[field];
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    onChange({ ...value, [field]: current.slice(0, start) + emoji + current.slice(end) });
    const caret = start + emoji.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  };
  return (
    <div className="content-fields">
      <div className="content-toolbar">
        <AiAssist
          value={value}
          onChange={onChange}
          type={type}
          disabled={disabled}
          hideTitle={hideTitle}
          selection={range}
          onApplied={(before) => {
            setUndo(before);
            setRange(undefined);
          }}
          {...(platform ? { platform } : {})}
          {...(platforms ? { platforms } : {})}
        >
          {onPlatformDraft && platforms && platforms.length > 1 && (
            <MultiDraft value={value.description} platforms={platforms} type={type} disabled={disabled} onAdopt={onPlatformDraft} />
          )}
        </AiAssist>
        {undo !== undefined && (
          <Button size="small" type="text" className="ai-undo" icon={<UndoOutlined />} title="回到这次 AI 修改之前的正文" onClick={restore}>
            还原上一步
          </Button>
        )}
        <EmojiPicker onPick={insertEmoji} disabled={disabled} target={field === "title" ? "标题" : type === "video" ? "视频简介" : "正文"} />
      </div>
      {!hideTitle && (
        <label className="field">
          <span>
            标题
            <em className={over ? "count over" : "count"}>
              {len}
              {titleMax !== undefined ? " / " + (titleMin ? titleMin + "~" : "") + titleMax : ""}
            </em>
          </span>
          <Input
            ref={titleRef}
            onFocus={() => setFocused("title")}
            value={value.title}
            disabled={disabled}
            status={over ? "error" : undefined}
            placeholder="输入标题"
            onChange={(e) => onChange({ ...value, title: e.target.value })}
          />
          {titleIssues.map((i) => (
            <small key={i.text} className="field-error">{i.text}</small>
          ))}
        </label>
      )}
      <label className="field">
        <span>
          {type === "video" ? "视频简介" : "正文内容"}
          <em className={bodyIssues.length ? "count over" : "count"}>
            {bodyLen}
            {bodyMax !== undefined ? " / " + bodyMax : ""}
          </em>
        </span>
        <Input.TextArea
          ref={bodyRef}
          onFocus={() => {
            setFocused("description");
            syncRange(bodyEl());
          }}
          value={value.description}
          disabled={disabled}
          status={bodyIssues.length ? "error" : undefined}
          autoSize={{ minRows: 6, maxRows: 16 }}
          placeholder={type === "video" ? "输入视频简介" : "输入正文，空行分段"}
          onChange={(e) => {
            onChange({ ...value, description: e.target.value });
            // 用户自己动手改了，之前那份原文就不再作数
            setUndo(undefined);
            syncRange(e.target as HTMLTextAreaElement);
          }}
          onSelect={(e) => syncRange(e.currentTarget)}
          onMouseUp={(e) => syncRange(e.currentTarget)}
          onKeyUp={(e) => syncRange(e.currentTarget)}
        />
        {bodyIssues.map((i) => (
          <small key={i.text} className="field-error">{i.text}</small>
        ))}
      </label>
      <div className="field" role="group" aria-label="话题标签">
        <span>话题标签</span>
        <TopicInput value={value.topics} disabled={disabled} options={topicOptions} onChange={(topics) => onChange({ ...value, topics })} />
        {topicIssues.map((i) => (
          <small key={i.text} className="field-warn">{i.text}</small>
        ))}
      </div>
    </div>
  );
}

export function PlatformTab({
  platform,
  type,
  common,
  own,
  onChange,
  topicOptions,
  imageCount,
}: {
  platform: Platform;
  type: ContentType;
  common: CommonContent;
  own?: OverrideState;
  onChange: (next: OverrideState) => void;
  topicOptions: string[];
  imageCount: number;
}) {
  const rule = platformRule(platform, type);
  const name = platformMap[platform].name;
  const assisted = isAssisted(platform, type);
  const current = effective(common, own);
  const issues = checkContent(platform, type, current, imageCount);
  const hints: string[] = [];
  if (rule.titleMax) hints.push("标题 " + (rule.titleMin ? rule.titleMin + "~" : "≤") + rule.titleMax + " 字");
  if (rule.titleCharsetHint) hints.push(rule.titleCharsetHint);
  if (rule.bodyMax) hints.push((type === "video" ? "简介" : "正文") + " ≤" + rule.bodyMax + " 字");
  if (type === "image_text" && rule.imageMax) hints.push("图片 ≤" + rule.imageMax + " 张");
  if (rule.topicMax) hints.push("话题建议 ≤" + rule.topicMax + " 个");
  if (rule.mergeTitleIntoBody) hints.push("没有标题框，标题会和正文合并写入");
  if (type === "video" && rule.declarationHint) hints.push("「" + rule.declarationHint + "」需要你自己在平台页面上勾选");
  if (assisted) hints.push("辅助模式：文案进剪贴板、打开发布页，由你手动上传和发布");
  return (
    <div className="platform-tab">
      <div className="platform-tab-head">
        <Switch
          checked={!!own?.enabled}
          onChange={(enabled) =>
            onChange({
              ...(own || {}),
              enabled,
              title: own?.title ?? common.title,
              description: own?.description ?? common.description,
              topics: own?.topics ?? common.topics,
            })
          }
        />
        <span>{own?.enabled ? "使用" + name + "独立文案" : "跟随「通用」内容（打开开关可单独修改）"}</span>
      </div>
      {hints.length > 0 && (
        <Alert
          type="info"
          showIcon
          className="platform-hints"
          title={hints.map((h) => (
            <Tag key={h} bordered={false}>
              {h}
            </Tag>
          ))}
        />
      )}
      <ContentFields
        type={type}
        value={current}
        disabled={!own?.enabled}
        platform={platform}
        hideTitle={rule.mergeTitleIntoBody}
        titleMax={rule.titleMax}
        titleMin={rule.titleMin}
        bodyMax={rule.bodyMax}
        issues={issues}
        topicOptions={topicOptions}
        onChange={(next) => onChange({ ...(own || { enabled: true }), enabled: true, ...next })}
      />
      {platform === "zhihu" && type === "image_text" && (
        <label className="field">
          <span>投稿至问题</span>
          <Input
            allowClear
            value={own?.question ?? ""}
            placeholder="留空则按标题和话题自动匹配相关问题；也可粘贴问题链接或输入关键词"
            onChange={(e) => onChange({ ...(own || { enabled: false }), question: e.target.value })}
          />
        </label>
      )}
      {platform === "bilibili" && type === "video" && (
        <label className="field">
          <span>分区</span>
          <Select
            value={own?.zone || DEFAULT_BILIBILI_ZONE}
            options={BILIBILI_ZONES.map((z) => ({ value: z, label: z }))}
            onChange={(zone) => onChange({ ...(own || { enabled: false }), zone })}
            aria-label="B站分区"
          />
        </label>
      )}
      {issues.some((i) => i.field === "images") && (
        <Alert type="error" showIcon title={issues.find((i) => i.field === "images")!.text + "，超出部分平台可能拒收"} />
      )}
      {rule.mergeTitleIntoBody && (
        <Typography.Paragraph type="secondary" className="merge-preview">
          实际写入：{[current.title, current.description].filter((x) => x.trim()).join(" / ").slice(0, 120) || "（空）"}
        </Typography.Paragraph>
      )}
    </div>
  );
}

export function RuleStrip({
  platforms,
  type,
  common,
  overrides,
  imageCount,
  onOpen,
}: {
  platforms: Platform[];
  type: ContentType;
  common: CommonContent;
  overrides: Partial<Record<Platform, OverrideState>>;
  imageCount: number;
  onOpen: (platform: Platform) => void;
}) {
  if (!platforms.length) return null;
  return (
    <div className="rule-strip">
      <span className="rule-strip-label">各平台规则</span>
      {platforms.map((p) => {
        const rule = platformRule(p, type);
        const c = effective(common, overrides[p]);
        const issues = checkContent(p, type, c, imageCount);
        const bad = issues.some((i) => i.level === "error");
        const warn = !bad && issues.length > 0;
        const tLen = titleLength(c.title);
        const meter = rule.mergeTitleIntoBody
          ? "无标题框"
          : rule.titleMax
            ? "标题 " + tLen + "/" + rule.titleMax
            : "标题 " + tLen;
        return (
          <button
            key={p}
            type="button"
            className={"rule-chip" + (bad ? " is-bad" : warn ? " is-warn" : " is-ok")}
            title={issues.length ? issues.map((i) => i.text).join("；") : platformMap[p].name + " 符合平台规则"}
            onClick={() => onOpen(p)}
          >
            <PlatformLogo platform={p} />
            <span>{platformMap[p].name}</span>
            <em className="num">{meter}</em>
            {issues.length > 0 && <b>{issues.length}</b>}
          </button>
        );
      })}
    </div>
  );
}
