const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/content.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../manifest.json"), "utf8"));
assert.ok(manifest.content_scripts.some(entry => entry.world === "MAIN" && entry.js.includes("src/native-renderer.js")), "原站渲染桥必须运行在页面上下文");
let now = 1_000_000;
let focused = true;
let loggedIn = true;
let visiblePosts = [1];
let token = "test-csrf";
const requests = [];
const timers = new Map();
const rendered = [];
const document = {
  hidden: false, hasFocus: () => focused,
  body: { classList: { contains: () => true } },
  querySelectorAll: () => [],
  querySelector: (selector) => selector.includes(".pswp--open") ? null : selector === "#current-user" ? (loggedIn ? {} : null) : { getAttribute: () => token }
};
const context = {
  window: { innerWidth: 1440, innerHeight: 900 }, document,
  location: { href: "https://linux.do/latest", origin: "https://linux.do" },
  URL, URLSearchParams, AbortController,
  Date: class extends Date { static now() { return now; } },
  performance: { now: () => now },
  setTimeout: (fn, delay) => { const id = timers.size + 1; timers.set(id, { fn, delay }); return id; },
  clearTimeout: (id) => timers.delete(id),
  localStorage: { getItem: () => null },
  fetch: (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })),
  visible: () => new Set(visiblePosts),
  rendered
};
vm.runInNewContext(source.replace(/^  init\(\);$/m, `
  getTopicUrlFromLink = link => link.url;
  getVisibleReadingPosts = () => globalThis.visible();
  closeImagePreview = cancelLoadMoreRequest = cancelDirectRepliesRequest = syncLatestRepliesRefreshUI = () => {};
  renderTopic = (...args) => globalThis.rendered.push(args);
  showToast = syncCfChallengeNotice = () => {};
  globalThis.test = { state, runTopicPrefetch, loadTopic, getCachedTopic, getTopicCacheKey, restoreCachedTopic,
    startReading, tickReading, stopReading, flushReading, trackCurrentTopicVisit, isCfChallengeResponse, fetchPreviewResponse };
`), context);
const api = context.test;
const state = api.state;
state.root = { classList: { contains: () => false } };
const topic = (id, numbers = [1, 2]) => ({ id, posts_count: numbers.length,
  post_stream: { posts: numbers.map(n => ({ id: id * 1000 + n, post_number: n })), stream: numbers.map(n => id * 1000 + n) } });
const reply = (request, data, status = 200) => request.resolve({ ok: status === 200, status,
  headers: { get: () => "application/json" }, json: async () => data });
const settle = () => new Promise(setImmediate);
const link = (id) => ({ isConnected: true, url: `https://linux.do/t/${id}`,
  getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 20, width: 100, height: 20 }) });

async function main() {
  [1, 2, 3, 4].forEach(id => state.prefetchVisible.add(link(id)));
  api.runTopicPrefetch();
  api.runTopicPrefetch();
  now += 499;
  api.runTopicPrefetch();
  assert.equal(requests.length, 1, "500ms 内不能启动第二个请求");
  now++;
  api.runTopicPrefetch();
  assert.equal(requests.length, 2);
  now += 500;
  api.runTopicPrefetch();
  assert.equal(requests.length, 2, "并发不能超过 2");
  for (const [i, request] of requests.entries()) {
    assert.ok(!request.url.includes("track_visit"));
    assert.equal(request.options.headers["Discourse-Track-View"], undefined);
    assert.equal(request.options.credentials, "include");
    reply(request, topic(i + 1));
  }
  await settle();
  assert.equal(state.prefetchRequests.size, 0);
  assert.equal(api.getCachedTopic("https://linux.do/t/slug/1/2").topic.id, 1);
  assert.equal(api.getCachedTopic("https://linux.do/t/1").currentViewTracked, false);
  document.hidden = true;
  api.runTopicPrefetch();
  assert.equal(requests.length, 2, "后台不预取");
  document.hidden = false;
  state.settings.previewMode = "iframe";
  api.runTopicPrefetch();
  assert.equal(requests.length, 2, "整页模式不预取");
  state.settings.previewMode = "auto";
  state.prefetchVisible.clear();
  api.runTopicPrefetch();
  assert.equal(requests.length, 2, "离开视口的排队任务不请求");

  state.prefetchVisible.add(link(10));
  api.runTopicPrefetch();
  state.currentUrl = "https://linux.do/t/10";
  state.currentTopicTrackingKey = "topic:10";
  const loading = api.loadTopic(state.currentUrl, "测试", 10);
  assert.equal(requests.length, 3, "点击复用未完成的预取");
  reply(requests[2], topic(10));
  await loading;
  assert.equal(rendered.at(-1)[0].id, 10);
  assert.equal(requests.length, 3, "复用正文无第二次请求");
  state.currentTopic = topic(10);
  api.trackCurrentTopicVisit();
  api.trackCurrentTopicVisit();
  assert.equal(requests.length, 4, "真正打开后单独上报一次访问");
  assert.ok(requests[3].url.includes("track_visit=true"));
  reply(requests[3], topic(10));
  await settle();

  const partial = { topic: topic(20, [1, 2]), fetchedAt: now, views: new Map() };
  partial.topic.posts_count = 80;
  assert.equal(api.restoreCachedTopic(partial, "https://linux.do/t/20/80", "测试", 20), false);
  state.currentUrl = "https://linux.do/t/20/80";
  state.currentViewTracked = true;
  const targeted = api.loadTopic(state.currentUrl, "测试", 20, { cachedTopic: partial });
  assert.ok(requests.at(-1).url.endsWith("/20/80.json"), "缺少目标楼层时只补目标数据");
  reply(requests.at(-1), topic(20, [80]));
  await targeted;
  assert.equal(rendered.at(-1)[3], 80);

  now += 1000;
  state.prefetchVisible.clear();
  state.prefetchVisible.add(link(50));
  api.runTopicPrefetch();
  state.currentUrl = "https://linux.do/t/50";
  const beforeCancel = rendered.length;
  const canceled = api.loadTopic(state.currentUrl, "测试", 50);
  state.abortController.abort();
  state.currentUrl = "https://linux.do/t/51";
  reply(requests.at(-1), topic(50));
  await canceled;
  assert.equal(rendered.length, beforeCancel, "取消后旧预取不能覆盖新主题");
  now += 1000;
  state.prefetchVisible.clear();
  state.prefetchVisible.add(link(60));
  api.runTopicPrefetch();
  state.currentUrl = "https://linux.do/t/60";
  const fallback = api.loadTopic(state.currentUrl, "测试", 60);
  requests.at(-1).reject(new Error("测试预取失败"));
  await settle();
  assert.ok(requests.at(-1).url.endsWith("/60.json"), "预取失败后点击正常重试");
  reply(requests.at(-1), topic(60));
  await fallback;
  assert.equal(rendered.at(-1)[0].id, 60);
  state.prefetchVisible.add(link(61));
  const beforeCooldown = requests.length;
  now += 500;
  api.runTopicPrefetch();
  assert.equal(requests.length, beforeCooldown, "预取失败后暂停自动请求");

  state.currentTopic = topic(30);
  api.startReading();
  now += 1000; api.tickReading();
  assert.equal(state.reading.timings.size, 0, "初次采样不立即算已读");
  now += 1000; api.tickReading();
  assert.equal(state.reading.timings.get(1), 1000);
  focused = false;
  now += 1000; api.tickReading();
  assert.equal(state.reading.timings.get(1), 1000, "失焦不计时");
  focused = true;
  document.hidden = true;
  now += 1000; api.tickReading();
  document.hidden = false;
  state.settingsPanel = { hidden: false };
  now += 1000; api.tickReading();
  state.settingsPanel.hidden = true;
  assert.equal(state.reading.timings.get(1), 1000, "后台及遮挡不计时");
  const beforeRead = requests.length;
  const flushing = api.flushReading(state.reading);
  const report = requests.at(-1);
  assert.equal(requests.length, beforeRead + 1);
  assert.equal(report.url, "https://linux.do/topics/timings");
  assert.equal(report.options.body.get("topic_id"), "30");
  assert.equal(report.options.body.get("timings[1]"), "1000");
  assert.equal(report.options.body.has("timings[2]"), false, "不为未看见的回复上报");
  assert.equal(report.options.body.get("topic_time"), "1000");
  assert.equal(report.options.headers["X-CSRF-Token"], token);
  assert.equal(report.options.keepalive, true);
  state.reading.timings.set(2, 250);
  state.reading.topicTime = 250;
  document.hidden = true;
  await api.flushReading(state.reading);
  reply(report, {}); await flushing;
  await settle();
  assert.equal(requests.at(-1).options.body.get("timings[2]"), "250", "后台时等待在途请求完成再提交剩余批次");
  reply(requests.at(-1), {}); await settle();
  document.hidden = false;
  state.reading.timings.set(2, 700);
  state.reading.topicTime = 700;
  api.stopReading();
  assert.equal(state.reading, null);
  assert.equal(requests.at(-1).options.body.get("timings[2]"), "700", "关闭提交剩余时间");
  reply(requests.at(-1), {}); await settle();

  api.startReading();
  loggedIn = false;
  now += 1000; api.tickReading();
  now += 1000; api.tickReading();
  assert.equal(state.reading.timings.size, 0, "游客不计时");
  loggedIn = true;
  now += 180001; api.tickReading();
  assert.equal(state.reading.timings.size, 0, "长时间无操作不计时");
  state.reading.timings.set(1, 1000);
  token = "new-session";
  const beforeSessionChange = requests.length;
  await api.flushReading(state.reading);
  assert.equal(requests.length, beforeSessionChange, "不把旧会话阅读发给新会话");
  assert.equal(state.reading.timings.size, 0);
  api.stopReading();
  api.startReading();
  state.reading.timings.set(1, 900);
  state.reading.topicTime = 900;
  const failed = api.flushReading(state.reading);
  requests.at(-1).reject(new Error("测试上报网络异常"));
  await failed;
  const beforeRetry = requests.length;
  await api.flushReading(state.reading);
  assert.equal(requests.length, beforeRetry, "结果不明的批次不重复累计");
  state.reading.timings.set(2, 700);
  state.reading.topicTime = 700;
  await api.flushReading(state.reading);
  assert.equal(requests.length, beforeRetry, "失败后降频");
  now += 30001;
  const recovered = api.flushReading(state.reading);
  assert.equal(requests.at(-1).options.body.has("timings[1]"), false);
  assert.equal(requests.at(-1).options.body.get("timings[2]"), "700");
  reply(requests.at(-1), {}); await recovered;
  const challengeHtml = '<script>window._cf_chl_opt = {};</script><script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script>';
  for (const status of [200, 403, 429, 503]) {
    assert.equal(await api.isCfChallengeResponse(new Response("challenge", { status, headers: { "cf-mitigated": "challenge" } })), true);
    const response = new Response(challengeHtml, { status, headers: { "content-type": "text/html" } });
    assert.equal(await api.isCfChallengeResponse(response), true, "无标志头时识别完整挑战页面");
    assert.equal(await response.text(), challengeHtml, "识别不能消耗调用方的响应体");
  }
  for (const [body, type, status] of [
    ['{"errors":["无权访问"]}', "application/json", 403],
    ["Cloudflare: Access denied", "text/html", 403],
    ["Too many requests", "text/html", 429],
    ["Service unavailable", "text/html", 503],
    [JSON.stringify({ cooked: challengeHtml }), "application/json", 200],
    ['<script src="/cdn-cgi/challenge-platform/test"></script>', "text/html", 403]
  ]) assert.equal(await api.isCfChallengeResponse(new Response(body, { status, headers: { "content-type": type } })), false, "业务错误、限流及正文不误判");

  const staleController = new AbortController();
  const staleRequest = api.fetchPreviewResponse("/t/1.json", { signal: staleController.signal });
  const staleRejected = assert.rejects(staleRequest, { name: "AbortError" });
  staleController.abort();
  requests.at(-1).resolve(new Response("", { status: 403, headers: { "cf-mitigated": "challenge" } }));
  await staleRejected;
  assert.equal(state.cfChallenge, false, "切帖后旧响应不能暂停新页面");

  const pendingPrefetch = new AbortController();
  state.prefetchRequests.set("cf-pending", { controller: pendingPrefetch });
  state.abortController = new AbortController();
  const pendingTopic = state.abortController;
  const challenge = api.fetchPreviewResponse("/t/1.json", {});
  const rejected = assert.rejects(challenge, /验证尚未通过/);
  requests.at(-1).resolve(new Response("", { status: 403, headers: { "cf-mitigated": "challenge" } }));
  await rejected;
  assert.equal(state.cfChallenge, true);
  assert.equal(pendingPrefetch.signal.aborted, true, "遇盾取消在途预取");
  assert.equal(pendingTopic.signal.aborted, true, "遇盾取消在途主题读取");
  state.prefetchRequests.delete("cf-pending");
  const pausedCount = requests.length;
  now += 120000;
  api.runTopicPrefetch();
  await assert.rejects(api.fetchPreviewResponse("/posts/101/replies", {}), /请先完成网站验证/);
  assert.equal(requests.length, pausedCount, "暂停不会因普通冷却到期解除，也不发送楼层读取");
  state.cfRetryController = new AbortController();
  const probe = api.fetchPreviewResponse("/t/1.json", { signal: state.cfRetryController.signal });
  reply(requests.at(-1), topic(1));
  await probe;
  assert.equal(requests.length, pausedCount + 1, "只放行手动验证读取");
  assert.equal(state.cfChallenge, true, "仅返回响应不能提前解除暂停");
  console.log("CF 标志头/HTML 识别、普通错误不误判、取消竞态、持续暂停及手动探测：通过");
  console.log("预取限速/并发/暂停、点击复用、楼层补取、实际阅读与会话边界：通过");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
