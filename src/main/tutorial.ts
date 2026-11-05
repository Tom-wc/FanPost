import { app, ipcMain, net, protocol } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const TUTORIAL_SCHEME = "fpdoc";
const TUTORIAL_FILE = "使用教程.md";
const IMAGE = /^[\w.-]+\.(png|jpe?g|gif|webp)$/i;

const docsDir = () =>
  app.isPackaged ? path.join(process.resourcesPath, "docs") : path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "docs");

export const tutorialPrivileges = { scheme: TUTORIAL_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } };

export function registerTutorial() {
  protocol.handle(TUTORIAL_SCHEME, async (req) => {
    const name = decodeURIComponent(new URL(req.url).pathname.replace(/^\/+/, ""));
    if (!IMAGE.test(name)) return new Response("", { status: 404 });
    const file = path.join(docsDir(), "images", name);
    const stat = await fs.stat(file).catch(() => undefined);
    if (!stat?.isFile()) return new Response("", { status: 404 });
    return net.fetch(pathToFileURL(file).href);
  });
  ipcMain.handle("tutorial:get", () => fs.readFile(path.join(docsDir(), TUTORIAL_FILE), "utf8"));
}
