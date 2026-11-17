import { useEffect, useMemo, useState, type RefObject } from "react";
import { Alert, Badge, Button, Checkbox, DatePicker, Empty, Image, InputNumber, Modal, Popover, Select, Space, Switch, Tabs, Tag, message } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { ClockCircleOutlined, DownOutlined, SaveOutlined, SendOutlined, ThunderboltOutlined } from "@ant-design/icons";
import type { AppData, ContentOverrides, ContentType, Platform, SavedDraft } from "../../shared/types";
import { BLANK_SNAPSHOT, snapshotKey, type ComposerSnapshot, type DraftInput } from "../../shared/drafts";
import { platformMap } from "../../shared/platforms";
import { checkContent, isAssisted, supportsType } from "../../shared/platform-rules";
import { accountLabel, accountWho } from "../../shared/accounts";
import { DECLARATIONS, DECLARATION_LABELS, DEFAULT_DECLARATION, declarationGaps, type Declaration } from "../../shared/declarations";
import { PlatformLogo } from "./PlatformLogo";
import { useCollapsed } from "./collapse";
import { handleQuota } from "./LicensePanel";
import { MediaPicker, fileName } from "./MediaPicker";
import { ContentFields, PlatformTab, RuleStrip, effective, type CommonContent, type OverrideState } from "./PlatformEditor";
import { RULES_MISSING, reviewSafety } from "../../shared/safety-review";
import { useSafetyRules, safetyReason } from "./safety";
import { HelpLink } from "./Tutorial";
import { SCHEDULE_HINT } from "../../shared/schedule";

const COVER_TIMEOUT_MS = 20000;
const blankContent: CommonContent = { title: "", description: "", topics: [] };

export interface LeaveGuard {
  isDirty: () => boolean;
  save: () => Promise<boolean>;
  text?: { title: string; body: string; save: string };
}
const snapshotOf = (d: SavedDraft): ComposerSnapshot => ({
  media: d.mediaPaths,
  cover: d.coverPath,
  title: d.title,
  description: d.description,
  topics: d.topics,
  overrides: d.overrides,
  declaration: d.declaration,
  original: d.original,
});

const ORIGINAL_KEY = "fanpost.original";
function loadOriginal() {
  try {
    return localStorage.getItem(ORIGINAL_KEY) === "1";
  } catch {
    return false;
  }
}
function saveOriginal(on: boolean) {
  try {
    localStorage.setItem(ORIGINAL_KEY, on ? "1" : "0");
  } catch {
    return;
  }
}

export function PublishComposer({
  type,
  data,
  setData,
  onStarted,
  initial,
  guard,
  onSaved,
  scheduleApi,
  onScheduledAt,
}: {
  type: ContentType;
  data: AppData;
  setData: (d: AppData) => void;
  onStarted: () => void;
  initial?: SavedDraft;
  guard: RefObject<LeaveGuard | undefined>;
  onSaved: (draft: SavedDraft) => void;
  /** 顶栏「定时发布」按钮借用这里的状态和动作 */
  scheduleApi?: RefObject<{ open: () => void; cancel: () => void } | undefined>;
  onScheduledAt?: (at: string | undefined) => void;
}) {
  const isVideo = type === "video";
  const [media, setMedia] = useState<string[]>(initial?.mediaPaths ?? []),
    [cover, setCover] = useState<string | undefined>(initial?.coverPath),
    [coverPreview, setCoverPreview] = useState(""),
    [common, setCommon] = useState<CommonContent>(
      initial ? { title: initial.title, description: initial.description, topics: initial.topics } : blankContent,
    ),
    [overrides, setOverrides] = useState<Partial<Record<Platform, OverrideState>>>(initial?.overrides ?? {}),
    [declaration, setDeclaration] = useState<Declaration>(initial?.declaration ?? DEFAULT_DECLARATION),
    [original, setOriginalState] = useState<boolean>(initial ? !!initial.original : loadOriginal()),
    [accountIds, setAccountIds] = useState<string[]>([]),
    [tab, setTab] = useState<string>("common"),
    [submitting, setSubmitting] = useState(false),
    [draftId, setDraftId] = useState(initial?.id),
    [baseline, setBaseline] = useState(() => snapshotKey(initial ? snapshotOf(initial) : BLANK_SNAPSHOT)),
    [saving, setSaving] = useState(false),
    [scheduledAt, setScheduledAt] = useState<string | undefined>(initial?.scheduledAt),
    [scheduled, setScheduled] = useState<{ id: string; at: string } | undefined>(undefined),
    [pickOpen, setPickOpen] = useState(false),
    [draftTime, setDraftTime] = useState<Dayjs | null>(null);
  const usable = useMemo(() => data.accounts.filter((a) => supportsType(a.platform, type)), [data.accounts, type]);
  const unsupported = useMemo(
    () => Array.from(new Set(data.accounts.filter((a) => !supportsType(a.platform, type)).map((a) => a.platform))),
    [data.accounts, type],
  );
  const collapse = useCollapsed("pick");
  useEffect(() => {
    const saved = initial ? initial.accountIds : data.accountSelections[type];
    setAccountIds(
      saved === undefined
        ? usable.map((a) => a.id)
        : saved.filter((id) => usable.some((a) => a.id === id)),
    );
  }, [type, usable.length]);
  useEffect(() => {
    if (!initial?.coverPath) return;
    let alive = true;
    window.fanpost
      .readThumb(initial.coverPath)
      .then((url) => alive && setCoverPreview(url))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  const topicOptions = useMemo(
    () => Array.from(new Set([...data.savedDrafts, ...data.drafts].flatMap((d) => d.topics))).slice(0, 30),
    [data.drafts, data.savedDrafts],
  );
  const currentKey = snapshotKey({ media, cover, ...common, overrides, declaration, original });
  const setOriginal = (on: boolean) => {
    setOriginalState(on);
    saveOriginal(on);
  };
  const hasContent = currentKey !== snapshotKey({ ...BLANK_SNAPSHOT, declaration, original });
  const dirty = currentKey !== baseline && (!!draftId || hasContent);
  async function saveDraft(): Promise<boolean> {
    if (saving) return false;
    if (!hasContent) {
      message.info("还没有填写内容，无需保存");
      return false;
    }
    const input: DraftInput = {
      type,
      title: common.title,
      description: common.description,
      topics: common.topics,
      mediaPaths: media,
      ...(cover ? { coverPath: cover } : {}),
      accountIds,
      overrides,
      declaration,
      ...(original ? { original: true } : {}),
      ...(initial?.source ? { source: initial.source } : {}),
    };
    try {
      setSaving(true);
      const result = await window.fanpost.saveDraft(draftId, input);
      setData(result.data);
      setDraftId(result.id);
      setBaseline(currentKey);
      const saved = result.data.savedDrafts.find((d) => d.id === result.id);
      if (saved) onSaved(saved);
      message.success("草稿已保存");
      return true;
    } catch (error) {
      message.error("保存草稿失败：" + (error instanceof Error ? error.message : String(error)));
      return false;
    } finally {
      setSaving(false);
    }
  }
  useEffect(() => {
    void window.fanpost.setDirty(dirty);
  }, [dirty]);
  useEffect(() => () => void window.fanpost.setDirty(false), []);
  useEffect(() => {
    guard.current = { isDirty: () => dirty, save: saveDraft };
    return () => {
      guard.current = undefined;
    };
  });
  const groups = useMemo(() => {
    const map = new Map<Platform, typeof usable>();
    for (const a of usable) map.set(a.platform, [...(map.get(a.platform) || []), a]);
    return Array.from(map.entries());
  }, [usable]);
  const selectedPlatforms = useMemo(
    () =>
      Array.from(
        new Set(usable.filter((a) => accountIds.includes(a.id)).map((a) => a.platform)),
      ),
    [usable, accountIds],
  );
  const offlineSelected = usable.filter(
    (a) => accountIds.includes(a.id) && a.loginStatus === "logged_out",
  );
  const imageCount = isVideo ? 0 : media.length;
  const issues = selectedPlatforms.flatMap((p) =>
    checkContent(p, type, effective(common, overrides[p]), imageCount).map((i, n) => ({
      key: p + n,
      platform: p,
      level: i.level,
      text: platformMap[p].name + "：" + i.text,
    })),
  );
  const blocking = issues.filter((i) => i.level === "error");
  const declarationMissing = declarationGaps(selectedPlatforms, type, declaration);
  const safety = useSafetyRules();
  const settings = data.settings;
  const multiPlatforms = selectedPlatforms
    .map((p) => [p, usable.filter((a) => a.platform === p && accountIds.includes(a.id)).length] as const)
    .filter(([, n]) => n > 1);
  const estimateMin = (() => {
    if (accountIds.length < 2) return 0;
    const limit = isVideo ? settings.videoConcurrency : settings.imageConcurrency;
    const maxSame = Math.max(1, ...multiPlatforms.map(([, n]) => n));
    const rounds = Math.ceil(accountIds.length / limit);
    return Math.round(Math.max(rounds * (isVideo ? 5 : 2), (maxSame - 1) * settings.samePlatformGapMin));
  })();
  const saveSelection = async (ids: string[]) => {
    setAccountIds(ids);
    try {
      setData(await window.fanpost.setAccountSelection(type, ids));
    } catch (error) {
      message.error("保存账号选择失败：" + (error instanceof Error ? error.message : String(error)));
    }
  };
  const extractCover = async (videoPath: string) => {
    try {
      const generated = await Promise.race([
        window.fanpost.extractCover(videoPath),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("封面提取超过20秒，请重试")), COVER_TIMEOUT_MS),
        ),
      ]);
      if (generated) {
        setCover(generated.path);
        setCoverPreview(generated.dataUrl);
      }
    } catch (error) {
      message.error("封面提取失败：" + (error instanceof Error ? error.message : String(error)));
    }
  };
  const onMedia = async (next: string[]) => {
    setMedia(next);
    if (!isVideo) return;
    setCover(undefined);
    setCoverPreview("");
    if (!next[0]) return;
    const base = fileName(next[0]).replace(/\.[^.]+$/, "");
    setCommon((c) => ({ ...c, title: c.title || base, description: c.description || base }));
    await extractCover(next[0]);
  };
  const pickCover = async () => {
    const [picked] = await window.fanpost.pickFiles("cover");
    if (!picked) return;
    setCover(picked);
    setCoverPreview(await window.fanpost.readThumb(picked).catch(() => ""));
  };
  const buildOverrides = (): ContentOverrides | undefined => {
    const result: ContentOverrides = {};
    for (const p of selectedPlatforms) {
      const own = overrides[p];
      const extra = { ...(own?.question?.trim() ? { question: own.question.trim() } : {}), ...(own?.zone ? { zone: own.zone } : {}) };
      if (!own?.enabled) {
        if (Object.keys(extra).length) result[p] = extra;
        continue;
      }
      result[p] = { title: own.title, description: own.description, topics: own.topics, ...extra };
    }
    return Object.keys(result).length ? result : undefined;
  };
  const source = initial?.source;
  const safetyItems = safety.rules
    ? reviewSafety(safety.rules, {
        draft: { type, title: common.title, description: common.description, topics: common.topics, overrides: buildOverrides(), declaration, original, accountIds },
        accounts: usable,
        log: data.publishLog,
        source,
        now: Date.now(),
      })
    : [];
  const safetyBlocks = safetyItems.filter((i) => i.level === "block");
  const safetyWarns = safetyItems.filter((i) => i.level === "warn");
  function submit(auto = false) {
    if (submitting) return;
    if (!media.length) return message.error(isVideo ? "请先添加视频" : "请先添加图片");
    if (!common.title.trim()) {
      setTab("common");
      return message.error("请填写通用标题");
    }
    if (!accountIds.length) return message.error("请至少选择一个账号");
    if (safety.loaded && !safety.rules) return message.error(RULES_MISSING);
    if (safetyBlocks.length)
      return Modal.error({
        title: "安全检查没通过，不能发布",
        content: <ul className="confirm-issues">{safetyBlocks.map((i, n) => <li key={n}>{i.text}</li>)}</ul>,
        okText: "回去修改",
      });
    const afterWarn = () => (auto ? confirmAuto() : void launch(false));
    const go = () =>
      safetyWarns.length
        ? Modal.confirm({
            title: safetyWarns.length + " 处内容有违规风险",
            content: <ul className="confirm-issues">{safetyWarns.map((i, n) => <li key={n}>{i.text}</li>)}</ul>,
            okText: "我已确认，继续",
            cancelText: "回去修改",
            onOk: afterWarn,
          })
        : afterWarn();
    if (!blocking.length) return go();
    Modal.confirm({
      title: blocking.length + " 处内容不符合平台规则",
      content: (
        <ul className="confirm-issues">
          {blocking.map((i) => (
            <li key={i.key}>{i.text}</li>
          ))}
        </ul>
      ),
      okText: "仍然填写（超长部分会被截断）",
      cancelText: "回去修改",
      onOk: go,
      onCancel: () => setTab(blocking[0].platform),
    });
  }
  function confirmAuto() {
    Modal.confirm({
      title: "一键自动发布到 " + accountIds.length + " 个账号？",
      content: "每个账号填好后会自动点击平台的「发布」，并到平台后台确认是否发出。发出后无法撤回，请先确认内容无误。",
      okText: "确认自动发布",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: () => void launch(true),
    });
  }
  useEffect(() => {
    onScheduledAt?.(scheduledAt);
  }, [scheduledAt]);
  useEffect(() => {
    if (!scheduleApi) return;
    scheduleApi.current = { open: () => setPickOpen(true), cancel: () => void scheduleAt(null) };
    return () => {
      scheduleApi.current = undefined;
    };
  });

  async function scheduleAt(at: string | null) {
    if (!media.length) return message.error(isVideo ? "请先添加视频" : "请先添加图片");
    if (!common.title.trim()) {
      setTab("common");
      return message.error("请填写通用标题");
    }
    if (!accountIds.length) return message.error("请至少选择一个账号");
    try {
      setSubmitting(true);
      if (!at) {
        if (scheduled?.id) await window.fanpost.removeHistory([scheduled.id]);
        setScheduled(undefined);
        setScheduledAt(undefined);
        message.success("已取消定时");
        return;
      }
      const created = await window.fanpost.createPublish({
        type,
        title: common.title.trim(),
        description: common.description,
        topics: common.topics,
        mediaPaths: media,
        coverPath: cover,
        accountIds,
        overrides: buildOverrides(),
        declaration,
        autoSubmit: true,
        ...(original ? { original: true } : {}),
        ...(source ? { source } : {}),
      });
      const pid = created.drafts[0].id;
      if (scheduled?.id && scheduled.id !== pid) await window.fanpost.removeHistory([scheduled.id]).catch(() => undefined);
      setData(draftId ? await window.fanpost.removeDraft(draftId).catch(() => created) : created);
      const r = await window.fanpost.setPublishSchedule(pid, at);
      setData(r);
      setScheduled({ id: pid, at });
      setScheduledAt(at);
      setBaseline(currentKey);
      message.success("已排进定时队列：" + dayjs(at).format("MM-DD HH:mm") + " 开始自动填写并发布", 5);
      onStarted();
    } catch (error) {
      if (!handleQuota(error)) message.error(safetyReason(error) || "设定时失败：" + (error instanceof Error ? error.message : String(error)));
    } finally {
      setSubmitting(false);
      setPickOpen(false);
    }
  }

  async function launch(auto: boolean) {
    try {
      setSubmitting(true);
      const created = await window.fanpost.createPublish({
        type,
        title: common.title.trim(),
        description: common.description,
        topics: common.topics,
        mediaPaths: media,
        coverPath: cover,
        accountIds,
        overrides: buildOverrides(),
        declaration,
        ...(original ? { original: true } : {}),
        ...(source ? { source } : {}),
        ...(auto ? { autoSubmit: true } : {}),
      });
      setBaseline(currentKey);
      setData(draftId ? await window.fanpost.removeDraft(draftId).catch(() => created) : created);
      message.success(auto ? "已开始自动发布，进度见顶栏和发布记录" : "已开始填写，进度见顶栏和发布记录");
      onStarted();
      window.fanpost
        .autoPublish(created.drafts[0].id)
        .then(setData)
        .catch((error) => { if (!handleQuota(error)) message.error(safetyReason(error) || String(error instanceof Error ? error.message : error)); });
    } catch (error) {
      if (!handleQuota(error)) message.error(safetyReason(error) || "创建发布任务失败：" + (error instanceof Error ? error.message : String(error)));
    } finally {
      setSubmitting(false);
    }
  }
  const tabItems = [
    {
      key: "common",
      label: "通用内容",
      children: (
        <ContentFields
          type={type}
          value={common}
          onChange={setCommon}
          topicOptions={topicOptions}
          platforms={selectedPlatforms}
          onPlatformDraft={(p, text) =>
            setOverrides((o) => ({
              ...o,
              [p]: {
                ...(o[p] || {}),
                enabled: true,
                title: o[p]?.title ?? common.title,
                description: text,
                topics: o[p]?.topics ?? common.topics,
              },
            }))
          }
        />
      ),
    },
    ...selectedPlatforms.map((p) => {
      const own = overrides[p];
      const hasIssue = issues.some((i) => i.platform === p);
      return {
        key: p,
        label: (
          <span className="platform-tab-label">
            <PlatformLogo platform={p} />
            {platformMap[p].name}
            {hasIssue ? <Badge status="error" /> : own?.enabled ? <Badge status="processing" /> : null}
          </span>
        ),
        children: (
          <PlatformTab
            platform={p}
            type={type}
            common={common}
            own={own}
            topicOptions={topicOptions}
            imageCount={imageCount}
            onChange={(next) => setOverrides((o) => ({ ...o, [p]: next }))}
          />
        ),
      };
    }),
  ];
  const ready = media.length > 0 && !!common.title.trim() && accountIds.length > 0;
  return (
    <div className="composer">
      <div className="composer-main">
        <section className="panel step">
          <header className="step-head">
            <span className="step-no num">01</span>
            <div>
              <h3>{isVideo ? "视频与封面" : "图片素材"}</h3>
              <p className="muted">{isVideo ? "单个视频，自动截取首帧作封面" : "可多选，第一张作为首图"}</p>
            </div>
          </header>
          <MediaPicker type={type} media={media} onChange={(next) => void onMedia(next)} />
          {isVideo && media[0] && (
            <div className="cover-row">
              {coverPreview ? <Image className="cover-preview" src={coverPreview} alt="视频封面" width={200} /> : <div className="cover-empty">暂无封面</div>}
              <Space direction="vertical">
                <Button onClick={() => void extractCover(media[0])}>重新提取首帧</Button>
                <Button onClick={() => void pickCover()}>选择封面图片</Button>
                {cover && <Tag>{fileName(cover)}</Tag>}
              </Space>
            </div>
          )}
        </section>
        <section className="panel step">
          <header className="step-head">
            <span className="step-no num">02</span>
            <div>
              <h3>内容</h3>
              <p className="muted">通用内容会同步到所有平台；需要差异化时切到平台标签页单独改</p>
            </div>
          </header>
          {selectedPlatforms.length === 0 && <Alert type="info" showIcon className="composer-tip" title="先在右侧选择发布账号，这里会出现对应平台的标签页" />}
          <RuleStrip platforms={selectedPlatforms} type={type} common={common} overrides={overrides} imageCount={imageCount} onOpen={setTab} />
          <Tabs activeKey={tab} onChange={setTab} items={tabItems} className="content-tabs" />
        </section>
      </div>
      <aside className="composer-side">
        <section className="panel step">
          <header className="step-head">
            <span className="step-no num">03</span>
            <div>
              <h3>发布账号</h3>
              <p className="muted">记住上次的选择</p>
            </div>
            <HelpLink topic="pick" label="" />
          </header>
          {usable.length === 0 ? (
            <Empty description={data.accounts.length ? "已添加的账号都不支持" + (isVideo ? "视频" : "图文") + "，请先到账号页添加" : "还没有账号，请先到账号页添加"} />
          ) : (
            <>
              <Checkbox
                checked={accountIds.length === usable.length}
                indeterminate={accountIds.length > 0 && accountIds.length < usable.length}
                onChange={(e) => void saveSelection(e.target.checked ? usable.map((a) => a.id) : [])}
              >
                全选 {usable.length} 个账号
              </Checkbox>
              <div className="account-groups">
                {groups.map(([platform, list]) => {
                  const ids = list.map((a) => a.id);
                  const picked = ids.filter((id) => accountIds.includes(id)).length;
                  const multi = list.length > 1;
                  const toggleAll = () =>
                    void saveSelection(
                      picked === list.length
                        ? accountIds.filter((id) => !ids.includes(id))
                        : Array.from(new Set([...accountIds, ...ids])),
                    );
                  const toggle = (id: string) =>
                    void saveSelection(accountIds.includes(id) ? accountIds.filter((x) => x !== id) : [...accountIds, id]);
                  const assisted = isAssisted(platform, type);
                  const offline = list.some((a) => a.loginStatus === "logged_out");
                  const closed = multi && collapse.isCollapsed(platform);
                  return (
                    <div className={"pick-row" + (picked ? " on" : "") + (multi ? " is-multi" : "") + (closed ? " is-closed" : "")} key={platform}>
                      <div className="pick-head">
                        <button
                          type="button"
                          className="pick-platform"
                          aria-pressed={picked === list.length}
                          onClick={multi ? toggleAll : () => toggle(list[0].id)}
                          title={multi ? (picked === list.length ? "取消全部" : "全选该平台") : accountWho(list[0]) + (offline ? "（已掉线）" : "")}
                        >
                          <span className={"pick-check" + (picked === list.length ? " full" : picked ? " part" : "")} />
                          <PlatformLogo platform={platform} />
                          <b>{platformMap[platform].name}</b>
                          {assisted && <small className="pick-tag">辅助</small>}
                          {!multi && offline && <i className="dot is-logged_out pick-off" aria-label="已掉线" />}
                          {multi && <span className="pick-count num">{picked}/{list.length}</span>}
                        </button>
                        {multi && (
                          <button
                            type="button"
                            className="pick-fold"
                            aria-expanded={!closed}
                            aria-label={closed ? "展开账号" : "收起账号"}
                            onClick={() => collapse.toggle(platform)}
                          >
                            <DownOutlined aria-hidden />
                          </button>
                        )}
                      </div>
                      {multi && !closed && (
                        <div className="pick-accounts">
                          {list.map((a) => {
                            const on = accountIds.includes(a.id);
                            return (
                              <button
                                key={a.id}
                                type="button"
                                aria-pressed={on}
                                className={"pick-account" + (on ? " on" : "") + (a.loginStatus === "logged_out" ? " off" : "")}
                                onClick={() => toggle(a.id)}
                                title={accountWho(a) + (a.remark ? "（" + a.name + "）" : "")}
                              >
                                <i className={"dot is-" + a.loginStatus} />
                                <span className="chip-text">{accountLabel(a)}</span>
                                {a.loginStatus === "logged_out" && <small className="bad">掉线</small>}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {unsupported.length > 0 && (
                <div className="pick-unsupported" aria-label={"暂不支持" + (isVideo ? "视频" : "图文") + "的平台"}>
                  <span>暂不支持{isVideo ? "视频" : "图文"}</span>
                  {unsupported.map((p) => (
                    <span key={p} className="pick-unsupported-item" title={platformMap[p].name + "暂不支持" + (isVideo ? "视频" : "图文") + "填写，账号不会被选入"}>
                      <PlatformLogo platform={p} />
                      {platformMap[p].name}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
        <section className={"panel launch" + (ready ? " is-ready" : "")}>
          <header className="step-head">
            <span className="step-no num">04</span>
            <div>
              <h3>发布前检查</h3>
            </div>
            <HelpLink topic="safety" label="" />
          </header>
          <ul className="check-list">
            <li className={media.length ? "ok" : "bad"}>{media.length ? (isVideo ? "已选视频" : "已选 " + media.length + " 张图") : "未添加素材"}</li>
            <li className={common.title.trim() ? "ok" : "bad"}>{common.title.trim() ? "通用标题已填写" : "通用标题未填写"}</li>
            <li className={accountIds.length ? "ok" : "bad"}>
              已选 {accountIds.length} 个账号 / {selectedPlatforms.length} 个平台
            </li>
            {multiPlatforms.length > 0 && (
              <li className="info">
                {multiPlatforms.map(([p, n]) => platformMap[p].name + " " + n + " 个号").join("、")}
                ：同平台账号自动错开 {settings.samePlatformGapMin} 分钟以上
              </li>
            )}
            {offlineSelected.map((a) => (
              <li key={a.id} className="bad">
                {accountWho(a)} 已掉线，请先重新登录
              </li>
            ))}
            {issues.length === 0 && selectedPlatforms.length > 0 && <li className="ok">内容符合各平台规则</li>}
            {safety.loaded && !safety.rules && <li className="bad">{RULES_MISSING}</li>}
            {safety.rules && safetyItems.length === 0 && selectedPlatforms.length > 0 && <li className="ok">安全检查通过</li>}
            {safetyItems.map((i, n) => (
              <li key={"s" + n} className={i.level === "block" ? "bad" : "warn"}>
                {i.platform ? <button type="button" className="link-btn" onClick={() => setTab(i.platform!)}>{i.text}</button> : i.text}
              </li>
            ))}
            {source && <li className="info">采集来源：{source.title || source.url}</li>}
            {issues.map((i) => (
              <li key={i.key} className={i.level === "error" ? "bad" : "warn"}>
                <button type="button" className="link-btn" onClick={() => setTab(i.platform)}>{i.text}</button>
              </li>
            ))}
          </ul>
          <div className="declare-row">
            <span>内容声明</span>
            <Select
              value={declaration}
              onChange={setDeclaration}
              options={DECLARATIONS.map((d) => ({ value: d, label: DECLARATION_LABELS[d] }))}
              popupMatchSelectWidth={false}
              aria-label="内容声明"
            />
          </div>
          <div className="declare-row">
            <span>声明原创</span>
            <Switch checked={original} onChange={setOriginal} aria-label="声明原创" />
          </div>
          <p className="declare-note">{original ? "目前只有小红书发布页有「原创声明」，会自动打开并同意《原创声明须知》；开关是灰的账号会跳过并在卡片上注明。其他平台页面上没有原创选项，不受影响。只有你本人创作的内容才能打开。" : "不声明原创。B站已没有「自制 / 转载」选项，「创作声明」默认「内容无需标注」，即按自制投稿。"}</p>
          {declarationMissing.length > 0 && (
            <p className="declare-note">{declarationMissing.map((p) => platformMap[p].name).join("、")}没有「{DECLARATION_LABELS[declaration]}」这一项，将不添加声明</p>
          )}
          {selectedPlatforms.includes("baijiahao") && (
            <p className="launch-note is-warn">
              百家号用「一键自动发布」时，点下「发布」后百度经常弹「安全验证」（拖动滑块把图片转正，或用百度 App 扫码）。这个验证只能你本人完成，软件会停下并弹通知提醒你；验证通过后，页面没自动发出就再点一次「发布」，发出后软件会自动去后台确认。同一批里多个百家号号，建议在设置里把「同平台账号错开」调长。
            </p>
          )}
          <p className="launch-note">
            不同平台同时进行（最多 {isVideo ? settings.videoConcurrency : settings.imageConcurrency} 个）
            {estimateMin > 0 ? "，预计约 " + estimateMin + " 分钟" : ""}。「一键填写」填好后停下由你检查发布；「一键自动发布」填好后自动点发布并核对结果。
          </p>
          <Button block icon={<SaveOutlined />} loading={saving} disabled={!hasContent} onClick={() => void saveDraft()} className="draft-btn">
            {draftId ? (dirty ? "保存草稿修改" : "草稿已保存") : "保存草稿"}
          </Button>
          <div className="launch-row">
            <Button size="large" icon={<SendOutlined />} loading={submitting} disabled={!usable.length} onClick={() => submit(false)} className="launch-btn">
              一键填写 <b className="num">{accountIds.length}</b>
            </Button>
            <Button type="primary" size="large" icon={<ThunderboltOutlined />} loading={submitting} disabled={!usable.length} onClick={() => submit(true)} className="launch-btn">
              一键自动发布
            </Button>
          </div>
        </section>
      </aside>

      <Modal
        open={pickOpen}
        title="定时发布"
        okText="保存"
        cancelText="取消"
        onCancel={() => setPickOpen(false)}
        onOk={() => {
          if (!draftTime) return message.warning("先选一个时间");
          if (draftTime.valueOf() < Date.now() + 60000) return message.warning("时间要晚于现在 1 分钟以上");
          void scheduleAt(draftTime.toISOString());
        }}
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <DatePicker
            showTime={{ format: "HH:mm" }}
            format="YYYY-MM-DD HH:mm"
            value={draftTime}
            onChange={(v) => setDraftTime(v)}
            placeholder="选日期和时间"
            style={{ width: "100%" }}
            disabledDate={(d) => d && d.startOf("day").valueOf() < dayjs().startOf("day").valueOf()}
          />
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            {[
              ["10 分钟后", 10],
              ["1 小时后", 60],
              ["今晚 8 点", -1],
              ["明早 9 点", -2],
            ].map(([label, hint]) => (
              <Button
                key={label as string}
                size="small"
                onClick={() => {
                  if (hint === -1) {
                    const t = dayjs().hour(20).minute(0).second(0);
                    setDraftTime(t.valueOf() < Date.now() ? t.add(1, "day") : t);
                  } else if (hint === -2) {
                    setDraftTime(dayjs().add(1, "day").hour(9).minute(0).second(0));
                  } else setDraftTime(dayjs().add(Number(hint), "minute"));
                }}
              >
                {label}
              </Button>
            ))}
          </div>
          <Alert
            type="warning"
            showIcon
            title="到点软件必须开着、电脑不能睡眠"
            description={<span style={{ whiteSpace: "pre-line" }}>{SCHEDULE_HINT}</span>}
          />
        </Space>
      </Modal>
    </div>
  );
}
