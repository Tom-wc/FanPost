import { useState } from "react";
import { Button, Image, Typography, message } from "antd";
import { publishAppInfo, useAppInfo, PromoSlotView } from "./Promo";
import { openTutorial } from "./Tutorial";
import { TUTORIAL_SECTIONS, type TutorialTopic } from "../../shared/tutorial";

const GUIDE: TutorialTopic[] = ["start", "accounts", "compose", "launch", "schedule", "records", "mp", "growth", "hot", "ai", "settings", "addons", "license", "safety", "verify", "lookup", "faq", "disclaimer"];

const supportQr = new URL("./assets/support-qr.png", import.meta.url).href;
const brandUrl = new URL("./assets/brand.png", import.meta.url).href;

const FEATURES = [
  "一份图文或视频，一键填写到抖音、快手、小红书、头条号、视频号、哔哩哔哩、企鹅号、知乎、百家号、微博 10 个平台的官方创作者后台，支持定时发布。",
  "公众号单独入口：按原排版采集文章、富文本编辑、通过官方接口存草稿或一键复制。",
  "导入图文：表格批量、图片文件夹批量、网页取图文、Word / PPT / Markdown / PDF 文档。",
  "多账号管理：每个账号独立登录、互不串号，自动巡检登录状态，掉线及时提醒。",
  "增长工具：评论 · 私信工作台统一回复粉丝；热点创作插件按账号赛道选题、AI 分账号写稿并自动配图。",
  "安全把控：敏感词检查、每个账号每天的发布次数、采集内容照搬比例、多账号内容重复度检查，AI 内容强制标注。",
];

const DISCLAIMER = [
  "本软件是本地运行的辅助填写和发布工具，只在你登录的各平台官方页面替你完成填写、点击等操作。账号在各平台官方页面扫码登录，登录信息只保存在本机，不上传任何服务器。",
  "通过本软件发布的所有内容（包括 AI 生成、改写的内容）由使用者本人负责，请遵守《网络安全法》《著作权法》《广告法》《人工智能生成合成内容标识办法》及各平台规则。因内容违规、侵权、虚假、未标识 AI 造成的限流、封号、处罚或纠纷，由使用者自行承担。",
  "AI 输出可能有事实错误或与他人内容相似。软件提供照搬比例、敏感词、矩阵重复度检查并强制添加 AI 声明，但不保证完全准确，发布前请本人逐篇审核。",
  "热点数据来自各平台公开榜单，只读取标题、热度和链接，不抓取、不搬运他人正文和图片视频；敏感话题过滤是辅助措施，不能代替你自己的判断。",
  "AI 模型、图片、配音、视频等第三方服务由你自行选择和付费，服务结果、计费和数据处理以服务商协议为准。你的 API Key 加密保存在本机，只用于直接调用你填写的服务商。",
  "各平台随时可能改版，改版后部分自动填写可能暂时失效，我们会尽快更新修复，但不保证任何时刻都能完整使用。多账号、定时、自动回复等功能频率过高可能触发平台风控，风险由使用者承担。",
  "联网只用于验证授权、下载安全规则和平台脚本、检查新版本、读取公开热榜，只发送卡密编号、本机机器码和软件版本号，不收集你的内容和账号信息。",
  "本软件不提供任何绕过平台限制、刷量、批量注册、冒充他人、编造新闻等功能，发现此类用途的有权停止授权且不退款。在法律允许范围内，因使用本软件造成的间接损失我们不承担责任，赔偿以实际支付金额为限。",
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
