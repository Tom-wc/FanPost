import { useEffect, useMemo, useState } from "react";
import { Alert, AutoComplete, Button, Input, InputNumber, Modal, Popconfirm, Select, Tag, message } from "antd";
import type { AiProviderView } from "../../shared/ai";
import { isLocalEndpoint, PROVIDER_TEMPLATES } from "../../shared/ai";

interface Draft extends AiProviderView {
  apiKey: string;
}

type ProbeState = {
  state: "idle" | "testing" | "ok" | "fail";
  /** 这次结果对应的表单指纹；表单改了就对不上了，得重测 */
  sig?: string;
  ms?: number;
  sample?: string;
  error?: string;
  baseUrl?: string;
};

const blank = (id: string, name = "", baseUrl = "", model = ""): Draft => ({
  id,
  name: name || id,
  baseUrl,
  model,
  apiKey: "",
  keyMask: "",
  hasKey: false,
});

const newId = () => "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const errText = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

function fromView(list: AiProviderView[]): Draft[] {
  return list.map((p) => ({ ...p, apiKey: "" }));
}

/** 表单指纹：地址、模型、Key 任一改动，之前的测试结果就作废 */
const signatureOf = (d: Draft) => [d.baseUrl.trim(), d.model.trim(), d.apiKey.trim()].join("|");

export function AiSettings() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [active, setActive] = useState("");
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Draft>();
  const [editorOpen, setEditorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [probe, setProbe] = useState<ProbeState>({ state: "idle" });
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  /** 下拉里放什么：按当前输入筛；一个都匹配不上（比如填的是价目表上的分组名）就全列出来，不能空着 */
  const modelOptions = useMemo(() => {
    if (!models.length) return [];
    const q = (editing?.model || "").trim().toLowerCase();
    const hit = q ? models.filter((m) => m.toLowerCase().includes(q)) : models;
    return (hit.length ? hit : models).map((m) => ({ value: m, label: m }));
  }, [models, editing?.model]);

  const load = async () => {
    setLoading(true);
    try {
      const cfg = await window.fanpost.getAiConfig();
      setDrafts(fromView(cfg.providers));
      setActive(cfg.active);
      setReady(cfg.ready);
      setError("");
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const persist = async (list: Draft[], nextActive: string, note: string) => {
    setBusy(true);
    try {
      const r = await window.fanpost.saveAiConfig({
        active: nextActive,
        providers: list.map((p) => ({
          id: p.id,
          name: p.name,
          baseUrl: p.baseUrl,
          model: p.model,
          ...(p.apiKey ? { apiKey: p.apiKey } : {}),
          ...(p.headers ? { headers: p.headers } : {}),
          ...(p.temperature === undefined ? {} : { temperature: p.temperature }),
          ...(p.maxOutputTokens === undefined ? {} : { maxOutputTokens: p.maxOutputTokens }),
        })),
      });
      setDrafts(fromView(r.providers));
      setActive(r.active);
      setReady(r.ready);
      if (note) message.success(note);
      return r.ready;
    } catch (e) {
      message.error(errText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  /** 用当前表单里的值（包括还没保存的 Key）真发一次请求 */
  const runProbe = async (d: Draft): Promise<ProbeState> => {
    const sig = signatureOf(d);
    setProbe({ state: "testing", sig });
    try {
      const r = await window.fanpost.probeAi({
        id: d.id,
        name: d.name,
        baseUrl: d.baseUrl.trim(),
        model: d.model.trim(),
        apiKey: d.apiKey.trim(),
      });
      const next: ProbeState = r.ok
        ? { state: "ok", sig, ms: r.ms, sample: r.sample, baseUrl: r.baseUrl }
        : { state: "fail", sig, ms: r.ms, error: r.error || "调用失败" };
      setProbe(next);
      return next;
    } catch (e) {
      const next: ProbeState = { state: "fail", sig, error: errText(e) };
      setProbe(next);
      return next;
    }
  };

  const submit = async () => {
    if (!editing) return;
    const name = editing.name.trim() || editing.id;
    const baseUrl = editing.baseUrl.trim();
    const model = editing.model.trim();
    if (!/^https?:\/\//i.test(baseUrl)) {
      message.warning("接口地址要以 http:// 或 https:// 开头");
      return;
    }
    if (!model) {
      message.warning("填一个模型名，或者点「获取列表」从服务商那里拉一份");
      return;
    }
    const next = { ...editing, name, baseUrl, model };
    const origin = drafts.find((p) => p.id === next.id);
    // 只改了名字/温度这类，没必要重测；连接参数动过就必须测通
    const connChanged = !origin || origin.baseUrl !== baseUrl || origin.model !== model || next.apiKey.trim() !== "";
    if (connChanged) {
      const fresh = probe.state === "ok" && probe.sig === signatureOf(next) ? probe : await runProbe(next);
      if (fresh.state !== "ok") {
        message.error("连通没通过，没保存：" + (fresh.error || "未知原因"));
        return;
      }
      // 探测时自动补上的 /v1 等，直接存正确的那个
      if (fresh.baseUrl && fresh.baseUrl !== baseUrl) next.baseUrl = fresh.baseUrl;
    }
    const list = drafts.some((p) => p.id === next.id) ? drafts.map((p) => (p.id === next.id ? next : p)) : [...drafts, next];
    const ok = await persist(list, active || next.id, connChanged ? "已保存，连通正常" : "已保存");
    if (ok) setEditorOpen(false);
  };

  const remove = async (id: string) => {
    const list = drafts.filter((p) => p.id !== id);
    const nextActive = active === id ? list[0]?.id || "" : active;
    await persist(list, nextActive, "已删除");
  };

  const makeActive = async (id: string) => {
    if (id === active) return;
    await persist(drafts, id, "已切换默认模型");
  };

  /** 列表里的「测试连通」：走已保存的配置 */
  const test = async (id: string) => {
    setTesting(true);
    try {
      const r = await window.fanpost.testAi(id);
      if (r.ok) message.success("连通正常 · " + (r.model || "") + " · " + (r.ms || 0) + "ms");
      else message.error("连不通：" + (r.error || "未知错误"));
    } catch (e) {
      message.error(errText(e));
    } finally {
      setTesting(false);
    }
  };

  const fetchModels = async () => {
    if (!editing) return;
    if (!/^https?:\/\//i.test(editing.baseUrl.trim())) {
      message.warning("先把接口地址填上");
      return;
    }
    setLoadingModels(true);
    try {
      const r = await window.fanpost.listAiModels({
        id: editing.id,
        baseUrl: editing.baseUrl.trim(),
        apiKey: editing.apiKey.trim(),
      });
      if (!r.ok) {
        message.warning(r.error || "拿不到模型列表");
        return;
      }
      setModels(r.models);
      if (!r.models.length) {
        message.info("接口是通的，但这家没返回模型列表，手动填模型名就行");
        return;
      }
      message.success("拿到 " + r.models.length + " 个模型，在下面点一个");
    } catch (e) {
      message.error(errText(e));
    } finally {
      setLoadingModels(false);
    }
  };

  const openEditor = (d: Draft) => {
    setEditing(d);
    setEditorOpen(true);
    setProbe({ state: "idle" });
    setModels([]);
  };

  /** 改表单同时把测试结果作废 */
  const patch = (p: Partial<Draft>) => {
    setEditing((prev) => (prev ? { ...prev, ...p } : prev));
    setProbe((prev) => (prev.state === "testing" ? prev : { state: "idle" }));
  };

  const current = drafts.find((p) => p.id === active);
  const editingSaved = drafts.some((p) => p.id === editing?.id);
  // 本机 / 局域网模型：超时按 180 秒算，文案要说清楚在等什么
  const probingLocal = isLocalEndpoint(editing?.baseUrl || current?.baseUrl || "");
  const probeText = () => {
    if (probe.state === "testing")
      return probingLocal
        ? "正在连本机模型，首次要加载权重，等 1–3 分钟是正常的…"
        : "正在连服务商，最多等 25 秒…";
    if (probe.state === "ok") return "连通正常 · " + ((probe.ms || 0) / 1000).toFixed(1) + " 秒 · 模型回了「" + (probe.sample || "可用") + "」";
    if (probe.state === "fail") return probe.error || "连不通";
    return probingLocal
      ? "还没测过。本机模型要自己算，保存前会先测一次，通了才存"
      : "还没测过。保存时会自动测一次，通了才存";
  };

  return (
    <div className="ai-settings">
      {error && <Alert type="error" showIcon title={error} />}
      <div className="license-row">
        <span>当前</span>
        {current ? (
          <>
            <Tag color={ready ? "success" : "warning"}>{current.name}</Tag>
            <span className="muted num">{current.model}</span>
            {current.hasKey ? <span className="muted num">{current.keyMask}</span> : <Tag>未填 Key</Tag>}
          </>
        ) : (
          <Tag>未配置</Tag>
        )}
        <span className="ai-settings-head">
          {current && (
            <Button size="small" loading={testing} onClick={() => void test(current.id)}>测试连通</Button>
          )}
          <Button size="small" type="primary" onClick={() => openEditor(blank(newId()))}>添加模型</Button>
        </span>
      </div>

      {drafts.length > 0 && (
        <div className="ai-model-list">
          {drafts.map((p) => (
            <div key={p.id} className={"ai-model-row" + (p.id === active ? " is-active" : "")}>
              <span className="ai-model-name">
                <b>{p.name}</b>
                <em className="num">{p.model}</em>
              </span>
              <span className="ai-model-key num">{p.hasKey ? p.keyMask : "无 Key"}</span>
              <span className="ai-model-ops">
                {p.id !== active && <Button size="small" type="text" disabled={busy} onClick={() => void makeActive(p.id)}>设为默认</Button>}
                {p.id === active && <Tag bordered={false} color="blue">默认</Tag>}
                <Button size="small" type="text" onClick={() => openEditor({ ...p })}>编辑</Button>
                <Popconfirm title="删除这个模型？" okText="删除" cancelText="取消" onConfirm={() => void remove(p.id)}>
                  <Button size="small" type="text" danger>删除</Button>
                </Popconfirm>
              </span>
            </div>
          ))}
        </div>
      )}

      {!loading && !drafts.length && !error && (
        <p className="muted ai-settings-note">
          还没添加模型。点「添加模型」填一个 OpenAI 兼容接口就行 —— DeepSeek、通义、Kimi、智谱、本地 Ollama、各种中转站都支持。软件不代购、不中转，内容直接发给你填的服务商。
        </p>
      )}
      {drafts.length > 0 && (
        <p className="muted ai-settings-note">
          Key 用系统加密存在本机，不上传、不进日志。
          <br />
          编辑器里的润色、扩写、精简、标题、话题都走「默认」这个模型。
        </p>
      )}

      <Modal
        open={editorOpen}
        width={600}
        title={editingSaved ? "编辑模型" : "添加模型"}
        onCancel={() => setEditorOpen(false)}
        footer={
          <div className="ai-modal-footer">
            <span className="ai-modal-meta">{editing?.hasKey ? "已存 Key：" + editing.keyMask + "，留空表示不改" : ""}</span>
            <Button onClick={() => setEditorOpen(false)}>取消</Button>
            <Button type="primary" loading={busy} onClick={() => void submit()}>保存</Button>
          </div>
        }
      >
        {editing && (
          <div className="ai-provider-grid">
            <label>
              <span>名称</span>
              <Input value={editing.name} onChange={(e) => patch({ name: e.target.value })} placeholder="随便起个名" />
            </label>
            <label>
              <span>接口地址（base URL）</span>
              <Input
                value={editing.baseUrl}
                onChange={(e) => patch({ baseUrl: e.target.value })}
                placeholder="https://api.deepseek.com/v1"
              />
            </label>
            <label className="span-2">
              <span>API Key</span>
              <Input.Password
                value={editing.apiKey}
                onChange={(e) => patch({ apiKey: e.target.value })}
                placeholder={editing.hasKey ? "已保存，留空表示不修改" : "粘贴你的 Key"}
                autoComplete="off"
              />
            </label>
            <label className="span-2">
              <span>模型名</span>
              <div className="ai-model-input">
                <AutoComplete
                  value={editing.model}
                  onChange={(v) => patch({ model: v })}
                  placeholder="填模型名，或点右边从服务商拉一份"
                  options={modelOptions}
                  // 选项已经按输入算好了，别再让组件按输入二次过滤——否则填了不存在的名字就一条都看不见
                  showSearch={{ filterOption: false }}
                  listHeight={264}
                  onFocus={(e) => {
                    // 模型名不是英文单词，别让浏览器画拼写红波浪线
                    (e.target as HTMLInputElement).spellcheck = false;
                  }}
                  notFoundContent={models.length ? null : "还没拉列表，点右边「获取列表」"}
                />
                <Button loading={loadingModels} onClick={() => void fetchModels()}>获取列表</Button>
              </div>
            </label>
            {models.length > 0 && (
              <div className="span-2 ai-model-picks">
                <span className="ai-model-picks-head">服务商返回 {models.length} 个模型，点一个直接填进去</span>
                <div className="ai-model-chips">
                  {models.map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={"ai-model-chip" + (editing.model.trim() === m ? " is-on" : "")}
                      onClick={() => patch({ model: m })}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <label>
              <span>温度（留空用默认）</span>
              <InputNumber
                min={0}
                max={2}
                step={0.1}
                style={{ width: "100%" }}
                value={editing.temperature}
                onChange={(v) => patch({ temperature: v === null ? undefined : v })}
              />
            </label>
            <label>
              <span>最大输出 token</span>
              <InputNumber
                min={0}
                max={393216}
                step={512}
                style={{ width: "100%" }}
                value={editing.maxOutputTokens}
                onChange={(v) => patch({ maxOutputTokens: v === null ? undefined : v })}
              />
              <small className="ai-field-hint">留空交给服务商默认（本地模型按 1024 算）。思考型模型填太小会「只思考、不写正文」，建议 1024 以上</small>
            </label>
            <label className="span-2">
              <span>从模板快速填入</span>
              <Select
                value={null}
                placeholder="选一个厂商"
                options={PROVIDER_TEMPLATES.map((t) => ({ value: t.id, label: t.name, note: t.note }))}
                // 说明文字会把下拉撑到 680 宽，太宽；固定 520 让它折行，也不至于跑出窗口
                popupMatchSelectWidth={520}
                // 模板的说明（含本地模型实测速度）直接铺在选项里，不用点进去才知道
                optionRender={(opt) => (
                  <div className="ai-tpl-option">
                    <span>{String(opt.data.label ?? "")}</span>
                    <small>{String(opt.data.note ?? "")}</small>
                  </div>
                )}
                onChange={(id) => {
                  const tpl = PROVIDER_TEMPLATES.find((t) => t.id === id);
                  if (!tpl) return;
                  // 名称还是自动生成的 id（没手动改过）就换成模板名，别留一串乱码
                  patch({ baseUrl: tpl.baseUrl, model: tpl.model, name: !editing.name || editing.name === editing.id ? tpl.name : editing.name });
                }}
              />
            </label>
          </div>
        )}
        {editing && (
          <div className={"ai-probe-bar " + probe.state}>
            <span>{probeText()}</span>
            <Button size="small" loading={probe.state === "testing"} onClick={() => editing && void runProbe(editing)}>
              测试连接
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
