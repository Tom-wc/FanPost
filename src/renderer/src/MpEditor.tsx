import { useEffect, useRef, useState, type RefObject } from "react";
import { Button, Image, Input, Modal, Switch, message } from "antd";
import { CopyOutlined, PictureOutlined, SaveOutlined, WechatOutlined } from "@ant-design/icons";
import type { AppData } from "../../shared/types";
import type { MpDraft, MpDraftInput } from "../../shared/mp-drafts";
import { MP_NOTES, MP_RULES, checkMpArticle } from "../../shared/mp-rules";
import { RULES_MISSING, mpDeclaration, reviewMp } from "../../shared/safety-review";
import { MpRichEditor } from "./MpRichEditor";
import { htmlFromText, pathFromSrc } from "../../shared/mp-html";
import { useSafetyRules, safetyReason } from "./safety";
import { HelpLink } from "./Tutorial";
import { ensureLicensed, handleQuota } from "./LicensePanel";
import type { LeaveGuard } from "./PublishComposer";

const errText = (e: unknown) => safetyReason(e) || String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "").replace(/^QUOTA:/, "");
const count = (s: string) => Array.from(s.trim()).length;

function fromHtml(html: string) {
  const doc = new DOMParser().parseFromString("<div>" + html + "</div>", "text/html");
  const root = doc.body.firstElementChild as HTMLElement;
  root.querySelectorAll("p,div,section,h1,h2,h3,h4,h5,h6,li,blockquote,tr,br,figure").forEach((el) => el.append("\n"));
  const text = (root.textContent || "").split("\n").map((l) => l.replace(/[\s\u00a0\u3000]+/g, " ").trim()).filter(Boolean).join("\n");
  const images = [...root.querySelectorAll("img")].map((i) => pathFromSrc(i.getAttribute("src") || "")).filter(Boolean);
  return { text, images };
}

interface Props {
  initial: MpDraftInput;
  draft?: MpDraft;
  setData: (d: AppData) => void;
  onSaved: (id: string) => void;
  guard?: RefObject<LeaveGuard | undefined>;
}

const MP_LEAVE_TEXT = { title: "文章还没保存，是否保存？", body: "不保存的话，这次改的标题、正文、封面和设置都会丢失。", save: "保存到本机" };
const mpKey = (x: MpDraftInput) => JSON.stringify([x.title, x.author, x.digest, x.html, x.cover ?? "", x.sourceUrl, x.openComment, !!x.repost]);

export function MpEditor({ initial, draft, setData, onSaved, guard }: Props) {
  const [a, setA] = useState<MpDraftInput>(() => (initial.html.trim() ? initial : { ...initial, html: htmlFromText(initial.text, initial.images) }));
  const [id, setId] = useState(draft?.id);
  const [baseline, setBaseline] = useState(() => mpKey(a));
  const dirty = mpKey(a) !== baseline && (!!id || !!a.title.trim() || !!a.text.trim());
  const [busy, setBusy] = useState("");
  const [step, setStep] = useState("");
  const [appId, setAppId] = useState("");
  const [coverPreview, setCoverPreview] = useState("");
  const safety = useSafetyRules();
  useEffect(() => {
    void window.fanpost.getMp().then((r) => setAppId(r.appId)).catch(() => undefined);
    return window.fanpost.onMpProgress(setStep);
  }, []);
  useEffect(() => {
    if (!a.cover) return setCoverPreview("");
    void window.fanpost.readThumb(a.cover).then(setCoverPreview).catch(() => setCoverPreview(""));
  }, [a.cover]);
  const set = <K extends keyof MpDraftInput>(k: K, v: MpDraftInput[K]) => setA((x) => ({ ...x, [k]: v }));
  const setHtml = (html: string) => setA((x) => ({ ...x, html, ...fromHtml(html) }));
  const rules = checkMpArticle(a);
  const safetyItems = safety.rules ? reviewMp(safety.rules, { title: a.title, description: a.text, declaration: mpDeclaration(a.repost), source: a.source }) : [];
  const issues = [...rules.map((r) => ({ level: r.level === "error" ? "bad" : "warn", text: r.text })), ...safetyItems.map((s) => ({ level: s.level === "block" ? "bad" : "warn", text: s.text }))];
  const blocking = issues.filter((i) => i.level === "bad");
  const warns = issues.filter((i) => i.level === "warn");
  const saveLocal = async () => {
    setBusy("local");
    try {
      const r = await window.fanpost.mpStore(id, a);
      setId(r.id);
      setBaseline(mpKey(a));
      setData(r.data);
      onSaved(r.id);
      message.success("已保存到本机");
      return true;
    } catch (e) {
      if (!handleQuota(e)) message.error(errText(e));
      return false;
    } finally {
      setBusy("");
    }
  };
  const saveRef = useRef(saveLocal);
  saveRef.current = saveLocal;
  useEffect(() => {
    if (!guard) return;
    guard.current = { isDirty: () => dirty, save: () => saveRef.current(), text: MP_LEAVE_TEXT };
    return () => {
      guard.current = undefined;
    };
  });
  useEffect(() => {
    void window.fanpost.setDirty(dirty);
  }, [dirty]);
  useEffect(() => () => void window.fanpost.setDirty(false), []);
  const guarded = async (then: () => void) => {
    if (!(await ensureLicensed())) return;
    if (safety.loaded && !safety.rules) return message.error(RULES_MISSING);
    if (blocking.length) return Modal.error({ title: "还有 " + blocking.length + " 处要改", content: <ul className="confirm-issues">{blocking.map((i, n) => <li key={n}>{i.text}</li>)}</ul>, okText: "回去修改" });
    if (!warns.length) return then();
    Modal.confirm({ title: warns.length + " 处提醒", content: <ul className="confirm-issues">{warns.map((i, n) => <li key={n}>{i.text}</li>)}</ul>, okText: "我已确认，继续", cancelText: "回去修改", onOk: then });
  };
  const toMp = () =>
    guarded(async () => {
      setBusy("mp");
      try {
        const r = await window.fanpost.mpDraft(id, a);
        setId(r.id);
        setBaseline(mpKey(a));
        setData(r.data);
        onSaved(r.id);
        Modal.success({ title: "已存进公众号草稿箱", content: MP_NOTES[0] });
      } catch (e) {
        if (!handleQuota(e)) message.error(errText(e));
      } finally {
        setBusy("");
        setStep("");
      }
    });
  const copy = async () => {
    if (!(await ensureLicensed())) return;
    if (safety.loaded && !safety.rules) return message.error(RULES_MISSING);
    const run = () => void (async () => {
      setBusy("copy");
      try {
        const r = await window.fanpost.mpCopy(a);
        message.success("正文已复制" + (r.images ? "（含 " + r.images + " 张图）" : "") + "。到公众号编辑器正文里 Ctrl+V，标题、作者、摘要另外填" + (r.skipped ? "；有 " + r.skipped + " 张图超过 5MB 没复制" : ""));
      } catch (e) {
        if (!handleQuota(e)) message.error(errText(e));
      } finally {
        setBusy("");
      }
    })();
    const notes = safetyItems.filter((i) => i.kind === "word");
    if (!notes.length) return run();
    Modal.confirm({ title: notes.length + " 处敏感词提醒", content: <ul className="confirm-issues">{notes.map((i, n) => <li key={n}>{i.text}</li>)}</ul>, okText: "我已确认，继续复制", cancelText: "回去修改", onOk: run });
  };
  const pickCover = async () => {
    const [p] = await window.fanpost.pickFiles("cover");
    if (p) set("cover", p);
  };
  const limit = (n: number, max: number) => <span className={"num mp-count" + (n > max ? " over" : "")}>{n}/{max}</span>;
  return (
    <div className="composer">
      <div className="composer-main">
        <section className="panel step">
          <header className="step-head">
            <span className="step-no num">01</span>
            <div>
              <h3>文章信息</h3>
              <p className="muted">按公众号规则检查长度</p>
            </div>
          </header>
          <div className="mp-fields">
            <label>
              <span>标题 {limit(count(a.title), MP_RULES.titleMax)}</span>
              <Input value={a.title} onChange={(e) => set("title", e.target.value)} placeholder="文章标题" />
            </label>
            <div className="mp-two">
              <label>
                <span>作者 {limit(count(a.author), MP_RULES.authorMax)}</span>
                <Input value={a.author} onChange={(e) => set("author", e.target.value)} placeholder="可不填" />
              </label>
              <label>
                <span>原文链接</span>
                <Input value={a.sourceUrl} onChange={(e) => set("sourceUrl", e.target.value)} placeholder="https://（可不填，文末「阅读原文」）" />
              </label>
            </div>
            <label>
              <span>摘要 {limit(count(a.digest), MP_RULES.digestMax)}</span>
              <Input.TextArea value={a.digest} onChange={(e) => set("digest", e.target.value)} autoSize={{ minRows: 2, maxRows: 4 }} placeholder="分享卡片上显示；不填就取正文前 54 字" />
            </label>
          </div>
        </section>
        <section className="panel step">
          <header className="step-head">
            <span className="step-no num">02</span>
            <div>
              <h3>正文 {limit(count(a.text), MP_RULES.bodyCharsMax)}</h3>
              <p className="muted">采集的排版和配图按原位置显示，所见即所存。点图片可以删掉，或在正文配图和转发预览图之间切换；单张超过 1MB 会自动压缩</p>
            </div>
          </header>
          <MpRichEditor html={a.html} onChange={setHtml} />
        </section>
      </div>
      <aside className="composer-side">
        <section className="panel step">
          <header className="step-head">
            <span className="step-no num">03</span>
            <div>
              <h3>发到公众号</h3>
              <p className="muted">{appId ? "已连接 " + appId : "还没填 AppID，只能复制"}</p>
            </div>
            <HelpLink topic="mp" label="" />
          </header>
          <div className="mp-cover">
            {coverPreview || a.images[0] ? <Image src={coverPreview || undefined} width={96} height={41} preview={!!coverPreview} fallback="" /> : <span className="mp-cover-empty"><PictureOutlined /></span>}
            <div>
              <b>封面</b>
              <p className="muted">{a.cover ? "已选封面图" : a.images.length ? "默认用第一张图" : "还没有图片"}</p>
            </div>
            <Button size="small" onClick={() => void pickCover()}>选封面</Button>
            {a.cover && <Button size="small" type="link" onClick={() => set("cover", undefined)}>清除</Button>}
          </div>
          <div className="declare-row">
            <span title="转载别人的文章要打开，并在「原文链接」里填原文地址；照搬比例高时必须打开才能保存">内容为转载</span>
            <Switch checked={!!a.repost} onChange={(v) => set("repost", v)} aria-label="内容为转载" />
          </div>
          {a.repost && !a.sourceUrl.trim() && <p className="muted mp-repost-tip">转载请在「原文链接」里填原文地址，读者可以点文末「阅读原文」看出处。</p>}
          <div className="declare-row">
            <span>留言</span>
            <Switch checked={a.openComment} onChange={(v) => set("openComment", v)} aria-label="打开留言" />
          </div>
          <ul className="check-list">
            {issues.length === 0 && <li className="ok">符合公众号规则，安全检查通过</li>}
            {issues.map((i, n) => <li key={n} className={i.level}>{i.text}</li>)}
            {a.source && <li className="info">采集来源：{a.source.title || a.source.url}</li>}
            {draft?.savedToMpAt && <li className="info">上次存进公众号：{new Date(draft.savedToMpAt).toLocaleString()}</li>}
          </ul>
          <ul className="mp-notes">{MP_NOTES.map((t) => <li key={t}>{t}</li>)}</ul>
          <Button block icon={<SaveOutlined />} loading={busy === "local"} onClick={() => void saveLocal()} className="draft-btn">保存到本机</Button>
          <div className="launch-row">
            <Button size="large" icon={<CopyOutlined />} loading={busy === "copy"} onClick={() => void copy()} className="launch-btn">一键复制</Button>
            <Button type="primary" size="large" icon={<WechatOutlined />} loading={busy === "mp"} disabled={!appId} title={appId ? "" : "先到设置里填公众号 AppID 和 AppSecret"} onClick={() => void toMp()} className="launch-btn">
              {busy === "mp" && step ? step : "存公众号草稿"}
            </Button>
          </div>
        </section>
      </aside>
    </div>
  );
}
