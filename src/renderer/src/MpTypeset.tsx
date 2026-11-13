import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Input, Modal, Segmented, Slider, Switch, Tooltip, message } from "antd";
import { BgColorsOutlined, DownloadOutlined, LinkOutlined, PlusOutlined, ThunderboltOutlined, UploadOutlined } from "@ant-design/icons";
import { DEFAULT_MP_STYLE, parseStyleTokens, swatches, tuneStyle, type MpStyleTokens } from "../../shared/mp-style";
import { BUILTIN_TEMPLATES, buildBuiltinSkins } from "../../shared/mp-builtin";
import {
  SKIN_LABEL,
  buildTemplateFile,
  fillSkin,
  hasSkins,
  newTemplateId,
  parseTemplate,
  readTemplateFile,
  skinSummary,
  type MpAsset,
  type MpTemplate,
  type SkinKind,
} from "../../shared/mp-template";
import { typesetHtml } from "./mp-restyle";
import { applyTemplateHtml, renderWithTemplate } from "./mp-skin";
import { sanitizeTemplate } from "./mp-sanitize";
import { confirmMpSiteTerms, useFeature } from "./AddonPanel";
import { FEATURE_MP_SITE } from "../../shared/license";

/** 新键：模板（含结构骨架）。老键只存令牌，读的时候顺手迁移过来 */
const TEMPLATE_KEY = "fanpost.mpTemplates";
const LEGACY_KEY = "fanpost.mpStyles";
const MAX_TEMPLATES = 30;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "").replace(/^FEATURE:/, "");

/**
 * 内置模板：六套带结构骨架的版式。
 * 老版本的 8 套「简约留白 / 暖阳橙调 …」只有字号和颜色差别，套上去整篇还是原样，
 * 和主色旋钮能做的事重复，已经去掉了——这里只放真的会让版式变样的。
 */
const BUILTIN: MpTemplate[] = BUILTIN_TEMPLATES.map((b) => ({
  id: "b:" + b.id,
  name: b.tokens.name,
  createdAt: 0,
  source: "内置",
  tokens: b.tokens,
  skins: {},
  builtin: b.id,
}));

/** 缩略图用的示例内容：一个标题、一段正文、一句引用，刚好把三类骨架都照出来 */
const SAMPLE = "<h1>标题示例</h1><p>正文段落，看看这套版式的长相。</p><blockquote>引用</blockquote>";

/**
 * 能直接提骨架的模板站，和主进程 `SITE_HOME` 一一对应。
 * 不引主进程那个模块（它带着 cheerio），这里只要名字和 key。
 * 秀米的预览页是 SPA 外壳，静态抓不到，所以不列——列了就是让用户白跑一趟。
 */
const SITES = [
  { key: "yiban", name: "壹伴", tip: "壹伴的样式中心，模板最全，标题正文引用都能提出来" },
  { key: "135", name: "135", tip: "135 的样式大全。其中用 div 拼图的设计稿提不出结构，会被拦下" },
  { key: "365", name: "365", tip: "365 的素材库。挑有示例文字的那种，空模板统计不出字号" },
] as const;

/**
 * 素材缩略图里的占位内容。
 * 一条素材只对应一类块，放一句对口的话就能看出长相；分割线没有文字。
 */
const ASSET_SAMPLE: Record<SkinKind, string> = {
  h1: "标题示例",
  h2: "小标题示例",
  h3: "小标题示例",
  p: "正文段落，看看这条素材的长相。",
  quote: "引用的一句话",
  hr: "",
};

/**
 * 素材缩略图。
 * 和模板缩略图同样的做法：按公众号真机 375px 宽排好，再整体缩到卡片里。
 * 直接按卡片宽度排的话换行位置和真机不一样，等于看了一张假图。
 */
function AssetThumb({ asset }: { asset: MpAsset }) {
  const html = useMemo(() => {
    try {
      const body = ASSET_SAMPLE[asset.kind];
      const out = body ? fillSkin(asset.html, body) : asset.html;
      // 一类素材只有一块，首块头上常留一大截外边距，缩略图里会变成一片空白
      const doc = new DOMParser().parseFromString('<div id="a">' + out + "</div>", "text/html");
      const holder = doc.getElementById("a")!;
      const first = holder.firstElementChild as HTMLElement | null;
      if (first) first.setAttribute("style", (first.getAttribute("style") || "") + ";margin-top:0");
      return holder.innerHTML;
    } catch {
      return "";
    }
  }, [asset]);
  if (!html) return <span className="mp-asset-thumb" />;
  return (
    <span className="mp-asset-thumb">
      <span className="mp-asset-in" dangerouslySetInnerHTML={{ __html: html }} />
    </span>
  );
}

const asTemplate = (tokens: MpStyleTokens): MpTemplate => ({
  id: newTemplateId(),
  name: tokens.name,
  createdAt: Date.now(),
  source: "自己存的",
  tokens,
  skins: {},
});

function loadCustom(): MpTemplate[] {
  try {
    const raw = JSON.parse(localStorage.getItem(TEMPLATE_KEY) || "[]");
    if (Array.isArray(raw) && raw.length) return raw.map(parseTemplate).filter((x): x is MpTemplate => Boolean(x)).map(sanitizeTemplate).slice(0, MAX_TEMPLATES);
  } catch {
    // 读坏了就当没有，下面还有老键可以迁移
  }
  try {
    const old = JSON.parse(localStorage.getItem(LEGACY_KEY) || "[]");
    if (Array.isArray(old)) {
      return old
        .map(parseStyleTokens)
        .filter((x): x is MpStyleTokens => Boolean(x))
        .map(asTemplate)
        .slice(0, MAX_TEMPLATES);
    }
  } catch {
    // 老键也读不出来就空着
  }
  return [];
}

function saveCustom(list: MpTemplate[]) {
  try {
    localStorage.setItem(TEMPLATE_KEY, JSON.stringify(list.slice(0, MAX_TEMPLATES)));
  } catch {
    // localStorage 满了就算了，模板不是关键数据
  }
}

/** 模板卡片上那几个小方块，让人一眼认出是哪套配色 */
function Swatches({ tokens }: { tokens: MpStyleTokens }) {
  return (
    <span className="mp-style-swatch">
      {swatches(tokens).map((c, i) => (
        <i key={i} style={{ background: c }} />
      ))}
    </span>
  );
}

/**
 * 版式缩略图：拿真实骨架渲一段示例。
 * 光看名字和色块，六套模板看起来都差不多；缩到半张手机屏大小反而能一眼认出
 * 标题是色块还是双线、段落有没有圆点、引用是卡片还是竖线。
 */
function Thumb({ tpl }: { tpl: MpTemplate }) {
  const html = useMemo(() => {
    try {
      const out = applyTemplateHtml(SAMPLE, tpl, tpl.tokens);
      if (!out) return "";
      // 标题骨架头上一般留了 1.4–2.2em 的外边距，缩略图里会把整段内容顶下去看不见，这里只对预览归零
      const doc = new DOMParser().parseFromString('<div id="t">' + out + "</div>", "text/html");
      const holder = doc.getElementById("t")!;
      const first = holder.firstElementChild?.firstElementChild;
      if (first) first.setAttribute("style", (first.getAttribute("style") || "") + ";margin-top:0");
      return holder.innerHTML;
    } catch {
      return "";
    }
  }, [tpl]);
  if (!html) return <Swatches tokens={tpl.tokens} />;
  return (
    <span className="mp-style-thumb">
      <span className="mp-style-thumb-in" dangerouslySetInnerHTML={{ __html: html }} />
    </span>
  );
}

export function MpTypeset({ html, onApply, disabled }: { html: string; onApply: (next: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState<MpTemplate[]>([]);
  const [baseId, setBaseId] = useState(BUILTIN[0]!.id);
  const [customBase, setCustomBase] = useState<MpTemplate | undefined>(undefined);
  const [accent, setAccent] = useState<string>(DEFAULT_MP_STYLE.h1.color);
  const [bodySize, setBodySize] = useState(DEFAULT_MP_STYLE.bodySize);
  const [lineHeight, setLineHeight] = useState(DEFAULT_MP_STYLE.lineHeight);
  const [paraGap, setParaGap] = useState(DEFAULT_MP_STYLE.paraGap);
  const [indent, setIndent] = useState(DEFAULT_MP_STYLE.indent);
  const [url, setUrl] = useState("");
  const [site, setSite] = useState<string>("yiban");
  const [busy, setBusy] = useState(false);
  const siteOn = useFeature(FEATURE_MP_SITE);
  /**
   * 单独挑的素材：只覆盖某一类块的骨架。
   * 一套模板里的十几个素材，用户常常只想借其中一个（这个引用框好看），
   * 其余仍用整套的。存在这里而不是改模板本身，取消时能一键退回整套。
   */
  const [ovr, setOvr] = useState<Partial<Record<SkinKind, string>>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setCustom(loadCustom());
  }, [open]);

  const all = useMemo(() => [...BUILTIN, ...custom], [custom]);
  const base = useMemo(() => all.find((t) => t.id === baseId) ?? customBase ?? BUILTIN[0]!, [all, baseId, customBase]);
  const tokens = useMemo(
    () => tuneStyle(base.tokens, { accent, bodySize, lineHeight, paraGap, indent }),
    [base, accent, bodySize, lineHeight, paraGap, indent],
  );
  /**
   * 真正拿去渲染的那套。
   * 挑过素材就把内置版式先按当前令牌展开，再把挑中的那几条盖上去——展开这一步不能省，
   * 否则未覆盖的块会退回素面，整套只剩一个引用框有设计。
   */
  const effective = useMemo<MpTemplate>(() => {
    if (!Object.keys(ovr).length) return base;
    const own = base.builtin ? buildBuiltinSkins(base.builtin, tokens) : base.skins;
    return { ...base, builtin: undefined, skins: { ...own, ...ovr } };
  }, [base, tokens, ovr]);
  const preview = useMemo(() => (open ? renderWithTemplate(html, effective, tokens, typesetHtml) : ""), [open, html, effective, tokens]);
  const skinned = hasSkins(effective);
  const assets = siteOn ? base.assets ?? [] : [];

  const pick = (t: MpTemplate) => {
    setBaseId(t.id);
    setCustomBase(t);
    setAccent(t.tokens.h1.color);
    setBodySize(t.tokens.bodySize);
    setLineHeight(t.tokens.lineHeight);
    setParaGap(t.tokens.paraGap);
    setIndent(t.tokens.indent);
    setUrl("");
    setOvr({});
  };

  /** 点一条素材：只换这一类块；再点一次退回整套在这一类的样子 */
  const toggleAsset = (a: MpAsset) => {
    setOvr((o) => {
      const next = { ...o };
      if (next[a.kind] === a.html) delete next[a.kind];
      else next[a.kind] = a.html;
      return next;
    });
  };

  const remember = (input: MpTemplate) => {
    const t = sanitizeTemplate(input);
    // 同名覆盖，避免列表里堆一串同名的
    const next = [t, ...custom.filter((x) => x.name !== t.name)].slice(0, MAX_TEMPLATES);
    setCustom(next);
    saveCustom(next);
    pick(t);
    // 新模板插在「我的模板」最前面，但列表是滚动的，不滚过去用户会以为没进来。
    // 不用 scrollIntoView：平滑滚动途中缩略图才排版完，位置会算错，卡片只露一条边。
    setTimeout(() => {
      const el = document.querySelector('[data-tpl="' + t.id + '"]') as HTMLElement | null;
      const list = el?.closest(".mp-style-list") as HTMLElement | null;
      if (!el || !list) return;
      const top = el.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
      list.scrollTo({ top: Math.max(0, top - 8), behavior: "smooth" });
    }, 220);
  };

  /** 打开模板站的模板中心。用系统浏览器开，用户挑好了再把地址复制回来 */
  const openSite = async (key: string) => {
    if (!(await confirmMpSiteTerms())) return;
    try {
      await window.fanpost.openMpSite(key);
    } catch (e) {
      message.error(errText(e));
    }
  };

  /**
   * 提取：站点素材和文章链接走同一个入口。
   * 只填一串数字时按当前选中的站点走——站点上看到一个素材，记下 ID 就够，
   * 不用去复制一条几十个字符、还带一堆查询参数的链接，这也是实际操作里最常见的方式。
   */
  const extract = async () => {
    const raw = url.trim();
    if (!raw) return message.warning("填一个 ID，或者贴一条链接");
    if (!(await confirmMpSiteTerms())) return;
    const byId = /^\d{1,12}$/.test(raw);
    setBusy(true);
    try {
      const r = await window.fanpost.extractMpTemplate(byId ? { site, id: raw } : { url: raw });
      remember(r.template);
      const n = r.template.assets?.length ?? 0;
      const s = skinSummary(r.template);
      // 提取完就自动选中了，但用户不一定知道下一步该干嘛，得把落点点出来
      message.success(
        "已读成「" + r.template.name + "」，" + (n > 1 ? "拆出 " + n + " 条素材，右边可以逐条挑" : s ? s : "只有字号颜色") + "；满意了点右下角「应用到正文」",
        5,
      );
    } catch (e) {
      message.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  /** 抓来的文章本身就有排版，直接把它读成模板，不用再去复制链接 */
  const extractCurrent = async () => {
    setBusy(true);
    try {
      const r = await window.fanpost.extractMpTemplate({ html });
      remember(r.template);
      const s = skinSummary(r.template);
      message.success(s ? "已按正文现在的版式存成模板，" + s : "已按正文现在的排版生成模板");
    } catch (e) {
      message.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const saveAsTemplate = () => {
    let n = 1;
    while (all.some((x) => x.name === "我的样式 " + n)) n++;
    const t: MpTemplate = { ...asTemplate(tokens), name: "我的样式 " + n };
    remember(t);
    message.success("已存为「" + t.name + "」，列表里右键可以删掉");
  };

  const removeCustom = (id: string) => {
    const next = custom.filter((x) => x.id !== id);
    setCustom(next);
    saveCustom(next);
    if (id === baseId) pick(BUILTIN[0]!);
  };

  const exportAll = () => {
    if (!custom.length) return message.warning("还没有自己存的模板，先提取或存一个");
    const blob = new Blob([JSON.stringify(buildTemplateFile(custom), null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = "公众号模板-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 3000);
  };

  const importFile = async (file: File) => {
    try {
      const list = readTemplateFile(JSON.parse(await file.text())).map(sanitizeTemplate);
      const merged = [...list, ...custom.filter((c) => !list.some((x) => x.name === c.name))].slice(0, MAX_TEMPLATES);
      setCustom(merged);
      saveCustom(merged);
      if (list[0]) pick(list[0]);
      message.success("导入 " + list.length + " 个模板");
    } catch (e) {
      message.error(errText(e));
    }
  };

  const apply = () => {
    if (!preview) return message.warning("正文是空的，先写点内容");
    onApply(preview);
    setOpen(false);
    const n = Object.keys(ovr).length;
    message.success("已按「" + base.name + "」排好" + (n ? "，其中 " + n + " 类用的是单独挑的素材" : ""));
  };

  /** 带版式的模板：大卡片，直接看缩略图 */
  const card = (t: MpTemplate) => (
    <button
      key={t.id}
      data-tpl={t.id}
      className={"mp-style-card" + (t.id === base.id ? " is-on" : "")}
      onClick={() => pick(t)}
      onContextMenu={(e) => {
        if (!custom.some((c) => c.id === t.id)) return;
        e.preventDefault();
        removeCustom(t.id);
      }}
      title={custom.some((c) => c.id === t.id) ? skinSummary(t) || "右键删除这个自定义模板" : skinSummary(t) || t.name}
    >
      <Thumb tpl={t} />
      <span className="mp-style-cap">
        <span className="mp-style-name">{t.name}</span>
        <span className="mp-style-meta num">{t.tokens.bodySize}px</span>
      </span>
    </button>
  );

  /** 只有配色的：一行，紧凑排，不占地方 */
  const row = (t: MpTemplate) => (
    <button
      key={t.id}
      data-tpl={t.id}
      className={"mp-style-item" + (t.id === base.id ? " is-on" : "")}
      onClick={() => pick(t)}
      onContextMenu={(e) => {
        if (!custom.some((c) => c.id === t.id)) return;
        e.preventDefault();
        removeCustom(t.id);
      }}
      title={custom.some((c) => c.id === t.id) ? skinSummary(t) || "右键删除这个自定义模板" : skinSummary(t) || t.name}
    >
      <Swatches tokens={t.tokens} />
      <span className="mp-style-name">{t.name}</span>
      {hasSkins(t) ? <span className="mp-style-tag">结构</span> : null}
      <span className="mp-style-meta num">{t.tokens.bodySize}px</span>
    </button>
  );

  return (
    <>
      <Button size="small" icon={<BgColorsOutlined />} disabled={disabled} title="给正文套一套排版模板" onClick={() => setOpen(true)}>
        排版
      </Button>
      <Modal
        open={open}
        width={980}
        title="一键排版"
        onCancel={() => setOpen(false)}
        footer={
          <div className="ai-modal-footer">
            <span className="ai-modal-meta">排版结果是内联样式，复制或发草稿都不会掉样式</span>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button type="primary" icon={<ThunderboltOutlined />} onClick={apply} disabled={!preview}>
              应用到正文
            </Button>
          </div>
        }
      >
        <div className="mp-style-body">
          <aside className="mp-style-list scroll-y">
            {/* 去模板站取素材：先选站点（决定 ID 属于哪家），再打开该站挑，
                最后把 ID 或链接填回来。之前只留一个输入框，用户不知道 ID 从哪来，
                也不知道一串数字该算哪家站的，整个流程断在第一步。 */}
            {siteOn && (
            <div className="mp-site-hub">
              <Segmented
                size="small"
                block
                value={site}
                onChange={(v) => setSite(String(v))}
                options={SITES.map((s) => ({ label: s.name, value: s.key }))}
              />
              <button type="button" className="mp-site-open" onClick={() => void openSite(site)}>
                打开{SITES.find((s) => s.key === site)?.name}，去挑素材 ↗
              </button>
              <div className="mp-style-pick">
                <Input
                  size="small"
                  prefix={<LinkOutlined />}
                  placeholder="填数字 ID，或粘链接"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onPressEnter={() => void extract()}
                  allowClear
                />
                <Button size="small" autoInsertSpace={false} loading={busy} onClick={() => void extract()}>
                  提取
                </Button>
              </div>
              <p className="mp-site-note">只填数字就按上面选中的站点取；也可以把素材页地址整条粘进来，站名会自动认。</p>
            </div>
            )}
            <button className="mp-style-link" disabled={busy || !html.trim()} onClick={() => void extractCurrent()}>
              {siteOn ? "或者：用正文现在的版式" : "用正文现在的版式"}
            </button>

            <div className="mp-style-group">版式模板</div>
            <div className="mp-style-cards">{BUILTIN.map(card)}</div>
            <div className="mp-style-group">
              我的模板
              <span className="mp-style-tools">
                <Tooltip title="导入模板文件">
                  <Button size="small" type="text" icon={<UploadOutlined />} aria-label="导入模板" onClick={() => fileRef.current?.click()} />
                </Tooltip>
                <Tooltip title="导出全部自定义模板">
                  <Button size="small" type="text" icon={<DownloadOutlined />} aria-label="导出模板" onClick={exportAll} />
                </Tooltip>
              </span>
            </div>
            {custom.length ? (
              // 必须和内置那组一样包一层：直接挂到 flex 列里，卡片会被 flex-shrink 压成一条线
              <div className="mp-style-cards">{custom.map((t) => (hasSkins(t) ? card(t) : row(t)))}</div>
            ) : (
              <p className="mp-style-empty">还没有。贴个链接点「提取」，或把当前设置存下来。</p>
            )}
            <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={saveAsTemplate}>
              把当前设置存成模板
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void importFile(f);
              }}
            />
          </aside>

          <section className="mp-style-right">
            <div className="mp-style-controls">
              <label className="mp-style-ctl">
                <span>字号</span>
                <Slider min={13} max={20} step={1} value={bodySize} onChange={setBodySize} tooltip={{ open: false }} />
              </label>
              <label className="mp-style-ctl">
                <span>行高</span>
                <Slider min={1.4} max={2.4} step={0.05} value={lineHeight} onChange={setLineHeight} tooltip={{ open: false }} />
              </label>
              <label className="mp-style-ctl">
                <span>段距</span>
                <Slider min={0.4} max={2} step={0.1} value={paraGap} onChange={setParaGap} tooltip={{ open: false }} />
              </label>
              <label className="mp-style-ctl mp-style-color">
                <span>主色</span>
                <input type="color" value={accent} aria-label="主色" onChange={(e) => setAccent(e.target.value)} />
              </label>
              <label className="mp-style-ctl mp-style-switch">
                <span>首行缩进</span>
                <Switch size="small" checked={indent} onChange={setIndent} />
              </label>
            </div>
            {/* 一套模板其实是十几个素材串起来的。用户常常只想借其中一个（这个引用框好看），
                所以整条列出来，点哪条就只换哪一类块，再点一次退回整套。 */}
            {assets.length ? (
              <div className="mp-assets">
                <div className="mp-assets-head">
                  <span className="mp-assets-title">
                    这套里的素材 <b className="num">{assets.length}</b>
                  </span>
                  <span className="mp-assets-hint">
                    点一条只换这一类
                    {Object.keys(ovr).length ? "，已换 " + Object.keys(ovr).length + " 类" : "，再点取消"}
                  </span>
                </div>
                <div className="mp-assets-row">
                  {assets.map((a) => {
                    const on = ovr[a.kind] === a.html;
                    return (
                      <button
                        type="button"
                        key={a.id}
                        className={"mp-asset" + (on ? " is-on" : "")}
                        title={a.label + "｜点一下只把这一类换成它"}
                        onClick={() => toggleAsset(a)}
                      >
                        <AssetThumb asset={a} />
                        <span className="mp-asset-cap">
                          <span className="mp-asset-tag">{SKIN_LABEL[a.kind]}</span>
                          <span className="mp-asset-name">{a.label.split("·")[1]?.trim() || ""}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
            {skinned ? (
              <p className="mp-style-hint">
                {effective.builtin
                  ? "这套是内置版式，标题、正文、引用、分割线各有各的设计。改主色会把标题条和引用卡的底色一起换掉，字号行高只影响文字本身。"
                  : "这套模板带着原文的卡片结构：" + skinSummary(effective) + "。字号、行高、段距只作用于没有结构的块，主色会连带换掉卡片里的颜色。"}
              </p>
            ) : null}
            {preview ? (
              <div className="mp-style-preview" dangerouslySetInnerHTML={{ __html: preview }} />
            ) : (
              <Alert type="info" showIcon title="正文还是空的" description="先在正文里写点内容，这里就能看到排版效果。" />
            )}
          </section>
        </div>
      </Modal>
    </>
  );
}
