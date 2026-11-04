import type { WebContents } from "electron";

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type FlatNode = {
  nodeId: number;
  backendNodeId?: number;
  parentId?: number;
  nodeName: string;
  nodeValue?: string;
  attributes?: string[];
};
export type FileInput = { nodeId: number; accept: string; attributes: Record<string, string> };
type NodeRef = { nodeId?: number; backendNodeId?: number };

export function attach(wc: WebContents) {
  if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
  return wc.debugger;
}

export const cdp = (wc: WebContents, method: string, params?: object) =>
  attach(wc).sendCommand(method, params);

export function detach(wc: WebContents) {
  try {
    if (wc.debugger.isAttached()) wc.debugger.detach();
  } catch {}
}

export async function flatDocument(wc: WebContents): Promise<FlatNode[]> {
  await cdp(wc, "DOM.enable");
  const result = await cdp(wc, "DOM.getFlattenedDocument", { depth: -1, pierce: true });
  return (result.nodes || []) as FlatNode[];
}

export const indexNodes = (nodes: FlatNode[]) => new Map(nodes.map((node) => [node.nodeId, node]));

export const parentOf = (byId: Map<number, FlatNode>, node?: FlatNode) =>
  node?.parentId ? byId.get(node.parentId) : undefined;

export function readAttrs(node: FlatNode) {
  const attrs = node.attributes || [];
  const result = new Map<string, string>();
  for (let index = 0; index < attrs.length; index += 2) result.set(attrs[index], attrs[index + 1] || "");
  return result;
}

export const backendId = (node: FlatNode) => node.backendNodeId || node.nodeId;

export async function nodeBox(wc: WebContents, ref: NodeRef) {
  try {
    const model = await cdp(wc, "DOM.getBoxModel", ref);
    const quad = (model.model.border || model.model.content) as number[];
    const xs = [quad[0], quad[2], quad[4], quad[6]];
    const ys = [quad[1], quad[3], quad[5], quad[7]];
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    return {
      x: xs.reduce((sum, value) => sum + value, 0) / 4,
      y: ys.reduce((sum, value) => sum + value, 0) / 4,
      width,
      height,
      area: width * height,
    };
  } catch {
    return undefined;
  }
}

export async function mouseClick(wc: WebContents, x: number, y: number, holdMs = 120) {
  await cdp(wc, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await cdp(wc, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await sleep(holdMs);
  await cdp(wc, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
}

const KEYS = {
  a: { key: "a", code: "KeyA", windowsVirtualKeyCode: 65 },
  Backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
  Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
  Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
};

export async function pressTab(wc: WebContents) {
  await cdp(wc, "Input.dispatchKeyEvent", { type: "keyDown", ...KEYS.Tab });
  await cdp(wc, "Input.dispatchKeyEvent", { type: "keyUp", ...KEYS.Tab });
}

export async function pressEnter(wc: WebContents) {
  await cdp(wc, "Input.dispatchKeyEvent", { type: "keyDown", ...KEYS.Enter, text: "\r" });
  await cdp(wc, "Input.dispatchKeyEvent", { type: "keyUp", ...KEYS.Enter });
}

export async function callOnNode(wc: WebContents, backendNodeId: number, functionDeclaration: string, args: unknown[] = []) {
  const resolved = await cdp(wc, "DOM.resolveNode", { backendNodeId });
  const objectId = resolved.object?.objectId;
  if (!objectId) return undefined;
  try {
    const invoked = await cdp(wc, "Runtime.callFunctionOn", {
      objectId,
      functionDeclaration,
      arguments: args.map((value) => ({ value })),
      returnByValue: true,
    });
    return invoked.result?.value;
  } finally {
    await cdp(wc, "Runtime.releaseObject", { objectId }).catch(() => undefined);
  }
}

export const SET_NATIVE_VALUE =
  'function(value){const proto=this instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const setter=Object.getOwnPropertyDescriptor(proto,"value")?.set;setter?setter.call(this,value):this.value=value;this.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:value}));this.dispatchEvent(new Event("change",{bubbles:true}));this.dispatchEvent(new Event("blur",{bubbles:true}));return this.value}';

const CLEAR_FIELD =
  'function(){if(this instanceof HTMLInputElement||this instanceof HTMLTextAreaElement){const proto=this instanceof HTMLInputElement?HTMLInputElement.prototype:HTMLTextAreaElement.prototype;const setter=Object.getOwnPropertyDescriptor(proto,"value")?.set;setter?setter.call(this,""):this.value=""}else{this.innerHTML="";this.textContent=""}this.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"deleteContentBackward"}));this.dispatchEvent(new Event("change",{bubbles:true}));return true}';

export async function typeInto(wc: WebContents, backendNodeId: number, text: string, options: { clear?: boolean; tab?: boolean } = {}) {
  if (options.clear) await callOnNode(wc, backendNodeId, CLEAR_FIELD);
  await cdp(wc, "DOM.focus", { backendNodeId });
  await cdp(wc, "Input.dispatchKeyEvent", { type: "rawKeyDown", ...KEYS.a, modifiers: 2 });
  await cdp(wc, "Input.dispatchKeyEvent", { type: "rawKeyDown", ...KEYS.Backspace });
  await cdp(wc, "Input.dispatchKeyEvent", { type: "keyUp", ...KEYS.Backspace });
  await cdp(wc, "Input.dispatchKeyEvent", { type: "keyUp", ...KEYS.a, modifiers: 2 });
  await cdp(wc, "Input.insertText", { text });
  if (options.tab !== false) await pressTab(wc);
  await sleep(700);
}

export async function pressKey(wc: WebContents, key: "Escape") {
  const k = { key, code: key, windowsVirtualKeyCode: 27 };
  await cdp(wc, "Input.dispatchKeyEvent", { type: "rawKeyDown", ...k });
  await cdp(wc, "Input.dispatchKeyEvent", { type: "keyUp", ...k });
}

export async function pressEnterKey(wc: WebContents) {
  await cdp(wc, "Input.dispatchKeyEvent", { type: "rawKeyDown", ...KEYS.Enter });
  await cdp(wc, "Input.dispatchKeyEvent", { type: "char", ...KEYS.Enter, text: "\r" });
  await cdp(wc, "Input.dispatchKeyEvent", { type: "keyUp", ...KEYS.Enter });
}

export async function insertLines(wc: WebContents, text: string) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]) await cdp(wc, "Input.insertText", { text: lines[i] });
    if (i < lines.length - 1) await pressEnterKey(wc);
  }
}

export async function visibleNodes(wc: WebContents, nodes: FlatNode[], match: (node: FlatNode, attrs: Map<string, string>) => boolean, minArea = 100) {
  const result: Array<{ node: FlatNode; attrs: Map<string, string>; backendNodeId: number; area: number }> = [];
  for (const node of nodes) {
    const attrs = readAttrs(node);
    if (!match(node, attrs)) continue;
    const box = await nodeBox(wc, { backendNodeId: backendId(node) });
    if (box && box.area > minArea) result.push({ node, attrs, backendNodeId: backendId(node), area: box.area });
  }
  return result.sort((a, b) => b.area - a.area);
}
