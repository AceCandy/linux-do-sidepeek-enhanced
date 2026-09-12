const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function replaceOnce(text, pattern, replacement) {
  assert.equal([...text.matchAll(pattern)].length, 1, `生成边界发生变化：${pattern}`);
  return text.replace(pattern, () => replacement);
}

function buildUserscript({ content, css, native, template, version }) {
  content = replaceOnce(content, /^\(function \(\) \{\n  "use strict";\n\n  const PAGE_WINDOW = window;\n\n/g, "");
  content = replaceOnce(content, /\n\}\)\(\);\s*$/g, "");
  // 仅替换两个存储适配函数；边界必须唯一，防止源码变化后静默漏掉逻辑。
  for (const name of ["readPersistedSettings", "saveSettings"]) {
    content = replaceOnce(content, new RegExp(`^  function ${name}\\(\\) \\{\\n[\\s\\S]*?^  \\}\\n\\n`, "gm"), "");
  }
  const parts = {
    native: native.trimEnd(),
    css: css.trimEnd().replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${")
      .split("\n").map(line => line ? `  ${line}` : line).join("\n"),
    content: content.split("\n").map(line => line ? `  ${line}` : line).join("\n")
  };
  template = replaceOnce(template, /\{\{VERSION\}\}/g, version);
  for (const name of Object.keys(parts)) {
    assert.equal(template.split(`/* @${name} */`).length, 2, `模板占位符必须唯一：${name}`);
  }
  const output = template.replace(/\/\* @(native|css|content) \*\//g, (_, name) => parts[name]);
  new vm.Script(output, { filename: "linuxdo-sidepeek.user.js" });
  return output;
}

module.exports = { buildUserscript };

if (require.main === module) {
  assert.ok(process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === "--check"),
    "用法：node scripts/build-userscript.cjs [--check]");
  const root = path.join(__dirname, "..");
  const read = name => fs.readFileSync(path.join(root, name), "utf8");
  const output = buildUserscript({
    content: read("src/content.js"), css: read("src/content.css"), native: read("src/native-renderer.js"),
    template: read("userscript/template.js"), version: JSON.parse(read("manifest.json")).version
  });
  const target = path.join(root, "userscript/linuxdo-sidepeek.user.js");
  if (process.argv[2] === "--check") {
    assert.equal(fs.existsSync(target) && fs.readFileSync(target, "utf8") === output, true,
      "油猴产物未同步，请运行 node scripts/build-userscript.cjs");
    console.log("[userscript] 源码与生成产物一致");
  } else {
    fs.writeFileSync(target, output);
    console.log("[userscript] 已生成 userscript/linuxdo-sidepeek.user.js");
  }
}
