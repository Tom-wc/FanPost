import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, Button, Checkbox, Input, Modal, message } from "antd";
import type { AiAction, AiRange, AiSelection } from "../../shared/ai";
import { AI_ERRORS, keepEdgeSpace, locateRange, parseTitleCandidates, parseTopicLine, readRange } from "../../shared/ai";
import type { ContentType, Platform } from "../../shared/types";
import { platformMap } from "../../shared/platforms";
import { platformRule } from "../../shared/platform-rules";
import { PlatformLogo } from "./PlatformLogo";

export interface AiContent {
  title: string;
  description: string;
  topics: string[];
}

type Target = "body" | "title" | "topics";

interface ActionDef {
  key: AiAction;
  label: string;
  target: Target;
  tip: string;
}

const ACTIONS: ActionDef[] = [
  { key: "polish", label: "润色", target: "body", tip: "保持原意，把表达改顺" },
  { key: "expand", label: "扩写", target: "body", tip: "补充细节，篇幅约翻倍" },
  { key: "shorten", label: "精简", target: "body", tip: "删重复和废话，留住关键信息" },
  { key: "title", label: "标题", target: "title", tip: "按平台字数上限给 5 个候选" },
  { key: "topics", label: "话题", target: "topics", tip: "按内容生成话题标签" },
];

const newRequestId = () => "ai-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);

function titleLimit(platform: Platform | undefined, platforms: Platform[] | undefined, type: ContentType) {
  const list = platform ? [platform] : platforms || [];
  const limits = list
    .map((p) => platformRule(p, type).titleMax)
    .filter((n): n is number => typeof n === "number" && n > 0);
  return limits.length ? Math.min(...limits) : undefined;
}

function scopeLabel(platform: Platform | undefined, platforms: Platform[] | undefined) {
  if (platform) return platformMap[platform].name;
  const list = platforms || [];
  if (list.length === 1) return platformMap[list[0]].name;
  return list.length ? "通用（按 " + list.length + " 个平台的共同上限）" : "通用";
}

export function AiAssist({
  value,
  onChange,
  type,
  platform,
  platforms,
  disabled,
  hideTitle,
  selection,
  onApplied,
  children,
}: {
  value: AiContent;
  onChange: (next: AiContent) => void;
  type: ContentType;
  platform?: Platform;
  platforms?: Platform[];
  disabled?: boolean;
  hideTitle?: boolean;
  /** 正文里选中的区间；有值时 AI 只改这一段 */
  selection?: AiSelection;
  /** 结果落到正文之前回调，把改之前的正文交出去，界面据此提供「还原」 */
  onApplied?: (before: string) => void;
  /** 追加在动作按钮后面的额外入口（如「一稿多平台」） */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<ActionDef>();
  const [output, setOutput] = useState("");
  const [titles, setTitles] = useState<string[]>([]);
  const [picked, setPicked] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [model, setModel] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [rangeLen, setRangeLen] = useState(0);

  const rid = useRef("");
  const startedAt = useRef(0);
  const actionRef = useRef<ActionDef | undefined>(undefined);
  const valueRef = useRef(value);
  valueRef.current = value;
  const selectionRef = useRef<AiSelection | undefined>(selection);
  selectionRef.current = selection;
  /** 本次调用改的是哪一段；没有选区就是整篇 */
  const rangeRef = useRef<AiRange | undefined>(undefined);
  const limitRef = useRef<number | undefined>(undefined);
  limitRef.current = titleLimit(platform, platforms, type);

  const failWith = (reason: string, partial: string) => {
    if (!partial.trim()) {
      setError(reason);
      return;
    }
    if (actionRef.current?.target === "title") {
      const list = parseTitleCandidates(partial, limitRef.current);
      if (!list.length) {
        setError(reason);
        return;
      }
      setTitles(list);
      setPicked(list[0] || "");
    } else {
      setOutput(partial);
    }
    setNotice(reason + "。已经写出来的部分留在下面，可以改一改直接用");
  };

  useEffect(() => {
    const offDelta = window.fanpost.onAiDelta((p) => {
      if (p.requestId !== rid.current) return;
      setOutput((prev) => prev + p.delta);
    });
    const offDone = window.fanpost.onAiDone((p) => {
      if (p.requestId !== rid.current) return;
      setLoading(false);
      setElapsed(Date.now() - startedAt.current);
      if (p.model) setModel(p.model);
      if (!p.ok) {
        failWith(p.error || "调用失败", p.text || "");
        return;
      }
      const text = p.text || "";
      if (actionRef.current?.target === "title") {
        const list = parseTitleCandidates(text, limitRef.current);
        setTitles(list);
        setPicked(list[0] || "");
      } else {
        setOutput(text);
      }
    });
    return () => {
      offDelta();
      offDone();
    };
  }, []);

  const stop = () => {
    if (rid.current) void window.fanpost.cancelAi(rid.current);
    setLoading(false);
  };

  const close = () => {
    stop();
    setOpen(false);
    setError("");
    setNotice("");
    setOutput("");
    setTitles([]);
    setPicked("");
    setElapsed(0);
    rangeRef.current = undefined;
    setRangeLen(0);
  };

  const run = async (def: ActionDef) => {
    const current = valueRef.current;
    // 正文类动作：有选区就只改选中那段，标题候选永远看全文
    const range = def.target === "body" ? readRange(current.description, selectionRef.current) : undefined;
    const source = def.target === "title" ? current.title.trim() || current.description : range ? range.raw : current.description;
    if (!source.trim()) {
      message.warning(def.target === "title" ? "先写一句内容或标题，AI 才有依据" : "先写点内容，AI 才有依据");
      return;
    }
    rangeRef.current = range;
    setRangeLen(range ? range.raw.trim().length : 0);
    let cfg;
    try {
      cfg = await window.fanpost.getAiConfig();
    } catch (err) {
      message.error("读取模型设置失败：" + (err instanceof Error ? err.message : String(err)));
      return;
    }
    if (!cfg.ready) {
      setAction(def);
      actionRef.current = def;
      setOpen(true);
      setError(cfg.providers.length ? AI_ERRORS.notReady : AI_ERRORS.missing);
      setOutput("");
      setTitles([]);
      return;
    }
    const provider = cfg.providers.find((p) => p.id === cfg.active) || cfg.providers[0];
    setModel(provider?.model || "");
    setAction(def);
    actionRef.current = def;
    setOpen(true);
    setLoading(true);
    setError("");
    setNotice("");
    setOutput("");
    setTitles([]);
    setPicked("");
    setElapsed(0);
    const requestId = newRequestId();
    rid.current = requestId;
    startedAt.current = Date.now();
    const limit = def.target === "title" ? limitRef.current : undefined;
    try {
      const r = await window.fanpost.runAi({
        requestId,
        action: def.key,
        text: source,
        type,
        ...(platform ? { platform } : {}),
        ...(limit === undefined ? {} : { limit }),
      });
      if (!r.ok) {
        setLoading(false);
        failWith(r.error || "调用失败", r.text || "");
      }
    } catch (err) {
      setLoading(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const applyBody = (mode: "replace" | "append") => {
    const text = output.trim();
    if (!text) return;
    const current = valueRef.current;
    const base = current.description;
    const range = rangeRef.current;
    if (mode === "replace" && range) {
      const hit = locateRange(base, range);
      if (!hit) {
        // 宁可不动，也别把整篇替换掉
        message.warning("正文已经改过，找不到刚才选中的那段了。结果留在窗口里，手动复制一下");
        return;
      }
      onApplied?.(base);
      onChange({ ...current, description: base.slice(0, hit.start) + keepEdgeSpace(range.raw, text) + base.slice(hit.end) });
      message.success("已替换选中的 " + range.raw.trim().length + " 字");
      close();
      return;
    }
    const trimmedBase = base.trim();
    onApplied?.(base);
    onChange({
      ...current,
      description: mode === "replace" || !trimmedBase ? text : trimmedBase + "\n\n" + text,
    });
    message.success(mode === "replace" ? "已替换正文" : "已追加到正文");
    close();
  };

  const applyTopics = () => {
    const list = parseTopicLine(output);
    if (!list.length) return;
    const merged = Array.from(new Set([...valueRef.current.topics, ...list]));
    onChange({ ...valueRef.current, topics: merged });
    message.success("已加入 " + list.length + " 个话题");
    setOpen(false);
  };

  const applyTitle = () => {
    if (!picked) return;
    onChange({ ...valueRef.current, title: picked });
    message.success("已使用该标题");
    setOpen(false);
  };

  const target = action?.target;
  const scope = scopeLabel(platform, platforms);
  const max = limitRef.current;
  const selLen = selection ? value.description.slice(selection.start, selection.end).trim().length : 0;

  return (
    <>
      <div className="ai-assist">
        <span className="ai-assist-label">AI</span>
        {ACTIONS.filter((a) => !(hideTitle && a.target === "title")).map((a) => (
          <Button key={a.key} size="small" type="text" disabled={disabled} title={a.tip} onClick={() => void run(a)}>
            {a.label}
          </Button>
        ))}
        {children}
        {selLen > 0 && <span className="ai-assist-sel">已选中 {selLen} 字，只改这一段</span>}
      </div>

      <Modal
        open={open}
        width={640}
        title={"AI " + (action?.label || "") + (rangeLen ? " · 选中 " + rangeLen + " 字" : "") + " · " + scope}
        onCancel={close}
        maskClosable={!loading}
        footer={
          <div className="ai-modal-footer">
            <span className="ai-modal-meta">
              {model && "模型：" + model}
              {elapsed > 0 && " · 耗时 " + (elapsed / 1000).toFixed(1) + "s"}
            </span>
            {loading ? (
              <Button onClick={stop}>停止</Button>
            ) : (
              <Button onClick={close}>关闭</Button>
            )}
            {!loading && !error && target === "body" && (
              <>
                <Button onClick={() => applyBody("append")} disabled={!output.trim()}>追加到正文</Button>
                <Button type="primary" onClick={() => applyBody("replace")} disabled={!output.trim()}>
                  {rangeLen ? "替换选中" : "替换正文"}
                </Button>
              </>
            )}
            {!loading && !error && target === "topics" && (
              <Button type="primary" onClick={applyTopics} disabled={!output.trim()}>加入话题</Button>
            )}
            {!loading && !error && target === "title" && (
              <Button type="primary" onClick={applyTitle} disabled={!picked}>使用这个标题</Button>
            )}
          </div>
        }
      >
        {error ? (
          <Alert type="warning" showIcon title={error} />
        ) : (
          <>
            {notice && <Alert className="ai-notice" type="info" showIcon title={notice} />}
            {target === "title" ? (
              titles.length ? (
                <div className="ai-titles">
                  {titles.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={"ai-title-item" + (t === picked ? " is-picked" : "")}
                      onClick={() => setPicked(t)}
                    >
                      {t}
                    </button>
                  ))}
                  <small className="ai-modal-meta">
                    {"已按 " + scope + " 的标题上限" + (max ? "（" + max + " 字）" : "") + "自动截断，点一条选中"}
                  </small>
                </div>
              ) : (
                <div className="ai-stream-box">{output || (loading ? "正在生成…" : "")}</div>
              )
            ) : (
              <Input.TextArea
                className="ai-stream-box"
                value={output}
                autoSize={{ minRows: 8, maxRows: 16 }}
                placeholder={loading ? "正在生成…" : ""}
                onChange={(e) => setOutput(e.target.value)}
              />
            )}
            {target !== "title" && (
              <small className="ai-modal-meta">
                {loading
                  ? "生成中，内容可直接编辑；关闭窗口会中断本次调用"
                  : rangeLen
                    ? "只替换选中的 " + rangeLen + " 字，前后文保持不动"
                    : "结果可以直接在这里改，确认后再应用"}
              </small>
            )}
          </>
        )}
      </Modal>
    </>
  );
}

/* ---------- 一稿多平台 ---------- */

interface DraftItem {
  platform: Platform;
  status: "idle" | "running" | "done" | "error";
  text: string;
  error?: string;
  adopted?: boolean;
}

/**
 * 一份内容 → 各平台各写一版。
 * 串行调 rewrite（并行会把中转站的并发限制撞出来），每版标清状态，改完点「采纳」写进该平台的独立文案。
 */
export function MultiDraft({
  value,
  platforms,
  type,
  onAdopt,
  disabled,
}: {
  value: string;
  platforms: Platform[];
  type: ContentType;
  onAdopt: (platform: Platform, text: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Platform[]>(platforms);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState("");
  const itemsRef = useRef<DraftItem[]>([]);
  /** requestId → 第几项。事件可能比 invoke 的 resolve 晚到，不能只盯「当前那一个」 */
  const pendingRef = useRef<Map<string, number>>(new Map());
  const ridRef = useRef("");
  const stopRef = useRef(false);

  const commit = (next: DraftItem[]) => {
    itemsRef.current = next;
    setItems(next);
  };
  const patch = (index: number, part: Partial<DraftItem>) => {
    commit(itemsRef.current.map((it, i) => (i === index ? { ...it, ...part } : it)));
  };

  useEffect(() => {
    const offDelta = window.fanpost.onAiDelta((p) => {
      const i = pendingRef.current.get(p.requestId);
      if (i === undefined) return;
      const cur = itemsRef.current[i];
      if (!cur || cur.status !== "running") return;
      patch(i, { text: cur.text + p.delta });
    });
    const offDone = window.fanpost.onAiDone((p) => {
      const i = pendingRef.current.get(p.requestId);
      if (i === undefined) return;
      pendingRef.current.delete(p.requestId);
      const cur = itemsRef.current[i];
      if (!cur || cur.status !== "running") return;
      patch(i, p.ok ? { status: "done", text: p.text || cur.text } : { status: "error", error: p.error || "调用失败" });
    });
    return () => {
      offDelta();
      offDone();
    };
    // patch 只读 ref，不需要重注册
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => {
    stopRef.current = true;
    if (ridRef.current) void window.fanpost.cancelAi(ridRef.current);
    ridRef.current = "";
    setRunning(false);
    setStep("");
    setOpen(false);
  };

  const start = async () => {
    const text = value.trim();
    if (!text) {
      message.warning("先在正文里写点内容，AI 才有依据");
      return;
    }
    if (!picked.length) {
      message.warning("至少选一个平台");
      return;
    }
    const list: DraftItem[] = picked.map((p) => ({ platform: p, status: "idle", text: "" }));
    commit(list);
    setRunning(true);
    stopRef.current = false;
    for (let i = 0; i < list.length; i++) {
      if (stopRef.current) break;
      setStep("正在生成 " + (i + 1) + "/" + list.length + " · " + platformMap[list[i].platform].name);
      patch(i, { status: "running" });
      const requestId = newRequestId();
      pendingRef.current.set(requestId, i);
      ridRef.current = requestId;
      try {
        const r = await window.fanpost.runAi({ requestId, action: "rewrite", text, type, platform: list[i].platform });
        // 结果以返回值为准：事件可能还没到，不能让这一项一直挂在「生成中」
        pendingRef.current.delete(requestId);
        patch(i, r.ok ? { status: "done", text: r.text || itemsRef.current[i]?.text || "" } : { status: "error", error: r.error || "调用失败" });
      } catch (err) {
        pendingRef.current.delete(requestId);
        patch(i, { status: "error", error: err instanceof Error ? err.message : String(err) });
      }
    }
    ridRef.current = "";
    setRunning(false);
    setStep(stopRef.current ? "已停止，已生成的版本仍在下面" : "");
  };

  const adopt = (index: number) => {
    const it = itemsRef.current[index];
    if (!it || !it.text.trim()) return;
    onAdopt(it.platform, it.text.trim());
    patch(index, { adopted: true });
    message.success("已写入「" + platformMap[it.platform].name + "」的独立文案");
  };

  const ready = items.filter((i) => i.status === "done").length;
  const meta = running
    ? step
    : items.length
      ? "已生成 " + ready + "/" + items.length + (step ? " · " + step : "")
      : platforms.length + " 个平台可选";

  return (
    <>
      <Button
        size="small"
        type="text"
        disabled={disabled || platforms.length < 2}
        title={platforms.length < 2 ? "至少选两个发布平台" : "同一份内容，按各平台口味各写一版"}
        onClick={() => {
          setPicked(platforms);
          commit([]);
          setStep("");
          setOpen(true);
        }}
      >
        一稿多平台
      </Button>
      <Modal
        open={open}
        width={720}
        title="一稿多平台 · 按平台各写一版"
        onCancel={close}
        maskClosable={!running}
        footer={
          <div className="ai-modal-footer">
            <span className="ai-modal-meta">{meta}</span>
            {running ? (
              <Button onClick={close}>停止</Button>
            ) : (
              <>
                <Button onClick={close}>关闭</Button>
                <Button type="primary" onClick={() => void start()} disabled={!picked.length}>
                  {items.length ? "重新生成" : "开始生成"}
                </Button>
              </>
            )}
          </div>
        }
      >
        {!items.length ? (
          <div className="multi-draft-pick">
            <p className="ai-modal-meta">选要生成哪几个平台的版本。生成时一个一个来，每版都能改，改完点「采纳」写进该平台的独立文案。</p>
            <Checkbox.Group
              value={picked}
              onChange={(v) => setPicked(v as Platform[])}
              options={platforms.map((p) => ({ value: p, label: platformMap[p].name }))}
            />
            <small className="ai-modal-meta">整篇重写，会比单次润色慢：云端约 3–5 秒/平台；本地模型约 20–60 秒/平台，建议留给云端。</small>
          </div>
        ) : (
          <div className="multi-draft-list">
            {items.map((it, i) => (
              <div key={it.platform} className={"multi-draft-item is-" + it.status}>
                <div className="multi-draft-head">
                  <PlatformLogo platform={it.platform} />
                  <b>{platformMap[it.platform].name}</b>
                  <em className="multi-draft-state">
                    {it.status === "running"
                      ? "生成中…"
                      : it.status === "error"
                        ? "失败"
                        : it.status === "done"
                          ? it.text.trim().length + " 字"
                          : "等待"}
                  </em>
                  {it.status === "done" && (
                    <Button size="small" type={it.adopted ? "text" : "primary"} disabled={it.adopted} onClick={() => adopt(i)}>
                      {it.adopted ? "已采纳" : "采纳"}
                    </Button>
                  )}
                </div>
                {it.status === "error" ? (
                  <Alert type="warning" showIcon title={it.error} />
                ) : (
                  <Input.TextArea
                    value={it.text}
                    autoSize={{ minRows: 2, maxRows: 6 }}
                    placeholder={it.status === "running" ? "正在生成…" : ""}
                    onChange={(e) => patch(i, { text: e.target.value, adopted: false })}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}
