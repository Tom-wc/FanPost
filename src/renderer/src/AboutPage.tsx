import { useState } from "react";
import { Button, Image, Typography, message } from "antd";
import { publishAppInfo, useAppInfo, PromoSlotView } from "./Promo";
import { openTutorial } from "./Tutorial";
import { TUTORIAL_SECTIONS, type TutorialTopic } from "../../shared/tutorial";

const GUIDE: TutorialTopic[] = ["start", "accounts", "compose", "launch", "records", "mp", "settings", "license", "safety", "verify", "lookup", "faq"];

const supportQr = new URL("./assets/support-qr.png", import.meta.url).href;
const brandUrl = new URL("./assets/brand.png", import.meta.url).href;

const FEATURES = [
  "一份图文或视频，一键填写到抖音、快手、小红书、头条号、视频号、哔哩哔哩、企鹅号、知乎、百家号、微博 10 个平台的官方创作者后台。",
  "公众号单独入口：按原排版采集文章、富文本编辑、通过官方接口存草稿或一键复制。",
  "导入图文：表格批量、图片文件夹批量、网页取图文、Word / PPT / Markdown / PDF 文档。",
  "多账号管理：每个账号独立登录、互不串号，自动巡检登录状态，掉线及时提醒。",
  "安全把控：敏感词检查、每个账号每天的发布次数、采集内容照搬比例检查。",
];

const DISCLAIMER = [
  "本软件是本地运行的辅助填写工具，只在你的电脑上把你自己准备好的内容填写到各平台的官方页面。账号在各平台官方页面扫码登录，登录信息只保存在本机，不上传任何服务器。",
  "通过本软件发布的所有内容由使用者本人负责，请遵守各平台的规则以及《网络安全法》《著作权法》等法律法规。采集、转载他人内容前请确认已获得授权；因内容侵权、违规、平台风控、限流或封号造成的任何损失，由使用者自行承担。",
  "各平台随时可能改版，改版后部分自动填写可能暂时失效，我们会尽快更新修复，但不保证任何时刻都能完整使用。",
  "联网只用于验证授权、下载安全规则和平台脚本、检查新版本，只发送卡密编号、本机机器码和软件版本号，不收集你的内容和账号信息。",
  "公众号的 AppID 和 AppSecret 加密保存在本机，只用于调用微信官方接口。",
  "本软件不提供任何绕过平台限制、刷量、批量注册等功能，也不支持将本软件用于违法用途。",
];

export function AboutPage() {
  const info = useAppInfo();
  const [checking, setChecking] = useState(false);
  const check = async () => {
    setChecking(true);
    try {
      const v = await window.fanpost.getAppInfo(true);
      publishAppInfo(v);
      message[v.hasUpdate ? "info" : "success"](v.hasUpdate ? "有新版本 " + v.latestVersion : v.latestVersion ? "已是最新版本" : "暂时查不到新版本信息");
    } catch (error) {
      message.error("检查失败：" + (error instanceof Error ? error.message : String(error)));
    } finally {
      setChecking(false);
    }
  };
  const download = () => window.fanpost.openAppLink("downloadUrl").catch((e) => message.error(String(e instanceof Error ? e.message : e)));
  return (
    <div className="about-page">
      <div className="about-main">
        <section className="panel about-hero">
          <img src={brandUrl} alt="浪叉" />
          <div>
            <h2>浪叉多平台发布助手</h2>
            <p className="muted">一次填写，11 个平台同步就绪</p>
            <div className="about-version">
              <span className="num">版本 {info?.version ?? ""}</span>
              {info?.hasUpdate ? <span className="about-new">有新版本 {info.latestVersion}</span> : info?.latestVersion ? <span className="muted">已是最新</span> : null}
              <Button size="small" loading={checking} onClick={() => void check()}>检查更新</Button>
            </div>
          </div>
        </section>
        {info?.hasUpdate && (
          <section className="panel about-update">
            <h3>新版本 {info.latestVersion}</h3>
            {info.releaseNotes ? <ul>{info.releaseNotes.split("\n").filter((l) => l.trim()).map((l) => <li key={l}>{l}</li>)}</ul> : <p className="muted">修复和改进。</p>}
            <p className="muted">永久卡和有效期内的年卡都免费更新。下载后直接覆盖安装，账号、草稿和授权都会保留。</p>
            {info.downloadUrl ? (
              <span className="about-dl">
                <Button type="primary" onClick={() => void download()}>去网盘下载</Button>
                {info.downloadCode && <Typography.Text copyable={{ text: info.downloadCode }}>提取码 {info.downloadCode}</Typography.Text>}
              </span>
            ) : (
              <p>下载链接见卖家发的网盘，或扫右侧二维码联系我们。</p>
            )}
          </section>
        )}
        <section className="panel about-text">
          <h3>软件说明</h3>
          <ol>{FEATURES.map((t) => <li key={t}>{t}</li>)}</ol>
        </section>
        <section className="panel about-text about-guide">
          <h3>使用教程 <Button size="small" type="primary" onClick={() => openTutorial()}>打开完整教程</Button></h3>
          <div className="guide-grid">{GUIDE.map((t) => <button key={t} onClick={() => openTutorial(t)}>{TUTORIAL_SECTIONS[t]}</button>)}</div>
          <p className="muted">各功能页标题旁的「本页教程」和问号图标，会直接打开对应章节。</p>
        </section>
        <section className="panel about-text">
          <h3>免责声明</h3>
          <ol>{DISCLAIMER.map((t) => <li key={t}>{t}</li>)}</ol>
        </section>
      </div>
      <aside className="about-side">
        <section className="panel about-links">
          <h3>友情链接</h3>
          <PromoSlotView slot="about" />
        </section>
        <section className="panel about-qr">
          <Image src={supportQr} width={150} height={150} alt="售后二维码" preview={{ mask: "放大" }} />
          <b>售后 / 问题反馈</b>
          <small className="muted">反馈时请附上出问题的平台、图文还是视频、发布记录卡片上的提示文字或截图。</small>
        </section>
      </aside>
    </div>
  );
}
