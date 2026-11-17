import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Checkbox, Empty, Input, Modal, Popconfirm, Segmented, Select, Space, Spin, Tag, Tooltip, message } from "antd";
import { CheckCircleFilled, CloseCircleFilled, FireOutlined, PictureOutlined, ReloadOutlined, RobotOutlined, SendOutlined, UserOutlined, VideoCameraOutlined, WarningOutlined } from "@ant-design/icons";
import type { Account, AppData, Platform } from "../../shared/types";

type GenKind = "image_text" | "video" | "both";
const KIND_LABEL: Record<GenKind, string> = { image_text: "图文", video: "视频", both: "图文 + 视频" };
const fitsKind = (platform: Platform, kind: GenKind) => (kind === "both" ? supportsType(platform, "image_text") || supportsType(platform, "video") : supportsType(platform, kind));
import { platformMap } from "../../shared/platforms";
import { supportsType } from "../../shared/platform-rules";
import { HOT_SOURCES, SAFETY_NOTICE, matrixSimilarity, type AccountProfile, type HotSourceId, type ScoredTopic } from "../../shared/hot";
import { accountLabel } from "../../shared/accounts";
import { PlatformLogo } from "./PlatformLogo";
import { HelpLink, openTutorial } from "./Tutorial";

const errText = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "").replace(/^FEATURE:/, "");
const ACK_KEY = "fanpost.hotAck";

function showError(e: unknown) {
  const text = errText(e);
  if (/模型|AI|Key|接口|余额|额度/.test(text)) {
    Modal.error({ title: "AI 模型调用失败", content: text, okText: "看接入说明", onOk: () => openTutorial("ai") });
    return;
  }
  message.error({ content: <span>{text} <a onClick={() => openTutorial("hot")}>查看说明</a></span>, duration: 6 });
}

interface Piece {
  accountId: string;
  platform: Account["platform"];
  title: string;
  description: string;
  topics: string[];
  error?: string;
}

interface GenResult {
  topic: string;
  pieces: Piece[];
  similar: Array<{ a: number; b: number; ratio: number }>;
}

const heatText = (n: number) => (n >= 1e8 ? (n / 1e8).toFixed(1) + "亿" : n >= 1e4 ? Math.round(n / 1e4) + "万" : n ? String(n) : "");

function readAck() {
  try {
    return localStorage.getItem(ACK_KEY) === "1";
  } catch {
    return false;
  }
}

function SafetyGate({ onOk }: { onOk: () => void }) {
  const [checked, setChecked] = useState(false);
  return (
    <section className="panel hot-gate">
      <h3><WarningOutlined /> 使用热点创作前请先看完</h3>
      <ol>{SAFETY_NOTICE.split("\n").map((t) => <li key={t}>{t}</li>)}</ol>
      <Checkbox checked={checked} onChange={(e) => setChecked(e.target.checked)}>我已阅读并同意《免责条款》：AI 内容会强制标注，发布前由我本人确认，违反平台规则造成的限流封号由我自行承担</Checkbox>
      <Space>
        <Button type="primary" disabled={!checked} onClick={() => {
          try {
            localStorage.setItem(ACK_KEY, "1");
          } catch {
            void 0;
          }
          onOk();
        }}>开始使用</Button>
        <HelpLink topic="hot" label="完整使用说明" />
        <HelpLink topic="disclaimer" label="免责条款" />
      </Space>
    </section>
  );
}

function ProfileEditor({ account, profile, onSaved }: { account: Account; profile?: AccountProfile; onSaved: (p: AccountProfile) => void }) {
  const [niche, setNiche] = useState(profile?.niche || "");
  const [audience, setAudience] = useState(profile?.audience || "");
  const [tone, setTone] = useState(profile?.tone || "");
  const [keywords, setKeywords] = useState((profile?.keywords || []).join("、"));
  const [avoid, setAvoid] = useState((profile?.avoid || []).join("、"));
  const [winning, setWinning] = useState(profile?.winning || "");
  const [busy, setBusy] = useState<"" | "learn" | "save">("");
  useEffect(() => {
    setNiche(profile?.niche || "");
    setAudience(profile?.audience || "");
    setTone(profile?.tone || "");
    setKeywords((profile?.keywords || []).join("、"));
    setAvoid((profile?.avoid || []).join("、"));
    setWinning(profile?.winning || "");
  }, [profile]);
  const learn = async () => {
    setBusy("learn");
    try {
      const p = await window.fanpost.hotLearn(account.id);
      onSaved(p);
      message.success("已根据作品生成画像，可以再手动改");
    } catch (e) {
      showError(e);
    } finally {
      setBusy("");
    }
  };
  const save = async () => {
    setBusy("save");
    try {
      onSaved(await window.fanpost.hotSaveProfile({ accountId: account.id, niche, audience, tone, keywords, avoid, winning }));
      message.success("画像已保存");
    } catch (e) {
      showError(e);
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="hot-profile">
      <div className="hot-profile-head">
        <PlatformLogo platform={account.platform} />
        <b>{accountLabel(account)}</b>
        {profile?.updatedAt && profile.niche ? <Tag color="green">已有画像</Tag> : <Tag>未建画像</Tag>}
        <span className="grow" />
        <Tooltip title="后台打开这个账号的作品管理页，读一次标题和数据，交给你配置的 AI 总结。同一账号 6 小时内只读一次。">
          <Button size="small" icon={<RobotOutlined />} loading={busy === "learn"} disabled={account.loginStatus !== "logged_in"} onClick={() => void learn()}>从作品自动生成</Button>
        </Tooltip>
      </div>
      <div className="hot-profile-grid">
        <label>领域<Input size="small" value={niche} maxLength={200} onChange={(e) => setNiche(e.target.value)} placeholder="例如：护肤、母婴、职场" /></label>
        <label>受众<Input size="small" value={audience} maxLength={200} onChange={(e) => setAudience(e.target.value)} placeholder="例如：25-35 岁上班族女性" /></label>
        <label>语气<Input size="small" value={tone} maxLength={200} onChange={(e) => setTone(e.target.value)} placeholder="例如：亲切、干货" /></label>
        <label>关键词<Input size="small" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="用顿号分隔，热点按这些词匹配" /></label>
        <label>禁区词<Input size="small" value={avoid} onChange={(e) => setAvoid(e.target.value)} placeholder="含这些词的热点不推荐" /></label>
        <label className="wide">效果好的规律（爆款结构）<Input.TextArea size="small" autoSize={{ minRows: 2, maxRows: 4 }} value={winning} maxLength={400} onChange={(e) => setWinning(e.target.value)} placeholder="自动生成时 AI 会对比数据高低的作品总结：标题句式、开头、篇幅、发布时段。写稿时会沿用。" /></label>
      </div>
      <div><Button size="small" type="primary" ghost loading={busy === "save"} onClick={() => void save()}>保存画像</Button></div>
    </div>
  );
}

export function HotPage({ data, setData, onGoDrafts }: { data: AppData; setData: (d: AppData) => void; onGoDrafts: (type: "image_text" | "video") => void }) {
  const [acked, setAcked] = useState(readAck);
  const [profiles, setProfiles] = useState<AccountProfile[]>([]);
  const [viewer, setViewer] = useState<string>("");
  const [sources, setSources] = useState<HotSourceId[]>(HOT_SOURCES.map((s) => s.id));
  const [items, setItems] = useState<ScoredTopic[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [onlyMatch, setOnlyMatch] = useState(false);
  const [topic, setTopic] = useState<ScoredTopic | undefined>();
  const [picked, setPicked] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GenResult | undefined>();
  const [edits, setEdits] = useState<Piece[]>([]);
  const [keep, setKeep] = useState<boolean[]>([]);
  const [saving, setSaving] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [suggests, setSuggests] = useState<Array<{ title: string; source: string; heat: number; angle: string; why: string; count?: number }>>([]);
  const [pickFrom, setPickFrom] = useState<"hot" | "comments">("hot");
  const [suggestOwner, setSuggestOwner] = useState("");
  const suggestSeq = useRef(0);
  const reviewRef = useRef<HTMLDivElement>(null);
  const listSeq = useRef(0);
  const [suggesting, setSuggesting] = useState(false);
  const [angle, setAngle] = useState("");
  const [cards, setCards] = useState<Record<number, { style: number; files: string[]; thumbs: string[] }>>({});
  const [cardBusy, setCardBusy] = useState(-1);
  const dropCards = (i: number) =>
    setCards((c) => {
      if (!c[i]) return c;
      const next = { ...c };
      delete next[i];
      return next;
    });
  const [kind, setKind] = useState<GenKind>("image_text");
  const [mode, setMode] = useState<"hot" | "own">("hot");
  const [material, setMaterial] = useState("");
  const [ownImages, setOwnImages] = useState<string[]>([]);
  const [ownVideo, setOwnVideo] = useState<string>();
  const accounts = useMemo(() => data.accounts.filter((a) => platformMap[a.platform] && a.platform !== "weixin"), [data.accounts]);
  const online = accounts.filter((a) => a.loginStatus === "logged_in");

  useEffect(() => {
    if (!acked) return;
    void window.fanpost.hotProfiles().then(setProfiles).catch((e) => showError(e));
  }, [acked]);

  const suggest = async () => {
    if (!viewer) return;
    const forAccount = viewer;
    const token = ++suggestSeq.current;
    setSuggesting(true);
    try {
      let next: typeof suggests;
      if (pickFrom === "comments") {
        const r = await window.fanpost.hotCommentTopics(forAccount);
        next = r.topics.map((t) => ({ title: t.title, source: "comments", heat: 0, angle: t.angle, why: t.why, count: t.count }));
        if (token === suggestSeq.current && !r.topics.length) message.info("读了 " + r.comments + " 条评论，没归纳出可写的选题");
      } else next = await window.fanpost.hotSuggest(forAccount);
      if (token !== suggestSeq.current) return;
      setSuggests(next);
      setSuggestOwner(forAccount);
    } catch (e) {
      if (token === suggestSeq.current) showError(e);
    } finally {
      if (token === suggestSeq.current) setSuggesting(false);
    }
  };

  useEffect(() => {
    suggestSeq.current++;
    setSuggests([]);
    setSuggestOwner("");
    setSuggesting(false);
  }, [viewer, pickFrom]);

  const pickSuggest = (s: { title: string; source: string; heat: number; angle: string }) => {
    if (!suggestOwner) return;
    setTopic({ id: s.source + ":" + s.title, source: s.source as ScoredTopic["source"], title: s.title, url: "", heat: s.heat, rank: 0, score: 0, match: [] });
    setAngle(s.angle);
    setPicked([suggestOwner]);
    setResult(undefined);
  };

  const refresh = async (force = false) => {
    const token = ++listSeq.current;
    setLoading(true);
    try {
      const r = await window.fanpost.hotList({ sources, accountId: viewer || undefined, force });
      if (token !== listSeq.current) return;
      setItems(r.items);
      setErrors(r.errors);
    } catch (e) {
      if (token === listSeq.current) showError(e);
    } finally {
      if (token === listSeq.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (acked) void refresh();
  }, [acked, viewer, sources.join(",")]);

  const shown = onlyMatch ? items.filter((i) => i.match.length && !i.risk) : items;

  const generate = async () => {
    if (mode === "hot" ? !topic : !material.trim()) return;
    setGenerating(true);
    setResult(undefined);
    try {
      const r = (await window.fanpost.hotGenerate({ ...(mode === "own" ? { topic: "", material: material.trim() } : { topic: topic!.title }), accountIds: picked, ...(angle ? { angle } : {}) })) as GenResult;
      setResult(r);
      const ok = r.pieces.filter((x) => !x.error).length;
      if (ok) message.success("生成完成：" + ok + " 篇，请在下方审核");
      else message.warning("没有生成成功的内容，看下方提示");
      setTimeout(() => reviewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
      setEdits(r.pieces);
      setCards({});
      setKeep(r.pieces.map((p) => !p.error));
    } catch (e) {
      showError(e);
    } finally {
      setGenerating(false);
    }
  };

  const blockedPairs = useMemo(() => {
    const live = edits.map((p, i) => ({ p, i })).filter(({ p, i }) => keep[i] && !p.error);
    return matrixSimilarity(live.map(({ p }) => p.title + "\n" + p.description)).map((s) => ({ a: live[s.a].i, b: live[s.b].i, ratio: s.ratio }));
  }, [edits, keep]);

  const makeCards = async (i: number, style: number) => {
    const p = edits[i];
    if (!p || p.error) return;
    setCardBusy(i);
    try {
      const files = await window.fanpost.hotCards({ accountId: p.accountId, title: p.title, body: p.description, style });
      const thumbs = await Promise.all(files.map((f) => window.fanpost.readThumb(f).catch(() => "")));
      setCards((c) => ({ ...c, [i]: { style, files, thumbs } }));
    } catch (e) {
      showError(e);
    } finally {
      setCardBusy(-1);
    }
  };

  const saveDrafts = async (publishNow: boolean) => {
    if (!result) return;
    if (blockedPairs.length) return message.warning("有账号之间内容太像，先改写或取消其中一个再保存");
    const chosen = edits.map((p, i) => ({ p, i })).filter(({ p, i }) => keep[i] && !p.error && p.title.trim() && p.description.trim());
    if (!chosen.length) return message.warning("没有可保存的内容");
    setSaving(true);
    try {
      const ids: string[] = [];
      let images = 0;
      let videos = 0;
      let skipped = 0;
      const videoErrors: string[] = [];
      for (const { p, i } of chosen) {
        const platform = accounts.find((a) => a.id === p.accountId)?.platform;
        const wantImage = !!platform && kind !== "video" && supportsType(platform, "image_text");
        const wantVideo = !!platform && kind !== "image_text" && supportsType(platform, "video");
        if (!wantImage && !wantVideo) skipped++;
        const base = { title: p.title.trim(), description: p.description.trim(), topics: p.topics, accountIds: [p.accountId], overrides: {}, declaration: "ai" as const };
        if (wantImage) {
          let files = mode === "own" && ownImages.length ? ownImages : cards[i]?.files;
          if (!files?.length) files = await window.fanpost.hotCards({ accountId: p.accountId, title: p.title, body: p.description, style: i }).catch(() => []);
          const r = await window.fanpost.saveDraft(undefined, { ...base, type: "image_text", mediaPaths: files, ...(files[0] ? { coverPath: files[0] } : {}) });
          ids.push(r.id);
          images++;
        }
        if (wantVideo) {
          try {
            const v = mode === "own" && ownVideo ? { file: ownVideo, cover: undefined } : await window.fanpost.hotVideo({ accountId: p.accountId, title: p.title, body: p.description, style: cards[i]?.style ?? i });
            const r = await window.fanpost.saveDraft(undefined, { ...base, type: "video", mediaPaths: [v.file], ...(v.cover ? { coverPath: v.cover } : {}) });
            ids.push(r.id);
            videos++;
          } catch (e) {
            videoErrors.push(errText(e));
          }
        }
      }
      await window.fanpost.hotRecord(chosen.map(({ p }) => ({ accountId: p.accountId, title: p.title.trim(), topic: result.topic }))).catch(() => 0);
      const counts = "图文 " + images + " 篇" + (videos ? "，视频 " + videos + " 条" : "") + (skipped ? "；" + skipped + " 个账号的平台不支持所选类型，已跳过" : "");
      if (publishNow && ids.length) {
        const r = await window.fanpost.publishSaved(ids);
        setData(r.data);
        message.success("已排入发布队列：" + counts + "。按顺序自动填写并发布，进度见顶栏和发布记录", 8);
        if (r.failed.length) message.error("未能发布：" + r.failed.join("；"), 8);
        if (videoErrors.length) message.error("视频生成失败：" + videoErrors[0], 8);
      } else {
        setData(await window.fanpost.getData());
        const info = Modal.success({
          title: "已存入草稿箱：" + counts,
          content: (
            <div>
              <p>
                每篇都已勾选「含 AI 生成内容」声明
                {images ? "，图文配好了文字卡片图（封面 + 要点）" : ""}
                {videos ? "，视频是同样内容的竖屏轮播（无配音）" : ""}。草稿箱里可以勾选后一键发布，也可以打开换成自己的素材。
              </p>
              {videoErrors.length > 0 && <p style={{ color: "var(--bad)" }}>视频生成失败：{videoErrors[0]}</p>}
              {videos > 0 && images > 0 && (
                <Button size="small" onClick={() => { info.destroy(); onGoDrafts("video"); }}>
                  去视频草稿箱
                </Button>
              )}
            </div>
          ),
          okText: images ? "去图文草稿箱" : "去视频草稿箱",
          onOk: () => onGoDrafts(images ? "image_text" : "video"),
        });
      }
      setResult(undefined);
      setTopic(undefined);
      setCards({});
      setMaterial("");
      setOwnImages([]);
      setOwnVideo(undefined);
    } catch (e) {
      showError(e);
    } finally {
      setSaving(false);
    }
  };

  if (!acked) return <div className="hot-page"><SafetyGate onOk={() => setAcked(true)} /></div>;

  const profileOf = (id: string) => profiles.find((p) => p.accountId === id);
  const updateProfile = (p: AccountProfile) => setProfiles((list) => [...list.filter((x) => x.accountId !== p.accountId), p]);

  return (
    <div className="hot-page">
      <div className="hot-grid">
        <section className="panel hot-radar">
          <div className="hot-bar">
            <h3><FireOutlined /> 热点雷达</h3>
            <span className="grow" />
            <Button size="small" type="text" icon={<UserOutlined />} onClick={() => setProfileOpen(true)}>账号画像</Button>
            <Tooltip title="刷新热榜">
              <Button size="small" type="text" icon={<ReloadOutlined />} loading={loading} onClick={() => void refresh(true)} aria-label="刷新热榜" />
            </Tooltip>
          </div>
          <div className="hot-sort">
            <span className="muted">排序</span>
            <Select
              size="small"
              className="hot-sort-select"
              value={viewer}
              onChange={(v) => setViewer(String(v))}
              options={[{ label: "按热度", value: "" }, ...accounts.filter((a) => profileOf(a.id)?.niche).map((a) => ({ label: "按「" + accountLabel(a) + "」的赛道", value: a.id }))]}
              popupMatchSelectWidth={false}
            />
            {!accounts.some((a) => profileOf(a.id)?.niche) && <span className="muted hot-sort-tip">给账号建画像后可按赛道推荐</span>}
          </div>
          <div className="hot-sources">
            {HOT_SOURCES.map((h) => {
              const on = sources.includes(h.id);
              return (
                <button key={h.id} type="button" className={"hot-chip" + (on ? " on" : "")} onClick={() => setSources(on ? sources.filter((x) => x !== h.id) : [...sources, h.id])}>
                  {h.name}
                </button>
              );
            })}
            {viewer && <Checkbox checked={onlyMatch} onChange={(e) => setOnlyMatch(e.target.checked)}>只看和赛道相关的</Checkbox>}
          </div>
          {errors.length > 0 && <Alert type="warning" showIcon message={errors.join("；")} />}
          {viewer && (
            <div className="hot-suggest">
              <div className="hot-suggest-head">
                <b><RobotOutlined /> AI 选题</b>
                <Segmented size="small" value={pickFrom} onChange={(v) => { setPickFrom(v as "hot" | "comments"); setSuggests([]); }} options={[{ label: "从热榜", value: "hot" }, { label: "从粉丝评论", value: "comments" }]} />
                <span className="grow" />
                <Button size="small" type="primary" ghost loading={suggesting} onClick={() => void suggest()}>{suggests.length ? "重新挑" : "帮我挑"}</Button>
              </div>
              {suggests.map((s) => (
                <button key={s.title} className={"hot-suggest-item" + (topic?.title === s.title ? " active" : "")} onClick={() => pickSuggest(s)}>
                  <span className="hot-title">{s.title}{s.count ? <Tag className="hot-count">{s.count} 人提到</Tag> : null}</span>
                  <span className="hot-angle">切入：{s.angle}</span>
                  {s.why && <span className="muted">{s.why}</span>}
                </button>
              ))}
              {!suggesting && suggests.length === 0 && (
                <span className="muted">
                  {pickFrom === "hot"
                    ? "还没挑。今天的热点和这个账号都不沾边时，AI 会少选甚至不选，不硬蹭。"
                    : "从这个账号在「评论 · 私信」里抓到的粉丝评论中，归纳大家反复问的问题。粉丝真实需求写出来的内容最容易有互动。"}
                </span>
              )}
            </div>
          )}
          <Spin spinning={loading}>
            {shown.length ? (
              <ul className="hot-list">
                {shown.slice(0, 120).map((t) => (
                  <li key={t.id} className={(topic?.id === t.id ? "active " : "") + (t.risk ? "risky" : "")}>
                    <button disabled={Boolean(t.risk)} onClick={() => { setTopic(t); setAngle(""); setResult(undefined); }}>
                      <span className="hot-src">{HOT_SOURCES.find((s) => s.id === t.source)?.name}</span>
                      <span className="hot-title">{t.title}</span>
                      {t.match.length > 0 && <Tag color="green">匹配 {t.match.join("、")}</Tag>}
                      {t.risk ? <Tag color="red">{t.risk}</Tag> : <span className="hot-heat">{heatText(t.heat)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty description={loading ? "加载中" : !sources.length ? "至少勾选一个平台" : "没有热点"} />
            )}
          </Spin>
        </section>

        <section className="panel hot-create">
          <div className="hot-create-head">
            <h3><RobotOutlined /> 生成</h3>
            <span className="hot-help"><HelpLink topic="hot" label="使用说明" /><HelpLink topic="ai" label="模型推荐" /><HelpLink topic="disclaimer" label="免责条款" /></span>
            <Segmented className="hot-mode" value={mode} options={[{ label: "热点选题", value: "hot" }, { label: "自己的素材", value: "own" }]} onChange={(m) => { setMode(m as "hot" | "own"); setResult(undefined); }} />
          </div>

          <div className="hot-step">
            <div className="hot-step-title"><span className="hot-step-no">1</span>{mode === "hot" ? "选题" : "素材"}</div>
            {mode === "hot" ? (
              topic ? (
                <div className="hot-picked-card">
                  <FireOutlined />
                  <b>{topic.title}</b>
                  {topic.url && <a href={topic.url} target="_blank" rel="noreferrer">原链接</a>}
                </div>
              ) : (
                <div className="hot-step-empty">从左边热榜点一个热点</div>
              )
            ) : (
              <>
                <Input.TextArea rows={5} maxLength={3000} showCount placeholder="粘贴你自己的素材：产品介绍、笔记、经验、活动信息等。AI 按每个账号的画像和平台风格分别改写，不添加素材里没有的事实。" value={material} onChange={(e) => setMaterial(e.target.value)} />
                <div className="hot-media-row">
                  <button type="button" className={"hot-media" + (ownImages.length ? " on" : "")} onClick={async () => { const f = await window.fanpost.pickFiles("images"); if (f.length) setOwnImages(f.slice(0, 9)); }}>
                    <PictureOutlined />
                    <span>{ownImages.length ? "已选 " + ownImages.length + " 张图" : "添加图片"}</span>
                    <small>{ownImages.length ? "点击重选" : "不加则自动配文字卡片"}</small>
                    {ownImages.length > 0 && <CloseCircleFilled className="hot-media-x" onClick={(e) => { e.stopPropagation(); setOwnImages([]); }} />}
                  </button>
                  <button type="button" className={"hot-media" + (ownVideo ? " on" : "")} onClick={async () => { const f = await window.fanpost.pickFiles("video"); if (f[0]) setOwnVideo(f[0]); }}>
                    <VideoCameraOutlined />
                    <span>{ownVideo ? "已选视频" : "添加视频"}</span>
                    <small>{ownVideo ? "点击重选" : "不加则自动做轮播视频"}</small>
                    {ownVideo && <CloseCircleFilled className="hot-media-x" onClick={(e) => { e.stopPropagation(); setOwnVideo(undefined); }} />}
                  </button>
                </div>
              </>
            )}
            <Input prefix={<span className="muted">{mode === "own" ? "改写要求" : "切入角度"}</span>} placeholder={mode === "own" ? "可不填，例如：口语化、突出优惠" : "可不填，留空时每个账号自动换角度"} value={angle} maxLength={60} onChange={(e) => setAngle(e.target.value)} allowClear />
          </div>

          <div className="hot-step">
            <div className="hot-step-title"><span className="hot-step-no">2</span>内容类型</div>
            <Segmented<GenKind> block value={kind} options={(["image_text", "video", "both"] as GenKind[]).map((k) => ({ label: KIND_LABEL[k], value: k }))} onChange={(k) => { setKind(k); setPicked((ids) => ids.filter((id) => { const a = accounts.find((x) => x.id === id); return !!a && fitsKind(a.platform, k); })); }} />
          </div>

          <div className="hot-step">
            <div className="hot-step-title">
              <span className="hot-step-no">3</span>分发账号
              <span className="muted hot-step-sub">已选 {picked.length} 个</span>
              <span className="grow" />
              <Button size="small" type="link" disabled={!online.some((a) => fitsKind(a.platform, kind))} onClick={() => { const all = online.filter((a) => fitsKind(a.platform, kind)).map((a) => a.id); setPicked(picked.length === all.length ? [] : all); }}>
                {picked.length && picked.length === online.filter((a) => fitsKind(a.platform, kind)).length ? "取消全选" : "全选"}
              </Button>
            </div>
            {online.length ? (
              <div className="hot-acc-grid">
                {online.map((a) => {
                  const ok = fitsKind(a.platform, kind);
                  const on = picked.includes(a.id);
                  return (
                    <button key={a.id} type="button" disabled={!ok} className={"hot-acc" + (on ? " on" : "")} onClick={() => setPicked((cur) => (cur.includes(a.id) ? cur.filter((x) => x !== a.id) : [...cur, a.id]))} title={ok ? "" : platformMap[a.platform].name + "不支持" + KIND_LABEL[kind]}>
                      <PlatformLogo platform={a.platform} />
                      <span className="hot-acc-name">{accountLabel(a)}</span>
                      {!ok ? <small>不支持</small> : !profileOf(a.id)?.niche ? <small>无画像</small> : null}
                      {on && <CheckCircleFilled className="hot-acc-check" />}
                    </button>
                  );
                })}
              </div>
            ) : (
              <Alert type="warning" showIcon message="没有在线账号，先到账号页登录" />
            )}
          </div>

          <Button className="hot-gen-btn" type="primary" size="large" icon={<RobotOutlined />} loading={generating} disabled={!picked.length || (mode === "hot" ? !topic : !material.trim())} onClick={() => void generate()}>
            {generating ? "正在为 " + picked.length + " 个账号生成…" : "用我的 AI 模型生成" + (picked.length ? "（" + picked.length + " 个账号）" : "")}
          </Button>

          {result && (
            <div className="hot-review" ref={reviewRef}>
              <div className="hot-review-head">
                <h4><CheckCircleFilled /> 生成完成，请审核</h4>
                <span className="muted">共 {edits.length} 篇，成功 {edits.filter((x) => !x.error).length} 篇。改好、勾选后分发；不勾选的丢弃。</span>
              </div>
              {blockedPairs.length > 0 && (
                <Alert
                  type="error"
                  showIcon
                  message="矩阵重复度过高"
                  description={blockedPairs.map((s) => accountLabel(accounts.find((a) => a.id === edits[s.a].accountId)!) + " 和 " + accountLabel(accounts.find((a) => a.id === edits[s.b].accountId)!) + " 相似 " + Math.round(s.ratio * 100) + "%").join("；") + "。平台会把这类内容判为同质化，改写其中一篇或取消勾选。"}
                />
              )}
              {edits.map((p, i) => {
                const account = accounts.find((a) => a.id === p.accountId);
                return (
                  <div key={p.accountId} className={"hot-piece" + (p.error ? " failed" : "") + (keep[i] ? "" : " off")}>
                    <div className="hot-piece-head">
                      <Checkbox checked={keep[i]} disabled={Boolean(p.error)} onChange={(e) => setKeep((k) => k.map((x, j) => (j === i ? e.target.checked : x)))} />
                      {account && <PlatformLogo platform={account.platform} />}
                      <b>{account ? accountLabel(account) : p.accountId}</b>
                      <span className="grow" />
                      <Tag color="purple">含AI生成内容</Tag>
                    </div>
                    {p.error ? (
                      <Alert type="warning" showIcon message={p.error} />
                    ) : (
                      <>
                        <Input value={p.title} onChange={(e) => { setEdits((list) => list.map((x, j) => (j === i ? { ...x, title: e.target.value } : x))); dropCards(i); }} />
                        <Input.TextArea autoSize={{ minRows: 4, maxRows: 12 }} value={p.description} onChange={(e) => { setEdits((list) => list.map((x, j) => (j === i ? { ...x, description: e.target.value } : x))); dropCards(i); }} />
                        <div className="hot-topics">{p.topics.map((t) => <Tag key={t}>#{t}</Tag>)}</div>
                        {!(mode === "own" && ownImages.length) && kind !== "video" && (
                          <div className="hot-cards">
                            <div className="hot-cards-head">
                              <span className="muted">配图：标题和要点自动做成文字卡片（本地生成，免费）</span>
                              <Button size="small" loading={cardBusy === i} onClick={() => void makeCards(i, cards[i] ? cards[i].style + 1 : i)}>{cards[i] ? "换一套样式" : "预览配图"}</Button>
                            </div>
                            {cards[i]?.thumbs.length ? (
                              <div className="hot-cards-row">{cards[i].thumbs.map((t, k) => (t ? <img key={k} src={t} alt={"卡片 " + (k + 1)} /> : null))}</div>
                            ) : null}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
              <div className="hot-actions">
                <span className="muted">将发布：{KIND_LABEL[kind]} · {keep.filter((k, i) => k && !edits[i]?.error).length} 篇</span>
                <span className="grow" />
                <Button onClick={() => void generate()} loading={generating}>重新生成</Button>
                <Button loading={saving} onClick={() => void saveDrafts(false)}>存入草稿箱</Button>
                <Popconfirm title="确认后直接一键分发？" description="每个账号按顺序自动填写并发布，不进草稿箱" okText="分发" cancelText="取消" onConfirm={() => saveDrafts(true)}>
                  <Button type="primary" icon={<SendOutlined />} loading={saving}>一键分发</Button>
                </Popconfirm>
              </div>
            </div>
          )}
        </section>
      </div>

      <Modal open={profileOpen} title={<span>账号画像 <HelpLink topic="hot" label="" /></span>} width={760} footer={null} onCancel={() => setProfileOpen(false)}>
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message="画像决定推荐哪些热点、用什么语气写。可以点「从作品自动生成」，也可以直接手填。" />
        <div className="hot-profiles">
          {accounts.length ? accounts.map((a) => <ProfileEditor key={a.id} account={a} profile={profileOf(a.id)} onSaved={updateProfile} />) : <Empty description="还没有账号" />}
        </div>
      </Modal>
    </div>
  );
}
