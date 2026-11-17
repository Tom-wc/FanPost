import { Table, Tag, Alert } from "antd";
import type { ColumnsType } from "antd/es/table";

interface ModelRow {
  key: string;
  vendor: string;
  model: string;
  text: boolean;
  image: boolean;
  video: boolean;
  input: string;
  output: string;
  note: string;
}
const ROWS: ModelRow[] = [
  { key: "ds-flash", vendor: "DeepSeek", model: "deepseek-flash", text: true, image: true, video: false, input: "1（闲时）/ 2（高峰）", output: "4 / 8", note: "性价比最高，日常写作首选；带视觉，能读图" },
  { key: "ds-pro", vendor: "DeepSeek", model: "deepseek-v4-pro", text: true, image: false, video: false, input: "4.5 / 9", output: "13.5 / 27", note: "长文和逻辑更强，贵约 4 倍；不支持图片" },
  { key: "qw-plus", vendor: "阿里百炼", model: "qwen-plus", text: true, image: false, video: false, input: "0.8（≤128K）", output: "2", note: "便宜稳，中文通用写作够用" },
  { key: "qw-max", vendor: "阿里百炼", model: "qwen-max", text: true, image: false, video: false, input: "2.4", output: "9.6", note: "质量更好，适合公众号和长文" },
  { key: "qw-vl", vendor: "阿里百炼", model: "qwen3-vl-plus", text: true, image: true, video: true, input: "1（≤32K）", output: "10", note: "能读图和视频，适合看图写稿、视频转写" },
  { key: "glm53", vendor: "智谱", model: "GLM-5.3", text: true, image: false, video: false, input: "8", output: "28", note: "纯文本，写作能力强但偏贵" },
  { key: "glm53f", vendor: "智谱", model: "GLM-5.3-Flash", text: true, image: true, video: true, input: "0.8", output: "2.8", note: "便宜且能读图和视频，性价比很高" },
  { key: "glm46v", vendor: "智谱", model: "GLM-4.6V", text: true, image: true, video: false, input: "1（≤32K）", output: "3", note: "专门的视觉模型，读图细、便宜" },
  { key: "glm46vf", vendor: "智谱", model: "GLM-4.6V-Flash", text: true, image: true, video: false, input: "免费", output: "免费", note: "官方免费额度模型，适合先试读图" },
  { key: "db-pro", vendor: "豆包", model: "doubao-seed-2.1-pro", text: true, image: true, video: true, input: "6", output: "30", note: "全模态，质量高，价格偏高" },
  { key: "db-lite", vendor: "豆包", model: "doubao-seed-2.1-lite", text: true, image: true, video: true, input: "0.8", output: "2.7", note: "便宜的全模态，能读图/视频，日常够用" },
  { key: "kimi", vendor: "月之暗面", model: "kimi-k3.1-pro", text: true, image: true, video: false, input: "以官网价目为准", output: "以官网价目为准", note: "长上下文，读长文强；具体价格见官网" },
  { key: "claude-haiku", vendor: "Anthropic", model: "claude-haiku-5-5", text: true, image: true, video: false, input: "$0.10（≤100K）", output: "$0.50", note: "国外三家里最便宜的写作模型，能读图；中文略逊于国产模型" },
  { key: "claude-sonnet", vendor: "Anthropic", model: "claude-sonnet-5-5", text: true, image: true, video: false, input: "$2", output: "$10", note: "写作质量和稳定性好，适合重要稿件；能读图，不能读视频" },
  { key: "claude-opus", vendor: "Anthropic", model: "claude-opus-5-5", text: true, image: true, video: false, input: "$4", output: "$20", note: "最强档，长文和复杂改写；按次算约 0.1–0.2 元一篇" },
  { key: "gpt-nano", vendor: "OpenAI", model: "gpt-5-nano", text: true, image: true, video: false, input: "$0.05", output: "$0.40", note: "最便宜的一档，短文案够用" },
  { key: "gpt-mini", vendor: "OpenAI", model: "gpt-5.4-mini", text: true, image: true, video: false, input: "$0.75", output: "$4.50", note: "便宜好用的主力档，能读图" },
  { key: "gpt-main", vendor: "OpenAI", model: "gpt-5.4", text: true, image: true, video: false, input: "$2.50", output: "$15", note: "质量好；长上下文超 272K 价格翻倍" },
  { key: "gemini-lite", vendor: "Google", model: "gemini-2.5-flash-lite", text: true, image: true, video: true, input: "$0.10", output: "$0.40", note: "极便宜，且能读图片和视频（含音频），性价比最高的一档" },
  { key: "gemini-flash", vendor: "Google", model: "gemini-2.5-flash", text: true, image: true, video: true, input: "$0.30", output: "$2.50", note: "能读图片和视频，质量比 lite 好，适合视频转文字找选题" },
  { key: "gemini-pro", vendor: "Google", model: "gemini-2.5-pro", text: true, image: true, video: true, input: "$1.25", output: "$10", note: "全模态高质量档，超过 200K 上下文价格翻倍" },
];

const cols: ColumnsType<ModelRow> = [
  { title: "服务商", dataIndex: "vendor", width: 96 },
  { title: "模型", dataIndex: "model", width: 200, render: (v: string) => <code>{v}</code> },
  {
    title: "能力",
    key: "cap",
    width: 128,
    render: (_, r) => (
      <span className="cap-tags">
        <Tag color={r.text ? "green" : "default"}>文字</Tag>
        <Tag color={r.image ? "blue" : "default"}>{r.image ? "读图" : "不读图"}</Tag>
        <Tag color={r.video ? "purple" : "default"}>{r.video ? "读视频" : "不读视频"}</Tag>
      </span>
    ),
  },
  { title: "输入价", dataIndex: "input", width: 126 },
  { title: "输出价", dataIndex: "output", width: 102 },
  { title: "说明", dataIndex: "note" },
];

export function ModelGuide() {
  return (
    <div className="model-guide">
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="价格单位：国内模型是「元 / 百万 tokens」，国外三家是「美元 / 百万 tokens」，以各家官网为准；软件只调用，不计费、不加价。"
        description="大致换算：一篇 800 字图文约 1200 tokens 输出、提问约 500 tokens。按最便宜一档算，一篇不到 1 分钱（约 $0.001）；贵的一档约 5 分钱。写 100 篇大约 1–5 元。"
      />
      <Table<ModelRow> size="small" pagination={false} rowKey="key" columns={cols} dataSource={ROWS} scroll={{ x: 860 }} className="model-guide-table" />
      <div className="model-guide-notes">
        <h4>怎么选</h4>
        <ul>
          <li><b>只写文字（最省）</b>：国内 DeepSeek <code>deepseek-flash</code>、阿里 <code>qwen-plus</code>；国外 <code>gpt-5-nano</code>、<code>gemini-2.5-flash-lite</code>。</li>
          <li><b>要读图</b>（看别人截图、从图片里找选题）：智谱 <code>GLM-4.6V-Flash</code>（免费）或 <code>GLM-5.3-Flash</code>；国外 Claude 全系、GPT-5 全系、Gemini 全系都能读图。</li>
          <li><b>要读视频</b>（视频转文字、看视频找选题）：豆包 <code>doubao-seed-2.1-lite</code>、智谱 <code>GLM-5.3-Flash</code>、阿里 <code>qwen3-vl-plus</code>；国外只有 Gemini 能读视频（<code>gemini-2.5-flash</code> 最划算），Claude 和 GPT 不支持视频输入。</li>
          <li><b>要写长文/公众号、追究质量</b>：<code>deepseek-v4-pro</code>、<code>qwen-max</code>、<code>claude-sonnet-5-5</code>、<code>gpt-5.4</code>、<code>gemini-2.5-pro</code>。</li>
          <li><b>国内用国外模型</b>：需要能访问对应服务的网络；三者都提供 OpenAI 兼容接口，地址分别是 <code>https://api.anthropic.com/v1</code>（需用 Anthropic 原生格式或兼容网关）、<code>https://api.openai.com/v1</code>、<code>https://generativelanguage.googleapis.com/v1beta/openai</code>。</li>
        </ul>
        <h4>注意</h4>
        <ul>
          <li>标「免费」的是官方限时免费额度，用完按官网价计费。</li>
          <li>本软件当前的「AI 写作」和「热点创作」只用文字能力；读图、读视频的流程后续接入，先把能读图的模型配好不会白配。</li>
          <li>价格经常调整，本表是 2026 年 11 月的数据，下单前请以官网为准。</li>
        </ul>
      </div>
    </div>
  );
}
