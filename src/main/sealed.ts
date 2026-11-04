export const SEALED_PREFIX = "FPENC1:";
const BOM = String.fromCharCode(0xfeff);

export const isSealed = (raw: string) => raw.startsWith(SEALED_PREFIX);

export function sealWith(encrypt: (t: string) => Buffer, text: string) {
  return SEALED_PREFIX + encrypt(text).toString("base64");
}

export function openWith(decrypt: (b: Buffer) => string, raw: string) {
  const text = raw.startsWith(BOM) ? raw.slice(1) : raw;
  if (!isSealed(text)) return text;
  return decrypt(Buffer.from(text.slice(SEALED_PREFIX.length), "base64"));
}
