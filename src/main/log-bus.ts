import { app, safeStorage } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { sealWith } from "./sealed";

export const browserLogPath = () => path.join(app.getPath("logs"), "fanpost-browser.log");

const sealLine = (line: string) => (app.isReady() && safeStorage.isEncryptionAvailable() ? sealWith((t) => safeStorage.encryptString(t), line) : line);

export const writeBrowserLog = async (message: string) => {
  const line = `[${new Date().toISOString()}] ${message}`;
  await fs.appendFile(browserLogPath(), sealLine(line) + "\n").catch(() => undefined);
};

export async function readBrowserLog(maxLines = 2000) {
  const raw = await fs.readFile(browserLogPath(), "utf8").catch(() => "");
  return raw
    .split("\n")
    .filter(Boolean)
    .slice(-maxLines)
    .map((l) => {
      try {
        return l.startsWith("FPENC1:") ? safeStorage.decryptString(Buffer.from(l.slice(7), "base64")) : l;
      } catch {
        return "[无法解密]";
      }
    })
    .join("\n");
}

export async function sealOldLog() {
  if (!safeStorage.isEncryptionAvailable()) return;
  const file = browserLogPath();
  const raw = await fs.readFile(file, "utf8").catch(() => "");
  if (!raw || !raw.split("\n").some((l) => l && !l.startsWith("FPENC1:"))) return;
  const sealed = raw.split("\n").filter(Boolean).map((l) => (l.startsWith("FPENC1:") ? l : sealWith((t) => safeStorage.encryptString(t), l))).join("\n") + "\n";
  await fs.writeFile(file + ".tmp", sealed, "utf8");
  await fs.rename(file + ".tmp", file);
}
