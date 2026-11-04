import { app } from "electron";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";
import { resolveFfmpegBinary } from "./ffmpeg";
import { detectContentBox } from "./cover-border";

const execFileAsync = promisify(execFile);
const FRAME_POSITIONS = ["0.1", "1"];
let verifiedFfmpegBinary: string | undefined;

async function getFfmpegBinary() {
  if (verifiedFfmpegBinary) return verifiedFfmpegBinary;
  const binary = resolveFfmpegBinary({
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    importedPath: ffmpegStatic,
    envPath: process.env.FFMPEG_PATH,
  });
  try {
    await execFileAsync(binary, ["-version"], { windowsHide: true, timeout: 5000, maxBuffer: 1024 * 1024 });
    verifiedFfmpegBinary = binary;
    return binary;
  } catch (error) {
    throw new Error("FFmpeg 启动失败：" + binary + "；" + (error instanceof Error ? error.message : String(error)));
  }
}

export async function extractVideoCover(videoPath: string) {
  const coverDir = path.join(app.getPath("userData"), "covers");
  await fs.mkdir(coverDir, { recursive: true });
  const output = path.join(coverDir, randomUUID() + ".jpg");
  const input = await fs.stat(videoPath).catch(() => undefined);
  if (!input?.isFile() || input.size <= 0) throw new Error("视频文件不存在或为空：" + videoPath);
  const binary = await getFfmpegBinary();
  let lastError: unknown;
  for (const position of FRAME_POSITIONS) {
    try {
      await execFileAsync(
        binary,
        ["-y", "-ss", position, "-i", videoPath, "-frames:v", "1", "-update", "1", "-vf", "scale=1280:-2", "-q:v", "2", output],
        { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 },
      );
      if ((await fs.stat(output)).size > 0)
        return { path: output, dataUrl: "data:image/jpeg;base64," + (await fs.readFile(output)).toString("base64") };
    } catch (error) {
      lastError = error;
      await fs.rm(output, { force: true }).catch(() => undefined);
    }
  }
  throw new Error("首帧封面提取失败：" + (lastError instanceof Error ? lastError.message : String(lastError)));
}

const PROBE_WIDTH = 160;

async function contentCrop(binary: string, imagePath: string) {
  const { stdout } = await execFileAsync(
    binary,
    ["-loglevel", "error", "-i", imagePath, "-vf", "scale=" + PROBE_WIDTH + ":-2,format=gray", "-frames:v", "1", "-f", "rawvideo", "-"],
    { windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024, encoding: "buffer" },
  );
  const height = stdout.length / PROBE_WIDTH;
  const box = detectContentBox(new Uint8Array(stdout), PROBE_WIDTH, height);
  if (box.w === PROBE_WIDTH && box.h === height) return "";
  const k = "iw/" + PROBE_WIDTH;
  return "crop=" + box.w + "*" + k + ":" + box.h + "*" + k + ":" + box.x + "*" + k + ":" + box.y + "*" + k + ",";
}

export async function fitCover(imagePath: string, width: number, height: number, name: string, fill = false) {
  const dir = path.join(app.getPath("userData"), "task-artifacts");
  await fs.mkdir(dir, { recursive: true });
  const output = path.join(dir, "cover-" + name + ".jpg");
  const binary = await getFfmpegBinary();
  const size = width + ":" + height;
  const trim = fill ? await contentCrop(binary, imagePath).catch(() => "") : "";
  const cropped = trim + "scale=" + size + ":force_original_aspect_ratio=increase,crop=" + size;
  const filter = fill
    ? "[0:v]" + cropped
    : "[0:v]" + cropped + ",boxblur=30:3,eq=brightness=-0.04[bg];" +
    "[0:v]scale=" + size + ":force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2";
  await execFileAsync(binary, ["-y", "-loglevel", "error", "-i", imagePath, "-filter_complex", filter, "-frames:v", "1", "-q:v", "3", output], {
    windowsHide: true,
    timeout: 20000,
    maxBuffer: 1024 * 1024,
  });
  if (!(await fs.stat(output).catch(() => undefined))?.size) throw new Error("封面生成失败");
  return output;
}

export async function videoDurationSec(videoPath: string) {
  const binary = await getFfmpegBinary();
  const output = await execFileAsync(binary, ["-hide_banner", "-i", videoPath], { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 })
    .then((r) => r.stderr)
    .catch((error: { stderr?: string }) => error?.stderr || "");
  const m = String(output).match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : undefined;
}
