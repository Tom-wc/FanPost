import { useEffect, useState } from "react";
import { Button, Image, Space, Tooltip, Upload, message } from "antd";
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  DeleteOutlined,
  InboxOutlined,
  StarFilled,
  VideoCameraOutlined,
} from "@ant-design/icons";
import type { ContentType } from "../../shared/types";

const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;
const VIDEO_EXT = /\.(mp4|mov|mkv|webm)$/i;
export const fileName = (p: string) => p.split(/[\\/]/).pop() || p;

export function useThumbs(paths: string[]) {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  useEffect(() => {
    const missing = paths.filter((p) => IMAGE_EXT.test(p) && thumbs[p] === undefined);
    if (!missing.length) return;
    let alive = true;
    Promise.all(
      missing.map((p) =>
        window.fanpost
          .readThumb(p)
          .then((url) => [p, url] as const)
          .catch(() => [p, ""] as const),
      ),
    ).then((pairs) => {
      if (alive) setThumbs((old) => ({ ...old, ...Object.fromEntries(pairs) }));
    });
    return () => {
      alive = false;
    };
  }, [paths.join("|")]);
  return thumbs;
}

export function MediaPicker({
  type,
  media,
  onChange,
}: {
  type: ContentType;
  media: string[];
  onChange: (next: string[]) => void;
}) {
  const isVideo = type === "video";
  const thumbs = useThumbs(media);
  const accept = (paths: string[]) => {
    const ok = paths.filter((p) => (isVideo ? VIDEO_EXT : IMAGE_EXT).test(p));
    if (ok.length < paths.length)
      message.warning(isVideo ? "只支持 mp4 / mov / mkv / webm 视频" : "只支持 jpg / png / webp 图片");
    if (!ok.length) return;
    if (isVideo) onChange([ok[0]]);
    else onChange(Array.from(new Set([...media, ...ok])));
  };
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= media.length) return;
    const next = [...media];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  return (
    <div className="media-picker">
      <Upload.Dragger
        multiple={!isVideo}
        showUploadList={false}
        openFileDialogOnClick={false}
        beforeUpload={(file, list) => {
          if (file === list[0])
            accept(list.map((f) => window.fanpost.pathForFile(f as unknown as File)).filter(Boolean));
          return Upload.LIST_IGNORE;
        }}
      >
        <div
          className="media-drop"
          onClick={async () =>
            accept(await window.fanpost.pickFiles(isVideo ? "video" : "images"))
          }
        >
          <InboxOutlined className="media-drop-icon" />
          <b>{isVideo ? "拖入视频，或点击选择" : "拖入图片，或点击选择（可多选）"}</b>
          <small>{isVideo ? "mp4 / mov / mkv / webm，单个视频" : "jpg / png / webp，第一张作为首图"}</small>
        </div>
      </Upload.Dragger>
      {media.length > 0 && (
        <Image.PreviewGroup>
          <div className="media-grid">
            {media.map((p, i) => (
              <div className="media-item" key={p}>
                {isVideo ? (
                  <div className="media-video">
                    <VideoCameraOutlined />
                    <span>{fileName(p)}</span>
                  </div>
                ) : thumbs[p] ? (
                  <Image src={thumbs[p]} alt={fileName(p)} />
                ) : (
                  <div className="media-video">{fileName(p)}</div>
                )}
                {!isVideo && i === 0 && (
                  <span className="media-first">
                    <StarFilled /> 首图
                  </span>
                )}
                <Space.Compact className="media-actions" size="small">
                  {!isVideo && (
                    <Tooltip title="前移">
                      <Button icon={<ArrowLeftOutlined />} disabled={i === 0} onClick={() => move(i, -1)} aria-label="前移" />
                    </Tooltip>
                  )}
                  {!isVideo && (
                    <Tooltip title="后移">
                      <Button icon={<ArrowRightOutlined />} disabled={i === media.length - 1} onClick={() => move(i, 1)} aria-label="后移" />
                    </Tooltip>
                  )}
                  <Tooltip title="移除">
                    <Button danger icon={<DeleteOutlined />} onClick={() => onChange(media.filter((x) => x !== p))} aria-label="移除" />
                  </Tooltip>
                </Space.Compact>
              </div>
            ))}
          </div>
        </Image.PreviewGroup>
      )}
    </div>
  );
}
