import type { Platform } from "../../shared/types";
import { platformMap } from "../../shared/platforms";

const logoUrls: Record<Platform, string> = {
  douyin: new URL("./assets/platforms/douyin.png", import.meta.url).href,
  kuaishou: new URL("./assets/platforms/kuaishou.png", import.meta.url).href,
  xiaohongshu: new URL("./assets/platforms/xiaohongshu.png", import.meta.url).href,
  toutiao: new URL("./assets/platforms/toutiao.png", import.meta.url).href,
  weixin: new URL("./assets/platforms/weixin.png", import.meta.url).href,
  bilibili: new URL("./assets/platforms/bilibili.png", import.meta.url).href,
  qqmedia: new URL("./assets/platforms/qqmedia.png", import.meta.url).href,
  zhihu: new URL("./assets/platforms/zhihu.png", import.meta.url).href,
  baijiahao: new URL("./assets/platforms/baijiahao.png", import.meta.url).href,
  weibo: new URL("./assets/platforms/weibo.png", import.meta.url).href,
};

export function PlatformLogo({ platform }: { platform: Platform }) {
  const name = platformMap[platform].name;
  return (
    <i className="platform-logo">
      <img src={logoUrls[platform]} alt={name} title={name} draggable={false} />
    </i>
  );
}
