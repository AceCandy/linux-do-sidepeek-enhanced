const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { buildUserscript } = require("./build-userscript.cjs");

const read = name => fs.readFileSync(path.join(__dirname, "..", name), "utf8");
const inputs = {
  content: read("src/content.js"), css: read("src/content.css"), native: read("src/native-renderer.js"),
  template: read("userscript/template.js"), version: JSON.parse(read("manifest.json")).version
};
const output = buildUserscript(inputs);
assert.equal(buildUserscript(inputs), output, "重复生成必须一致");
assert.equal(output, read("userscript/linuxdo-sidepeek.user.js"));
assert.ok(output.includes(`// @version      ${inputs.version}\n`));
assert.ok(output.includes(inputs.native.trimEnd()));
assert.throws(() => buildUserscript({ ...inputs, content: inputs.content.replace("const PAGE_WINDOW = window;", "const PAGE_WINDOW = globalThis;") }), /生成边界/);
assert.throws(() => buildUserscript({ ...inputs, content: inputs.content.replace("function saveSettings()", "function renamedSettings()") }), /生成边界/);
assert.throws(() => buildUserscript({ ...inputs, template: inputs.template + "\n/* @content */" }), /占位符/);

const local = new Map();
const gm = new Map();
const styles = [];
const key = "ld-drawer-settings-v1";
const context = {
  window: { innerWidth: 1440, innerHeight: 900, addEventListener() {} },
  unsafeWindow: {}, location: { href: "https://linux.do/latest" },
  document: { addEventListener() {}, createElement: () => ({}), head: { appendChild: style => styles.push(style) } },
  localStorage: { getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, value) },
  GM_getValue: key => gm.get(key) ?? null,
  GM_setValue: (key, value) => gm.set(key, value)
};
// 执行完整生成产物，只跳过页面初始化；不访问真实页面或网络。
const trickyCss = inputs.css + '\n.test::before { content: "` ${value} \\263a"; }';
const generated = buildUserscript({ ...inputs, css: trickyCss });
assert.equal([...generated.matchAll(/^    init\(\);$/gm)].length, 1);
vm.runInNewContext(generated.replace(/^    init\(\);$/m,
  "    globalThis.test = { state, PAGE_WINDOW, readPersistedSettings, saveSettings };"), context);
assert.equal(styles.length, 1);
assert.equal(styles[0].textContent, "\n" + trickyCss.trimEnd().split("\n").map(line => line ? `  ${line}` : line).join("\n") + "\n  ");
const api = context.test;
assert.equal(api.PAGE_WINDOW, context.unsafeWindow);
assert.equal(api.readPersistedSettings(), null);
local.set(key, JSON.stringify({ previewMode: "smart" }));
assert.equal(api.readPersistedSettings().previewMode, "smart");
assert.equal(gm.get(key), local.get(key), "旧设置迁移到 GM 存储");
gm.set(key, JSON.stringify({ previewMode: "iframe" }));
assert.equal(api.readPersistedSettings().previewMode, "iframe", "优先读取 GM 设置");
gm.set(key, "invalid JSON");
assert.equal(api.readPersistedSettings().previewMode, "smart");
api.saveSettings();
assert.equal(gm.get(key), local.get(key), "保存同时写入两种存储");
context.GM_getValue = context.GM_setValue = () => { throw Error("blocked"); };
assert.doesNotThrow(() => api.saveSettings());
assert.equal(api.readPersistedSettings().previewMode, api.state.settings.previewMode);
context.localStorage.getItem = context.localStorage.setItem = () => { throw Error("blocked"); };
assert.doesNotThrow(() => api.saveSettings());
assert.equal(api.readPersistedSettings(), null);
delete context.GM_getValue;
delete context.GM_setValue;
assert.equal(api.readPersistedSettings(), null);
console.log("油猴生成、模板边界、CSS 转义、页面上下文和存储迁移/降级：通过");
