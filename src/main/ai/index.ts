import { app, ipcMain, type BrowserWindow } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { activeProvider, AI_ERRORS, parseAiConfig, providerReady, sameEndpoint, toConfigView, type AiAction, type AiConfig, type AiProvider, type AiRunInput } from "../../shared/ai.ts";
import { readSealed, writeSealed } from "../secure-file";
import { buildPrompt } from "./prompts";
import { listModels, probeChat, streamChat } from "./client";

const FILE = () => path.join(app.getPath("userData"), "ai-config.json");
const running = new Map<string, AbortController>();

let cache: AiConfig | undefined;

async function load(): Promise<AiConfig> {
  if (cache) return cache;
  const raw = await readSealed(FILE()).catch(() => "");
  cache = parseAiConfig(raw);
  return cache;
}

async function save(next: AiConfig): Promise<AiConfig> {
  const config = parseAiConfig(next);
  cache = config;
  await writeSealed(FILE(), JSON.stringify(config));
  return config;
}

async function mergeKeys(incoming: AiConfig): Promise<AiConfig> {
  const current = await load();
  const providers = incoming.providers.map((p) => {
    if (p.apiKey) return p;
    const old = current.providers.find((x) => x.id === p.id && sameEndpoint(x.baseUrl, p.baseUrl));
    return old?.apiKey ? { ...p, apiKey: old.apiKey } : p;
  });
  return { active: incoming.active, providers };
}

/**
 * 界面里还没保存的草稿。Key 留空表示「不改」，回落到已保存的同 id 模型。
 * 这是「填的时候就能测」的前提：不先落盘也能试。
 */
async function draftOf(raw: unknown): Promise<{ provider?: AiProvider; error?: string }> {
  const v = (raw || {}) as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === "string" ? x.trim() : "");
  const baseUrl = str(v.baseUrl);
  const model = str(v.model);
  const id = str(v.id);
  if (!baseUrl) return { error: "先填接口地址" };
  if (!/^https?:\/\//i.test(baseUrl)) return { error: "接口地址要以 http:// 或 https:// 开头" };
  if (!model) return { error: "先填模型名，或者点「获取列表」选一个" };
  let apiKey = str(v.apiKey);
  if (!apiKey && id) {
    const saved = await load();
    apiKey = saved.providers.find((p) => p.id === id && sameEndpoint(p.baseUrl, baseUrl))?.apiKey || "";
  }
  const headers = v.headers && typeof v.headers === "object" ? (v.headers as Record<string, string>) : undefined;
  return { provider: { id, name: str(v.name) || id || "probe", baseUrl, model, apiKey, ...(headers ? { headers } : {}) } };
}

function actionOf(value: unknown): AiAction {
  const list: AiAction[] = ["polish", "expand", "shorten", "title", "topics", "rewrite", "reply"];
  return list.includes(value as AiAction) ? (value as AiAction) : "polish";
}

export function registerAi(getWindow: () => BrowserWindow | undefined) {
  ipcMain.handle("ai:config", async () => {
    const config = await load();
    const provider = activeProvider(config);
    return { ...toConfigView(config), ready: providerReady(provider), templates: true };
  });

  ipcMain.handle("ai:save", async (_e, raw: unknown) => {
    const incoming = parseAiConfig(raw);
    const merged = await mergeKeys(incoming);
    const saved = await save(merged);
    return { ...toConfigView(saved), ready: providerReady(activeProvider(saved)) };
  });

  ipcMain.handle("ai:test", async (_e, id: unknown) => {
    const config = await load();
    const provider = config.providers.find((p) => p.id === id) || activeProvider(config);
    if (!provider) return { ok: false, error: AI_ERRORS.missing };
    if (!providerReady(provider)) return { ok: false, error: AI_ERRORS.notReady };
    const r = await probeChat(provider);
    return r.ok
      ? { ok: true, ms: r.ms, sample: r.sample, model: provider.model }
      : { ok: false, ms: r.ms, error: r.error || "调用失败" };
  });

  /** 未保存的草稿直接测；通了顺带告诉界面该把 baseUrl 存成什么 */
  ipcMain.handle("ai:probe", async (_e, raw: unknown) => {
    const { provider, error } = await draftOf(raw);
    if (!provider) return { ok: false, ms: 0, error };
    const r = await probeChat(provider);
    return { ok: r.ok, ms: r.ms, sample: r.sample, model: r.model, baseUrl: r.baseUrl, error: r.error };
  });

  /** 拉模型列表：解决「模型名靠手抄抄错」这个最常见的接入失败 */
  ipcMain.handle("ai:models", async (_e, raw: unknown) => {
    const v = (raw || {}) as Record<string, unknown>;
    const str = (x: unknown) => (typeof x === "string" ? x.trim() : "");
    const baseUrl = str(v.baseUrl);
    if (!baseUrl) return { ok: false, models: [], error: "先填接口地址" };
    if (!/^https?:\/\//i.test(baseUrl)) return { ok: false, models: [], error: "接口地址要以 http:// 或 https:// 开头" };
    const id = str(v.id);
    let apiKey = str(v.apiKey);
    if (!apiKey && id) {
      const saved = await load();
      apiKey = saved.providers.find((p) => p.id === id && sameEndpoint(p.baseUrl, baseUrl))?.apiKey || "";
    }
    return listModels({ id, name: "", baseUrl, model: "-", apiKey });
  });

  ipcMain.handle("ai:cancel", (_e, requestId: unknown) => {
    if (typeof requestId === "string") running.get(requestId)?.abort();
    return true;
  });

  ipcMain.handle("ai:run", async (_e, raw: unknown) => {
    const input = (raw || {}) as AiRunInput;
    const requestId = typeof input.requestId === "string" ? input.requestId : "";
    const text = typeof input.text === "string" ? input.text.trim() : "";
    if (!requestId) return { ok: false, error: "缺少请求编号" };
    const config = await load();
    const provider = activeProvider(config);
    if (!provider) return { ok: false, error: AI_ERRORS.missing };
    if (!providerReady(provider)) return { ok: false, error: AI_ERRORS.notReady };
    if (!text) return { ok: false, error: AI_ERRORS.empty };
    const controller = new AbortController();
    running.set(requestId, controller);
    const messages = buildPrompt(actionOf(input.action), {
      text,
      ...(input.platform ? { platform: input.platform as never } : {}),
      ...(input.type ? { type: input.type } : {}),
      ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
      ...(input.instruction ? { instruction: input.instruction } : {}),
    });
    try {
      const result = await streamChat(provider, messages, {
        signal: controller.signal,
        onDelta: (delta) => getWindow()?.webContents.send("ai:delta", { requestId, delta }),
      });
      // 老配置如果少了 /v1，这次跑到通了，就顺手把正确的地址存回去，别每次都试错
      if (result.baseUrl && result.baseUrl !== provider.baseUrl) {
        const latest = await load();
        await save({ ...latest, providers: latest.providers.map((p) => (p.id === provider.id ? { ...p, baseUrl: result.baseUrl! } : p)) });
      }
      getWindow()?.webContents.send("ai:done", { requestId, ok: result.ok, text: result.text, error: result.error, model: provider.model });
      // 结果同时从返回值带回去：串行批量调用时，事件可能晚于 invoke 的 resolve 到达，
      // 只靠事件会出现「上一个还在生成中」的错觉
      return { ok: result.ok, error: result.error, text: result.text };
    } finally {
      running.delete(requestId);
    }
  });
}

export async function aiConfigured() {
  const config = await load();
  return providerReady(activeProvider(config));
}

export async function clearAiCache() {
  cache = undefined;
  await fs.rm(FILE(), { force: true }).catch(() => undefined);
}
