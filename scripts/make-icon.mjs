// 从源 logo 生成应用图标：放大到 256x256 的透明底 PNG，并转成 Windows .ico。
// electron-builder 要求图标至少 256x256，源图是 200x200，这里居中缩放补透明边。
import { Jimp } from "jimp";
import pngToIco from "png-to-ico";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = process.argv[2] || process.env.ICON_SRC;
if (!SRC) {
  console.error("用法：npm run icon -- <源图片.png>");
  process.exit(1);
}
const OUT_PNG = path.join(root, "build", "icon.png");
const OUT_ICO = path.join(root, "build", "icon.ico");
const SIZE = 256;

const src = await Jimp.read(SRC);
// 居中放进 256x256 透明画布，保持比例、不裁剪
const scale = Math.min(SIZE / src.bitmap.width, SIZE / src.bitmap.height);
const w = Math.round(src.bitmap.width * scale);
const h = Math.round(src.bitmap.height * scale);
src.resize({ w, h });
const canvas = new Jimp({ width: SIZE, height: SIZE, color: 0x00000000 });
canvas.composite(src, Math.round((SIZE - w) / 2), Math.round((SIZE - h) / 2));
await canvas.write(OUT_PNG);
await fs.writeFile(OUT_ICO, await pngToIco(OUT_PNG));
console.log("icon generated:", OUT_PNG, OUT_ICO);
