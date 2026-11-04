import { safeStorage } from "electron";
import { promises as fs } from "node:fs";
import { SEALED_PREFIX, isSealed, openWith, sealWith } from "./sealed";

export { SEALED_PREFIX, isSealed };

export function osCodec() {
  return {
    seal: (text: string) => (safeStorage.isEncryptionAvailable() ? sealWith((t) => safeStorage.encryptString(t), text) : text),
    open: (raw: string) => openWith((b) => safeStorage.decryptString(b), raw),
    sealed: (raw: string) => isSealed(raw) || !safeStorage.isEncryptionAvailable(),
  };
}

export async function readSealed(file: string) {
  const raw = await fs.readFile(file, "utf8").catch(() => "");
  return raw ? osCodec().open(raw) : "";
}

export async function writeSealed(file: string, text: string) {
  await fs.writeFile(file, osCodec().seal(text), "utf8");
}
