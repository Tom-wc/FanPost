export const FP_SCHEME = "fpimg";
const PREFIX = FP_SCHEME + "://local/";

export type MpImageKind = "body" | "preview";

export const localSrc = (filePath: string) => PREFIX + encodeURIComponent(filePath);

export function pathFromSrc(src: string) {
  if (!src.startsWith(PREFIX)) return "";
  try {
    return decodeURIComponent(src.slice(PREFIX.length).replace(/\/$/, ""));
  } catch {
    return "";
  }
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const PARA_STYLE = "margin:0 0 12px;font-size:16px;line-height:1.8";
export const IMAGE_BOX_STYLE = "text-align:center;margin:0 0 12px";
export const IMAGE_STYLE = "max-width:100%;height:auto";

export function htmlFromText(text: string, images: string[]) {
  const paras = text.split("\n").filter((l) => l.trim()).map((l) => '<p style="' + PARA_STYLE + '">' + escape(l.trim()) + "</p>");
  const imgs = images.map((p) => '<p style="' + IMAGE_BOX_STYLE + '"><img src="' + escape(localSrc(p)) + '" data-fp-kind="body" style="' + IMAGE_STYLE + '"></p>');
  return [...paras, ...imgs].join("");
}

export const imageTag = (filePath: string, kind: MpImageKind = "body") =>
  '<p style="' + IMAGE_BOX_STYLE + '"><img src="' + escape(localSrc(filePath)) + '" data-fp-kind="' + kind + '" style="' + IMAGE_STYLE + '"></p>';
