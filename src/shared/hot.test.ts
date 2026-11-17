import test from "node:test";
import assert from "node:assert/strict";
import { matrixSimilarity, parseGenerated, parseHotList, parseProfile, scoreTopics, topicRisk, type HotItem } from "./hot.ts";

test("parses weibo style hot list and dedupes titles", () => {
  const items = parseHotList("weibo", { data: [{ title: "A 话题", hot_value: 100, link: "https://s.weibo.com/a" }, { title: "A 话题", hot_value: 90 }, { title: "", hot_value: 1 }] });
  assert.equal(items.length, 1);
  assert.deepEqual(items[0], { id: "weibo:A 话题", source: "weibo", title: "A 话题", url: "https://s.weibo.com/a", heat: 100, rank: 1 });
});

test("parses zhihu heat text with 万 unit and builds question url", () => {
  const items = parseHotList("zhihu", { data: [{ target: { id: 123, title: "问题" }, detail_text: "885 万热度" }] });
  assert.equal(items[0].heat, 8850000);
  assert.equal(items[0].url, "https://www.zhihu.com/question/123");
});

test("parses toutiao, bilibili and baidu shapes", () => {
  assert.equal(parseHotList("toutiao", { data: [{ Title: "头条", HotValue: "23700919", Url: "https://www.toutiao.com/x" }] })[0].heat, 23700919);
  assert.equal(parseHotList("bilibili", { data: { trending: { list: [{ keyword: "k", show_name: "B站热搜" }] } } })[0].title, "B站热搜");
  const baidu = parseHotList("baidu", { data: { cards: [{ content: [{ content: [{ word: "置顶", isTop: true }, { word: "百度热点", hotScore: "500", url: "https://m.baidu.com/s" }] }] }] } });
  assert.deepEqual(baidu.map((x) => x.title), ["百度热点"]);
});

test("returns empty list on unexpected body", () => {
  assert.deepEqual(parseHotList("weibo", "oops"), []);
  assert.deepEqual(parseHotList("baidu", { data: {} }), []);
});

test("rejects javascript urls", () => {
  assert.equal(parseHotList("weibo", { data: [{ title: "x", link: "javascript:alert(1)" }] })[0].url, "");
});

test("flags sensitive topics", () => {
  assert.equal(topicRisk("习近平将同普京特朗普会晤"), "时政/涉领土话题");
  assert.equal(topicRisk("某地发生地震"), "灾难伤亡话题");
  assert.equal(topicRisk("这款面霜能根治痘痘"), "医疗健康话题");
  assert.equal(topicRisk("白血病砒霜口服药康复患者发声"), "医疗健康话题");
  assert.equal(topicRisk("亚太伙伴齐聚深圳"), "时政/涉领土话题");
  assert.equal(topicRisk("国乒34岁方博夺冠"), undefined);
});

const item = (title: string, heat: number, rank: number): HotItem => ({ id: title, source: "weibo", title, url: "", heat, rank });

test("scores topics by niche match first and zeroes risky ones", () => {
  const list = [item("明星离婚", 9e6, 1), item("秋季护肤误区", 2e5, 20), item("某地火灾", 8e6, 2)];
  const scored = scoreTopics(list, { niche: "护肤", keywords: ["护肤", "美妆"], avoid: [] });
  assert.equal(scored[0].title, "秋季护肤误区");
  assert.deepEqual(scored[0].match, ["护肤"]);
  const fire = scored.find((x) => x.title === "某地火灾")!;
  assert.equal(fire.score, 0);
  assert.equal(fire.risk, "灾难伤亡话题");
});

test("uses avoid words from profile", () => {
  const scored = scoreTopics([item("某品牌翻车", 100, 1)], { niche: "", keywords: [], avoid: ["品牌"] });
  assert.equal(scored[0].risk, "命中账号禁区词");
});

test("without profile ranks by heat and position", () => {
  const scored = scoreTopics([item("低", 10, 30), item("高", 1e6, 1)], undefined);
  assert.equal(scored[0].title, "高");
});

test("matrix similarity flags near duplicate drafts only", () => {
  const a = "今天想和大家聊聊秋天护肤最容易踩的三个坑，第一个就是频繁去角质，很多人觉得越搓越干净";
  const b = "今天想和大家聊聊秋天护肤最容易踩的三个坑，第一个就是频繁去角质，很多人以为越搓越干净";
  const c = "健身新手最常见的错误是一上来就练大重量，结果关节受伤，建议先把动作练标准再加重量";
  const pairs = matrixSimilarity([a, b, c]);
  assert.equal(pairs.length, 1);
  assert.deepEqual([pairs[0].a, pairs[0].b], [0, 1]);
});

test("parses generated json even when wrapped in fences", () => {
  const out = parseGenerated('```json\n{"title":"标题","body":"正文内容","topics":["#护肤","秋天"]}\n```');
  assert.deepEqual(out, { title: "标题", description: "正文内容", topics: ["护肤", "秋天"] });
  assert.equal(parseGenerated("不是 json"), undefined);
  assert.equal(parseGenerated('{"title":"只有标题"}'), undefined);
});

test("profile parsing trims and splits keywords", () => {
  const p = parseProfile({ accountId: "a1", niche: "护肤", keywords: "护肤，美妆 、 护肤", avoid: [] })!;
  assert.deepEqual(p.keywords, ["护肤", "美妆"]);
  assert.equal(parseProfile({ niche: "x" }), undefined);
});

test("flags diplomacy and market index topics", () => {
  assert.equal(topicRisk("广东开启APEC时间"), "时政/涉领土话题");
  assert.equal(topicRisk("沪指跌破3600点"), "金融投资话题");
  assert.equal(topicRisk("吃商极高的人都爱路边饭"), undefined);
});

test("cloud hot topic rules replace built-ins and fall back when empty", async () => {
  const { setHotTopicRules } = await import("./hot.ts");
  setHotTopicRules([{ pattern: "羽绒服", label: "测试话题" }]);
  assert.equal(topicRisk("北大399元羽绒服火出圈"), "测试话题");
  assert.equal(topicRisk("某地发生地震"), undefined);
  setHotTopicRules([{ pattern: "(", label: "坏正则" }]);
  assert.equal(topicRisk("某地发生地震"), "灾难伤亡话题");
  setHotTopicRules(undefined);
  assert.equal(topicRisk("北大399元羽绒服火出圈"), undefined);
});

test("splits body into short card points", async () => {
  const { splitPoints } = await import("./hot.ts");
  const body = "结论前置：选工具要算全成本。1.先算全成本：识别、查验都算进去。2.看计费颗粒度，按张还是按次。\n\n3️⃣ 重要信息交叉验证。价格政策要核对。\n短\n- 隐私别随手发，身份证、住址不要直接丢进去";
  const points = splitPoints(body);
  assert.ok(points.length >= 4 && points.length <= 5, String(points.length));
  assert.ok(points.every((p) => Array.from(p).length <= 42));
  assert.ok(points.includes("先算全成本"));
  assert.ok(!points.some((p) => p === "短"));
});

test("slideshow args chain fades with correct offsets and duration", async () => {
  const { slideshowArgs } = await import("./hot.ts");
  const args = slideshowArgs(["a.jpg", "b.jpg", "c.jpg"], "out.mp4", { width: 1080, height: 1920, seconds: 4 });
  const graph = args[args.indexOf("-filter_complex") + 1];
  assert.match(graph, /\[v0\]\[v1\]xfade=transition=fade:duration=0\.5:offset=3\.50\[x1\]/);
  assert.match(graph, /\[x1\]\[v2\]xfade=transition=fade:duration=0\.5:offset=7\.00\[vout\]/);
  assert.equal(args[args.indexOf("-t", args.indexOf("-map")) + 1], "11.00");
  assert.equal(args.at(-1), "out.mp4");
  const one = slideshowArgs(["a.jpg"], "o.mp4", { width: 1080, height: 1920, seconds: 4 });
  assert.ok(one.includes("[v0]"));
});

test("flags macro economy and investigation topics", () => {
  assert.equal(topicRisk("10月国民经济运行总体平稳向新向优"), "金融投资话题");
  assert.equal(topicRisk("央视曝光后金华连夜成立调查组"), "司法/反腐话题");
  assert.equal(topicRisk("煮茶叶蛋时为什么不剥皮"), undefined);
});

test("zhihu keeps big question ids exact via card_id and big-id parsing", async () => {
  const { parseBigIdJson } = await import("./hot.ts");
  const text = '{"data":[{"card_id":"Q_2105681388028392901","target":{"id":2105681388028392901,"title":"问题"},"detail_text":"10 万热度"}]}';
  const items = parseHotList("zhihu", parseBigIdJson(text));
  assert.equal(items[0].url, "https://www.zhihu.com/question/2105681388028392901");
  const noCard = parseHotList("zhihu", parseBigIdJson('{"data":[{"target":{"id":2105681388028392901,"title":"问题2"}}]}'));
  assert.equal(noCard[0].url, "https://www.zhihu.com/question/2105681388028392901");
});

test("baidu items without hotScore get rank-based heat instead of zero", () => {
  const items = parseHotList("baidu", { data: { cards: [{ content: [{ content: [{ word: "第一" }, { word: "第二" }, { word: "第三" }] }] }] } });
  assert.ok(items[0].heat > items[1].heat && items[1].heat > items[2].heat && items[2].heat > 0);
});
