const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

async function check(userscript) {
  const storage = new Map();
  const gistId = "a".repeat(32), token = "test_token_not_a_secret";
  let gist, failPatch = false, userId = 7, writes = 0, listener, queue = Promise.resolve();
  let conflictChoice = false, duringConflict, conflicts = 0;
  let now = Date.now(), timerId = 0, requests = 0, patchAttempts = 0, failAccount = false;
  const timers = new Map();
  class TestDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const advance = async ms => {
    now += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.at <= now && timers.has(id)) { timers.delete(id); await timer.fn(); }
    }
  };
  const fetch = async (url, options = {}) => {
    requests++;
    if (url.startsWith("https://linux.do/")) return new Response(JSON.stringify({ current_user: { id: userId, username: "tester" } }), { status: failAccount ? 403 : 200 });
    assert.match(url, /^https:\/\/api\.github\.com\/gists(?:\/[a-f0-9]{32})?$/);
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    if (options.method === "POST") {
      const body = JSON.parse(options.body);
      assert.equal(body.public, false);
      gist = { id: gistId, public: false, files: body.files };
      writes++;
    }
    if (options.method === "PATCH") {
      patchAttempts++;
      if (failPatch) return new Response("{}", { status: 503 });
      gist.files = JSON.parse(options.body).files;
      writes++;
    }
    return new Response(JSON.stringify(gist));
  };
  const chrome = {
    runtime: { id: "test", onMessage: { addListener(fn) { listener = fn; } },
      sendMessage: message => new Promise(resolve => listener(message, { id: "test", frameId: 0, tab: {}, url: "https://linux.do/latest" }, resolve)) },
    storage: { local: {
      get: async key => ({ [key]: structuredClone(storage.get(key)) }),
      set: async data => { for (const [key, value] of Object.entries(data)) storage.set(key, structuredClone(value)); }
    } }
  };
  vm.runInNewContext(read("src/background.js"), { chrome, fetch, AbortController, setTimeout, clearTimeout });
  const context = {
    window: { addEventListener() {} }, unsafeWindow: {}, location: { href: "https://linux.do/latest", origin: "https://linux.do" },
    localStorage: { getItem: () => null }, URL, AbortSignal, Response, TextEncoder, Date: TestDate,
    setTimeout: (fn, delay) => { timers.set(++timerId, { fn, at: now + delay }); return timerId; },
    clearTimeout: id => timers.delete(id),
    document: { addEventListener() {}, querySelector: () => ({ getAttribute: () => "session" }), createElement: () => ({}), head: { appendChild() {} } },
    navigator: { locks: { request: (key, fn) => { const result = queue.then(fn); queue = result.catch(() => {}); return result; } } },
    chrome, fetch,
    chooseConflict: async (message, label, options) => {
      assert.match(message, /同步冲突/);
      assert.equal(label, "以本机为准");
      assert.equal(options.alternateLabel, "以云端为准");
      conflicts++;
      duringConflict?.();
      return conflictChoice;
    },
    GM_getValue: async key => structuredClone(storage.get(key)) ?? null,
    GM_setValue: async (key, value) => storage.set(key, structuredClone(value))
  };
  if (userscript) context.GM_xmlhttpRequest = options => {
    assert.equal(options.anonymous, true);
    fetch(options.url, { method: options.method, body: options.data, headers: options.headers, credentials: "omit", redirect: options.redirect })
      .then(async response => options.onload({ status: response.status, responseText: await response.text() })).catch(options.onerror);
  };
  const source = read(userscript ? "userscript/linuxdo-sidepeek.user.js" : "src/content.js");
  vm.runInNewContext(source.replace(userscript ? /^    init\(\);$/m : /^  init\(\);$/m,
    "confirmBookmarkAction = (...args) => globalThis.chooseConflict(...args); globalThis.gistTest = { state, normalizeBookmarkData, mergeBookmarkMetadata, syncBookmarkGist, readBookmarkGist, updateBookmarkData, scheduleBookmarkAutoSync, runBookmarkAutoSync };"), context);
  const api = context.gistTest, b = api.state.bookmarks;
  const normalize = data => api.normalizeBookmarkData(data);
  const empty = normalize(null);
  const original = normalize({ version: 1, folders: ["技术", "生活"], items: { "Post:1": { folder: "技术", tags: ["教程"], note: "原备注" } } });
  const local = structuredClone(original), remote = structuredClone(original);
  local.items["Post:1"].note = "本机备注";
  remote.items["Post:1"].tags = ["远端标签"];
  const merged = api.mergeBookmarkMetadata(original, local, remote);
  assert.equal(merged.items["Post:1"].note, "本机备注");
  assert.equal(merged.items["Post:1"].tags[0], "远端标签");
  remote.items["Post:1"].note = "冲突";
  assert.throws(() => api.mergeBookmarkMetadata(original, local, remote), /同步冲突/);
  for (const base of [original, null]) {
    for (const preference of ["local", "remote"]) {
      const result = api.mergeBookmarkMetadata(base, local, remote, preference);
      assert.equal(result.items["Post:1"].note, preference === "local" ? "本机备注" : "冲突");
      assert.equal(result.items["Post:1"].tags[0], base || preference === "remote" ? "远端标签" : "教程");
    }
  }
  const removed = structuredClone(original);
  removed.folders = ["生活"];
  removed.items["Post:1"].folder = "";
  assert.equal(api.mergeBookmarkMetadata(original, original, removed).folders.length, 1);
  const reordered = structuredClone(original);
  reordered.folders.reverse();
  assert.equal(api.mergeBookmarkMetadata(original, original, reordered).folders[0], "生活");
  assert.equal(api.mergeBookmarkMetadata(null, empty, original).items["Post:1"].note, "原备注");
  const added = structuredClone(original);
  added.items["Post:2"] = { folder: "技术", tags: ["新增"], note: "保留" };
  assert.throws(() => api.mergeBookmarkMetadata(original, removed, added), /另一端仍在使用/);
  for (const preference of ["local", "remote"]) {
    const result = api.mergeBookmarkMetadata(original, removed, added, preference);
    assert.equal(result.items["Post:2"].folder, preference === "local" ? "" : "技术");
    assert.equal(result.items["Post:2"].note, "保留");
    assert.equal(result.folders.includes("技术"), preference === "remote");
    assert.deepEqual([...removed.folders], ["生活"], "合并不得修改输入快照");
  }
  const newLocal = structuredClone(local), newRemote = structuredClone(remote);
  newLocal.folders.push("本机新夹"); newRemote.folders.reverse(); newRemote.folders.push("云端新夹");
  newLocal.items["Post:2"] = { folder: "本机新夹", tags: [], note: "本机新增" };
  newRemote.items["Post:3"] = { folder: "云端新夹", tags: [], note: "云端新增" };
  newLocal.items["Post:1"].folder = "本机新夹"; newRemote.items["Post:1"].folder = "云端新夹";
  for (const preference of ["local", "remote"]) {
    const result = api.mergeBookmarkMetadata(original, newLocal, newRemote, preference);
    assert.equal(result.folders[0], preference === "local" ? "技术" : "生活");
    assert.ok(result.folders.includes("本机新夹") && result.folders.includes("云端新夹"));
    assert.equal(result.items["Post:1"].folder, preference === "local" ? "本机新夹" : "云端新夹");
    assert.equal(result.items["Post:1"].note, preference === "local" ? "本机备注" : "冲突");
    assert.equal(result.items["Post:1"].tags[0], "远端标签");
    assert.equal(result.items["Post:2"].note, "本机新增");
    assert.equal(result.items["Post:3"].note, "云端新增");
  }
  b.user = { id: 7, username: "tester" }; b.token = "session"; b.data = original;
  storage.set("ld-bookmarks-v1:7", original);
  await api.syncBookmarkGist({ token, gistId: "" });
  assert.equal(writes, 1);
  assert.equal(storage.get("ld-bookmarks-gist:7").gistId, gistId);
  assert.ok(storage.get("ld-bookmarks-gist:7").base);
  await assert.rejects(api.syncBookmarkGist({ token, gistId: "" }), /已有 Gist/);
  assert.ok(!gist.files["sidepeek-bookmarks.json"].content.includes(token));
  storage.get("ld-bookmarks-v1:7").items["Post:1"].note = "本机新备注";
  let cloud = JSON.parse(gist.files["sidepeek-bookmarks.json"].content);
  cloud.data.items["Post:1"].tags = ["云端新标签"];
  gist.files["sidepeek-bookmarks.json"].content = JSON.stringify(cloud);
  failPatch = true;
  const before = JSON.stringify(storage.get("ld-bookmarks-v1:7"));
  await assert.rejects(api.syncBookmarkGist({ token, gistId }), /503/);
  assert.equal(JSON.stringify(storage.get("ld-bookmarks-v1:7")), before);
  failPatch = false;
  await api.syncBookmarkGist({ token, gistId });
  assert.equal(b.data.items["Post:1"].tags[0], "云端新标签");
  assert.equal(b.data.items["Post:1"].note, "本机新备注");
  assert.equal(conflicts, 0, "无冲突不询问");
  const setCloud = data => { cloud.data = structuredClone(data); gist.files["sidepeek-bookmarks.json"].content = JSON.stringify(cloud); };
  for (const choice of [true, "alternate"]) {
    const left = structuredClone(original), right = structuredClone(original);
    left.items["Post:1"].folder = ""; right.items["Post:1"].folder = "生活";
    left.items["Post:1"].note = "保留本机备注"; right.items["Post:1"].tags = ["保留云端标签"];
    storage.set("ld-bookmarks-v1:7", left);
    storage.get("ld-bookmarks-gist:7").base = structuredClone(original);
    setCloud(right);
    const beforeConfig = JSON.stringify(storage.get("ld-bookmarks-gist:7")), beforeCloud = JSON.stringify(gist), beforeWrites = writes;
    conflictChoice = false;
    await assert.rejects(api.syncBookmarkGist({ token, gistId }), /已取消同步/);
    assert.equal(JSON.stringify(storage.get("ld-bookmarks-v1:7")), JSON.stringify(left));
    assert.equal(JSON.stringify(storage.get("ld-bookmarks-gist:7")), beforeConfig, "取消不更新基线、同步时间或快照");
    assert.equal(JSON.stringify(gist), beforeCloud);
    assert.equal(writes, beforeWrites);
    conflictChoice = choice;
    await api.syncBookmarkGist({ token, gistId });
    assert.equal(b.data.items["Post:1"].folder, choice === true ? "" : "生活");
    assert.equal(b.data.items["Post:1"].note, "保留本机备注");
    assert.equal(b.data.items["Post:1"].tags[0], "保留云端标签");
    assert.equal(JSON.stringify(storage.get("ld-bookmarks-gist:7").recovery), JSON.stringify({ local: left, remote: right }));
    assert.equal(JSON.stringify(JSON.parse(gist.files["sidepeek-bookmarks.json"].content).data), JSON.stringify(b.data));
  }
  storage.set("ld-bookmarks-v1:7", structuredClone(local));
  storage.get("ld-bookmarks-gist:7").base = structuredClone(original);
  setCloud(remote);
  const beforeRaceWrites = writes, beforeRaceBase = JSON.stringify(storage.get("ld-bookmarks-gist:7").base);
  duringConflict = () => {
    const changed = structuredClone(remote); changed.items["Post:1"].note = "选择期间云端又修改"; setCloud(changed);
  };
  for (const choice of [true, "alternate"]) {
    setCloud(remote);
    conflictChoice = choice;
    await assert.rejects(api.syncBookmarkGist({ token, gistId }), /云端.*修改|云端.*变化/);
    assert.equal(JSON.stringify(storage.get("ld-bookmarks-v1:7")), JSON.stringify(local));
    assert.equal(JSON.stringify(storage.get("ld-bookmarks-gist:7").base), beforeRaceBase);
    assert.equal(writes, beforeRaceWrites, "选择期间云端有新修改不得覆盖");
  }
  duringConflict = undefined;
  await api.syncBookmarkGist({ token, gistId });
  let stableWrites = writes;
  await api.syncBookmarkGist({ token, gistId });
  assert.equal(writes, stableWrites, "无变化不应重复推送");
  const config = () => storage.get("ld-bookmarks-gist:7");
  let beforeRequests = requests;
  await api.runBookmarkAutoSync();
  assert.equal(requests, beforeRequests, "默认关闭不请求 Gist 或账号接口");
  b.user = null; b.token = ""; failAccount = true;
  await api.runBookmarkAutoSync();
  assert.equal(b.autoSyncPaused, true);
  beforeRequests = requests;
  await advance(1800000);
  assert.equal(requests, beforeRequests, "首次读取账号失败后也必须暂停，不能轮询重试");
  failAccount = false; b.autoSyncPaused = false;
  config().autoSync = true; config().autoSyncAt = now - 1;
  b.user = null; b.token = ""; b.data = null;
  await api.runBookmarkAutoSync();
  assert.equal(b.user.id, 7);
  assert.equal(b.data.items["Post:1"].note, config().base.items["Post:1"].note, "重开页面不必先打开收藏即可自动同步");
  assert.equal(writes, stableWrites);
  beforeRequests = requests;
  config().autoSync = true; config().autoSyncAt = now + 30000;
  b.verified = true;
  await api.updateBookmarkData(data => { data.items["Post:1"].note = "防抖第一笔"; });
  await advance(10000);
  await api.updateBookmarkData(data => { data.items["Post:1"].note = "防抖最终值"; });
  assert.equal(config().autoSyncAt, now + 30000, "待同步时间持久化以便重载后续传");
  assert.equal(timers.size, 1, "连续编辑仅保留一个调度器");
  await advance(29000);
  assert.equal(requests, beforeRequests, "防抖到期前不请求网络");
  await advance(1000);
  assert.equal(writes, stableWrites + 1, "连续编辑只 PATCH 一次");
  assert.equal(JSON.parse(gist.files["sidepeek-bookmarks.json"].content).data.items["Post:1"].note, "防抖最终值");
  assert.equal(config().autoSyncAt, now + 1800000);
  const remoteOnly = structuredClone(b.data); remoteOnly.items["Post:1"].tags = ["周期拉取"];
  setCloud(remoteOnly);
  stableWrites = writes; beforeRequests = requests;
  await advance(1799999);
  assert.equal(requests, beforeRequests);
  api.scheduleBookmarkAutoSync(0);
  await advance(1);
  assert.equal(b.data.items["Post:1"].tags[0], "周期拉取");
  assert.equal(writes, stableWrites, "仅云端改变无需回写 Gist");

  await api.updateBookmarkData(data => { data.items["Post:1"].note = "编辑中延后"; });
  beforeRequests = requests;
  b.dialog = { open: true, querySelector: () => ({}) };
  await advance(30000);
  assert.equal(requests, beforeRequests, "编辑或配置打开时不自动同步");
  b.dialog = null;
  context.document.hidden = true;
  api.scheduleBookmarkAutoSync(0);
  assert.equal(timers.size, 0, "后台页面不保留定时器");
  await api.runBookmarkAutoSync();
  assert.equal(requests, beforeRequests);
  context.document.hidden = false;
  api.state.previewPageHidden = true;
  await api.runBookmarkAutoSync();
  assert.equal(requests, beforeRequests, "pagehide 后不请求");
  api.state.previewPageHidden = false;
  api.state.settings.enhancedBookmarks = "off";
  api.scheduleBookmarkAutoSync(0);
  assert.equal(timers.size, 0);
  await api.runBookmarkAutoSync();
  assert.equal(requests, beforeRequests, "关闭增强收藏也关闭自动任务");
  api.state.settings.enhancedBookmarks = "on";
  api.scheduleBookmarkAutoSync(0);
  await advance(0);
  assert.equal(b.data.items["Post:1"].note, "编辑中延后");

  await api.updateBookmarkData(data => { data.items["Post:1"].note = "多标签只上传一次"; });
  now += 30000;
  stableWrites = writes;
  await Promise.all([api.syncBookmarkGist(null, true), api.syncBookmarkGist(null, true)]);
  assert.equal(writes, stableWrites + 1, "锁内重读到期时间避免多标签重复同步");
  const baseline = JSON.stringify(config().base), lastSync = config().lastSync, beforeConflicts = conflicts;
  await api.updateBookmarkData(data => { data.items["Post:1"].note = "自动本机冲突"; });
  const conflicted = structuredClone(b.data); conflicted.items["Post:1"].note = "自动云端冲突";
  setCloud(conflicted);
  const beforeLocal = JSON.stringify(storage.get("ld-bookmarks-v1:7"));
  stableWrites = writes;
  await advance(30000);
  assert.match(config().autoSyncError, /同步冲突/);
  assert.equal(conflicts, beforeConflicts, "自动冲突不弹窗");
  assert.equal(JSON.stringify(storage.get("ld-bookmarks-v1:7")), beforeLocal);
  assert.equal(JSON.stringify(config().base), baseline);
  assert.equal(config().lastSync, lastSync);
  assert.equal(writes, stableWrites);
  beforeRequests = requests;
  await advance(1800000);
  assert.equal(requests, beforeRequests, "冲突暂停后不反复请求");
  b.autoSyncPaused = false;
  await api.runBookmarkAutoSync();
  assert.equal(requests, beforeRequests, "重载后持久化错误仍阻止自动同步");
  conflictChoice = true;
  await api.syncBookmarkGist({ token, gistId });
  assert.equal(config().autoSyncError, "");
  assert.equal(b.autoSyncPaused, false, "手动解决后恢复自动同步");

  await api.updateBookmarkData(data => { data.items["Post:1"].note = "自动网络失败保留"; });
  failPatch = true;
  await advance(30000);
  assert.match(config().autoSyncError, /503/);
  const attempts = patchAttempts;
  await advance(1800000);
  assert.equal(patchAttempts, attempts, "自动写入失败不得自行重试");
  failPatch = false;
  await api.syncBookmarkGist({ token, gistId });
  config().autoSyncAt = now - 1;
  const blocker = context.navigator.locks.request("ld-bookmarks-v1:7", () => { config().autoSync = false; });
  beforeRequests = requests;
  await Promise.all([blocker, api.syncBookmarkGist(null, true)]);
  assert.equal(requests, beforeRequests, "排队期间另一标签关闭开关后不再同步");
  const savedConfig = structuredClone(config());
  storage.set("ld-bookmarks-gist:7", null);
  await api.syncBookmarkGist(null, true);
  assert.equal(requests, beforeRequests, "断开后不请求、不重建 Gist");
  storage.set("ld-bookmarks-gist:7", { ...savedConfig, autoSync: true, gistId: "", autoSyncAt: now - 1 });
  await api.syncBookmarkGist(null, true);
  assert.equal(requests, beforeRequests, "自动同步绝不创建 Gist");
  storage.set("ld-bookmarks-gist:7", savedConfig);
  stableWrites = writes;
  gist.public = true;
  await assert.rejects(api.syncBookmarkGist({ token, gistId }), /非公开/);
  gist.public = false;
  gist.files["sidepeek-bookmarks.json"].truncated = true;
  await assert.rejects(api.syncBookmarkGist({ token, gistId }), /完整/);
  delete gist.files["sidepeek-bookmarks.json"].truncated;
  cloud = JSON.parse(gist.files["sidepeek-bookmarks.json"].content);
  cloud.userId = 8;
  gist.files["sidepeek-bookmarks.json"].content = JSON.stringify(cloud);
  await assert.rejects(api.syncBookmarkGist({ token, gistId }), /账号/);
  userId = 8;
  await assert.rejects(api.syncBookmarkGist({ token, gistId }), /账号/);
  assert.equal(writes, stableWrites);
  config().autoSync = true; config().autoSyncAt = now - 1;
  const beforeAccountChange = JSON.stringify(storage.get("ld-bookmarks-v1:7"));
  await api.runBookmarkAutoSync();
  assert.match(config().autoSyncError, /账号/);
  assert.equal(JSON.stringify(storage.get("ld-bookmarks-v1:7")), beforeAccountChange);
  assert.equal(writes, stableWrites, "自动任务账号校验失败不得写云端");
  const sender = { id: "test", frameId: 0, tab: {}, url: "https://linux.do/latest" };
  assert.equal(listener({ type: "ld-bookmark-gist" }, { ...sender, url: "https://evil.invalid/" }, () => assert.fail()), false);
  const invalid = await new Promise(resolve => listener({ type: "ld-bookmark-gist", token, gistId: "../../users", method: "GET" }, sender, resolve));
  assert.ok(invalid.error);
  console.log(`${userscript ? "油猴" : "扩展"}：Gist 创建、字段合并、分类删除/排序/新增、冲突选边/取消/快照、并发变化拦截、失败重试、账号/请求边界通过`);
  console.log(`${userscript ? "油猴" : "扩展"}：自动同步默认关闭、30秒防抖/30分钟拉取、编辑/后台延后、跨标签去重、冲突/失败暂停、手动恢复、关闭/断开保护通过`);
}

(async () => { await check(false); await check(true); })().catch(error => { console.error(error); process.exitCode = 1; });
