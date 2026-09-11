const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// 隔离初始化与网络，直接验证生产代码中的缓存和设置保存逻辑。
const source = fs.readFileSync(path.join(__dirname, "../src/content.js"), "utf8");
const storage = new Map();
let now = 1_000_000;
const context = {
  window: { innerWidth: 1440, innerHeight: 900 },
  location: { href: "https://linux.do/latest", origin: "https://linux.do" },
  URL,
  Date: class extends Date { static now() { return now; } },
  localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value)
  }
};
assert.equal((source.match(/^  init\(\);$/gm) || []).length, 1);
vm.runInNewContext(source.replace(/^  init\(\);$/m,
  "  globalThis.test = { state, cacheCurrentTopic, getCachedTopic, pruneTopicCache, saveSettings, readPersistedSettings };"), context);
const api = context.test;
for (let id = 1; id <= 13; id++) {
  api.state.currentUrl = `https://linux.do/t/test/${id}`;
  api.state.currentTopic = { id };
  api.state.drawerBody = { scrollTop: id * 10 };
  api.cacheCurrentTopic();
}
assert.equal(api.state.topicCache.size, 12);
assert.equal(api.getCachedTopic("https://linux.do/t/test/1"), null);
assert.equal(api.getCachedTopic("https://linux.do/t/test/2#reply").scrollTop, 20);
api.state.currentUrl = "https://linux.do/t/test/14";
api.state.currentTopic = { id: 14 };
api.cacheCurrentTopic();
assert.equal(api.getCachedTopic("https://linux.do/t/test/3"), null);
assert.equal(api.getCachedTopic("https://linux.do/t/test/2").topic.id, 2);
now += 600_001;
api.pruneTopicCache();
assert.equal(api.state.topicCache.size, 0);
api.saveSettings();
assert.equal(api.readPersistedSettings().previewMode, api.state.settings.previewMode);
storage.set("ld-drawer-settings-v1", "invalid JSON");
assert.equal(api.readPersistedSettings(), null);
context.localStorage.getItem = context.localStorage.setItem = () => { throw Error("blocked"); };
assert.doesNotThrow(() => api.saveSettings());
assert.equal(api.readPersistedSettings(), null);
console.log("Cache capacity, LRU, expiry, scroll state and storage fallback: PASS");
