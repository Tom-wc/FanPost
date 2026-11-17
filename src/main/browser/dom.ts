import type { WebContents } from "electron";
import { writeBrowserLog } from "../log-bus";
import { redactDiagnostic } from "./common";
import {
  attach,
  backendId,
  cdp,
  flatDocument,
  indexNodes,
  mouseClick,
  nodeBox,
  parentOf,
  readAttrs,
  sleep,
  type FileInput,
  type FlatNode,
} from "./cdp";

const DISPATCH_FILE_CHANGE =
  "(()=>{for(const i of document.querySelectorAll('input[type=file]')){i.dispatchEvent(new Event('change',{bubbles:true}));i.dispatchEvent(new Event('input',{bubbles:true}))}return true})()";

export const dispatchFileChange = (wc: WebContents) =>
  wc.executeJavaScript(DISPATCH_FILE_CHANGE).catch(() => undefined);

const fileInputOf = (node: FlatNode): FileInput | undefined => {
  if (node.nodeName !== "INPUT") return undefined;
  const values = readAttrs(node);
  const type = (values.get("type") || "").toLowerCase();
  const accept = values.get("accept") || "";
  if (type !== "file" && !accept) return undefined;
  return { nodeId: backendId(node), accept, attributes: Object.fromEntries(values) };
};

export async function getFileInputs(wc: WebContents) {
  return (await flatDocument(wc)).map(fileInputOf).filter((x): x is FileInput => !!x);
}

export async function setFileInput(wc: WebContents, nodeId: number, files: string[]) {
  await cdp(wc, "DOM.setFileInputFiles", { backendNodeId: nodeId, files });
}

type InputKind = "video" | "image" | "not-video";
const matchesKind = (input: FileInput, kind: InputKind) =>
  kind === "not-video"
    ? /image/i.test(input.accept) || !/video/i.test(input.accept)
    : kind === "image"
      ? /image/i.test(input.accept) : /video/i.test(input.accept) || !/image/i.test(input.accept);

export const pickVideoInput = (inputs: FileInput[]) =>
  inputs.find((x) => /video/i.test(x.accept)) || inputs.find((x) => !/image/i.test(x.accept)) || inputs[0];

export async function waitForFileInputs(wc: WebContents, timeout: number) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const inputs = await getFileInputs(wc).catch(() => []);
    if (inputs.length) return inputs;
    await sleep(1500);
  }
  const frames = await Promise.all(
    [wc.mainFrame, ...wc.mainFrame.framesInSubtree].map((frame) =>
      frame
        .executeJavaScript(
          "(()=>({url:location.href,readyState:document.readyState,visibility:document.visibilityState,inputs:document.querySelectorAll('input[type=file],input[accept]').length,text:(document.body?.innerText||'').slice(0,1200)}))()",
        )
        .catch((error) => ({ error: String(error) })),
    ),
  );
  await writeBrowserLog("file-input-timeout " + redactDiagnostic(JSON.stringify({ url: wc.getURL(), frames }), 12000));
  return [];
}

export async function waitForMatchingFileInput(
  wc: WebContents,
  kind: "video" | "image",
  timeout: number,
  excluded: number[] = [],
) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const inputs = await getFileInputs(wc).catch(() => []);
    const found = inputs.find((input) => !excluded.includes(input.nodeId) && matchesKind(input, kind));
    if (found) return found;
    await sleep(500);
  }
  return undefined;
}

const DOM_CLICK_BY_TEXT =
  "((texts,preferBottom)=>{const visible=e=>!!e&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';const all=root=>{const result=[];for(const e of root.querySelectorAll('*')){result.push(e);if(e.shadowRoot)result.push(...all(e.shadowRoot))}return result};const candidates=all(document).filter(e=>e.matches?.('button,[role=button],a,div,span')&&visible(e)&&texts.includes((e.textContent||'').trim())&&!e.disabled&&e.getAttribute('aria-disabled')!=='true'&&!String(e.className||'').includes('disabled'));candidates.sort((a,b)=>{const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();return(preferBottom?br.top-ar.top:ar.top-br.top)||((ar.width*ar.height)-(br.width*br.height))});const target=candidates[0];if(!target)return false;target.scrollIntoView({block:'center',inline:'center'});target.focus?.();target.click();return true})";

async function textTargets(
  wc: WebContents,
  texts: string[],
  options: { maxDepth: number; skipHidden?: boolean; maxSize?: { width: number; height: number } },
) {
  const nodes = await flatDocument(wc);
  const byId = indexNodes(nodes);
  const result: Array<{ x: number; y: number; area: number; node: FlatNode }> = [];
  for (const textNode of nodes.filter((n) => n.nodeName === "#text" && texts.includes((n.nodeValue || "").trim()))) {
    if (options.skipHidden) {
      let hidden = false;
      for (let n = parentOf(byId, textNode), d = 0; n && d < 8; d++, n = parentOf(byId, n))
        if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test((n.attributes || []).join(" "))) hidden = true;
      if (hidden) continue;
    }
    for (let n = parentOf(byId, textNode), d = 0; n && d < options.maxDepth; d++, n = parentOf(byId, n)) {
      const box = await nodeBox(wc, { nodeId: n.nodeId });
      if (!box || box.width <= 3 || box.height <= 3) continue;
      if (options.maxSize && (box.width >= options.maxSize.width || box.height >= options.maxSize.height)) continue;
      result.push({ x: box.x, y: box.y, area: box.area, node: n });
    }
  }
  return result;
}

export async function clickButtonByText(wc: WebContents, texts: string[], preferBottom = true, trustedOnly = false) {
  attach(wc);
  if (!trustedOnly) {
    const script = DOM_CLICK_BY_TEXT + "(" + JSON.stringify(texts) + "," + JSON.stringify(preferBottom) + ")";
    if (await wc.executeJavaScript(script).catch(() => false)) return true;
  }
  const candidates = await textTargets(wc, texts, { maxDepth: 6, maxSize: { width: 700, height: 180 } });
  candidates.sort((a, b) => (preferBottom ? b.y - a.y : a.y - b.y) || a.area - b.area);
  const target = candidates[0];
  if (!target) return false;
  await mouseClick(wc, target.x, target.y);
  return true;
}

export async function clickSmallestByText(wc: WebContents, text: string) {
  const rank = (node: FlatNode) =>
    node.nodeName === "LI" && /bcc-option/i.test((node.attributes || []).join(" ")) ? 0 : node.nodeName === "ARTICLE" ? 1 : 2;
  const candidates = await textTargets(wc, [text], { maxDepth: 6, skipHidden: true });
  candidates.sort((a, b) => rank(a.node) - rank(b.node) || a.area - b.area);
  const target = candidates[0];
  if (!target) return false;
  await mouseClick(wc, target.x, target.y);
  return true;
}

export async function waitAndClickButton(wc: WebContents, texts: string[], timeout: number, preferBottom = true) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await clickButtonByText(wc, texts, preferBottom).catch(() => false)) return true;
    await sleep(500);
  }
  return false;
}

async function trustedClickBySelectors(wc: WebContents, selectors: string[]) {
  const point = await wc
    .executeJavaScript(
      "((sels)=>{for(const s of sels){let list=[];try{list=[...document.querySelectorAll(s)]}catch(_){continue}const el=list.find(e=>e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden'&&!/视频/.test(e.textContent||''));if(el){el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,sel:s}}}return null})(" +
        JSON.stringify(selectors) +
        ")",
    )
    .catch(() => null);
  if (!point) return false;
  await mouseClick(wc, point.x, point.y, 80 + Math.random() * 120);
  void writeBrowserLog("article-upload-selector-click " + JSON.stringify(point));
  return true;
}

export async function withFileChooser<T>(wc: WebContents, run: (chooser: () => number | undefined, reset: () => void) => Promise<T>) {
  const debuggerApi = attach(wc);
  await cdp(wc, "Page.enable").catch(() => undefined);
  await cdp(wc, "DOM.enable");
  let chooserNodeId: number | undefined;
  const listener = (_event: Electron.Event, method: string, params: any) => {
    if (method === "Page.fileChooserOpened" && params?.backendNodeId) chooserNodeId = params.backendNodeId;
  };
  debuggerApi.on("message", listener);
  await cdp(wc, "Page.setInterceptFileChooserDialog", { enabled: true });
  try {
    return await run(
      () => chooserNodeId,
      () => (chooserNodeId = undefined),
    );
  } finally {
    debuggerApi.removeListener("message", listener);
    await cdp(wc, "Page.setInterceptFileChooserDialog", { enabled: false }).catch(() => undefined);
  }
}

async function injectAfterClick(
  wc: WebContents,
  files: string[],
  kind: InputKind,
  before: number[],
  chooser: () => number | undefined,
  allowExisting: boolean,
) {
  const start = Date.now();
  while (Date.now() - start < 30000) {
    const chosen = chooser();
    if (chosen) {
      await setFileInput(wc, chosen, files);
      return true;
    }
    const candidates = (await getFileInputs(wc).catch(() => [])).filter((input) => matchesKind(input, kind));
    const target = candidates.filter((input) => !before.includes(input.nodeId)).at(-1) || (allowExisting ? candidates.at(-1) : undefined);
    if (target && Date.now() - start > 800) {
      await setFileInput(wc, target.nodeId, files);
      return true;
    }
    await sleep(400);
  }
  return false;
}

export async function chooseFileFromButton(wc: WebContents, labels: string[], file: string) {
  const kind = labels.some((value) => /封面|图片/.test(value)) ? "image" : "video";
  const before = (await getFileInputs(wc).catch(() => [])).map((input) => input.nodeId);
  await withFileChooser(wc, async (chooser) => {
    if (!(await clickButtonByText(wc, labels, true, true))) throw new Error(labels.join("/") + "上传按钮不存在");
    if (!(await injectAfterClick(wc, [file], kind, before, chooser, true)))
      throw new Error(labels.join("/") + "未产生可用文件控件");
  });
}

export async function chooseFilesFromButton(wc: WebContents, labels: string[], files: string[], selectors: string[] = []) {
  if (!files.length) return false;
  const before = (await getFileInputs(wc).catch(() => [])).map((input) => input.nodeId);
  return withFileChooser(wc, async (chooser) => {
    const clicked =
      (await clickButtonByText(wc, labels, false, false)) ||
      (selectors.length > 0 && (await trustedClickBySelectors(wc, selectors)));
    if (!clicked) {
      void writeBrowserLog("article-upload-button-not-found labels=" + JSON.stringify(labels));
      return false;
    }
    const injected = await injectAfterClick(wc, files, "not-video", before, chooser, false);
    if (injected && !chooser()) await dispatchFileChange(wc);
    return injected;
  });
}

export async function uploadFileByActions(
  wc: WebContents,
  file: string,
  kind: "video" | "image",
  actions: string[],
  excluded: number[] = [],
  timeout = 30000,
) {
  const before = (await getFileInputs(wc).catch(() => [])).map((input) => input.nodeId);
  if (!(await waitAndClickButton(wc, actions, Math.min(timeout, 15000), false))) return false;
  const fresh = await waitForMatchingFileInput(wc, kind, Math.min(timeout, 15000), [...excluded, ...before]);
  if (fresh) {
    await setFileInput(wc, fresh.nodeId, [file]);
    return true;
  }
  try {
    await chooseFileFromButton(wc, actions, file);
    return true;
  } catch {}
  const existing = await waitForMatchingFileInput(wc, kind, Math.min(timeout, 5000), excluded);
  if (!existing) return false;
  await setFileInput(wc, existing.nodeId, [file]);
  return true;
}

export async function findFileInputNearText(wc: WebContents, text: string) {
  const nodes = await flatDocument(wc);
  const byId = indexNodes(nodes);
  const children = new Map<number, FlatNode[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    children.set(node.parentId, [...(children.get(node.parentId) || []), node]);
  }
  const descendantInputs = (root: number) => {
    const queue = (children.get(root) || []).map((node) => ({ node, depth: 1 }));
    const found: Array<{ input: FileInput; depth: number }> = [];
    while (queue.length) {
      const current = queue.shift()!;
      const input = fileInputOf(current.node);
      if (input) found.push({ input, depth: current.depth });
      for (const child of children.get(current.node.nodeId) || []) queue.push({ node: child, depth: current.depth + 1 });
    }
    return found;
  };
  const wantsImage = /封面|图片/.test(text);
  const wantsVideo = /视频/.test(text) && !wantsImage;
  const penalty = (accept: string) =>
    wantsImage ? (/image/i.test(accept) ? 0 : 10000) : wantsVideo ? (/video/i.test(accept) ? 0 : /image/i.test(accept) ? 10000 : 50) : 0;
  const candidates = new Map<number, { input: FileInput; score: number; y: number; area: number }>();
  for (const textNode of nodes.filter((n) => n.nodeName === "#text" && (n.nodeValue || "").trim() === text)) {
    const box = await nodeBox(wc, { nodeId: textNode.parentId || textNode.nodeId });
    if (!box) continue;
    for (let n = parentOf(byId, textNode), depth = 0; n && depth < 12; depth++, n = parentOf(byId, n)) {
      for (const found of descendantInputs(n.nodeId)) {
        const score = depth * 100 + found.depth + penalty(found.input.accept);
        const previous = candidates.get(found.input.nodeId);
        if (!previous || score < previous.score)
          candidates.set(found.input.nodeId, { input: found.input, score, y: box.y, area: box.area });
      }
    }
  }
  return [...candidates.values()].sort((a, b) => a.score - b.score || b.y - a.y || a.area - b.area)[0]?.input;
}

export async function setFileByExpression(wc: WebContents, expression: string, files: string[]) {
  await cdp(wc, "Runtime.enable");
  const r = (await cdp(wc, "Runtime.evaluate", { expression })) as { result?: { objectId?: string; subtype?: string } };
  const objectId = r.result?.subtype === "node" ? r.result.objectId : undefined;
  if (!objectId) return false;
  await cdp(wc, "DOM.enable");
  await cdp(wc, "DOM.setFileInputFiles", { objectId, files });
  await cdp(wc, "Runtime.releaseObject", { objectId }).catch(() => undefined);
  return true;
}
