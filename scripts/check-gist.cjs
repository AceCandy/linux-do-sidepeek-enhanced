const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

async function check(userscript) {
  const storage = new Map();
  const gistId = "a".repeat(32), token = "test_token_not_a_secret";
  let gist, failPatch = false, userId = 7, writes = 0, listener, queue = Promise.resolve();
  const fetch = async (url, options = {}) => {
    if (url.startsWith("https://linux.do/")) return new Response(JSON.stringify({ current_user: { id: userId, username: "tester" } }));
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
    localStorage: { getItem: () => null }, URL, AbortSignal, Response, TextEncoder, setTimeout, clearTimeout,
    document: { addEventListener() {}, querySelector: () => ({ getAttribute: () => "session" }), createElement: () => ({}), head: { appendChild() {} } },
    navigator: { locks: { request: (key, fn) => { const result = queue.then(fn); queue = result.catch(() => {}); return result; } } },
    chrome, fetch,
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
    "globalThis.gistTest = { state, normalizeBookmarkData, mergeBookmarkMetadata, syncBookmarkGist, readBookmarkGist };"), context);
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
  const removed = structuredClone(original);
  removed.folders = ["生活"];
  removed.items["Post:1"].folder = "";
  assert.equal(api.mergeBookmarkMetadata(original, original, removed).folders.length, 1);
  const reordered = structuredClone(original);
  reordered.folders.reverse();
  assert.equal(api.mergeBookmarkMetadata(original, original, reordered).folders[0], "生活");
  assert.equal(api.mergeBookmarkMetadata(null, empty, original).items["Post:1"].note, "原备注");
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
  const stableWrites = writes;
  await api.syncBookmarkGist({ token, gistId });
  assert.equal(writes, stableWrites, "无变化不应重复推送");
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
  const sender = { id: "test", frameId: 0, tab: {}, url: "https://linux.do/latest" };
  assert.equal(listener({ type: "ld-bookmark-gist" }, { ...sender, url: "https://evil.invalid/" }, () => assert.fail()), false);
  const invalid = await new Promise(resolve => listener({ type: "ld-bookmark-gist", token, gistId: "../../users", method: "GET" }, sender, resolve));
  assert.ok(invalid.error);
  console.log(`${userscript ? "油猴" : "扩展"}：Gist 创建、双向字段合并、分类删除/排序、冲突、失败重试、账号/请求边界通过`);
}

(async () => { await check(false); await check(true); })().catch(error => { console.error(error); process.exitCode = 1; });
