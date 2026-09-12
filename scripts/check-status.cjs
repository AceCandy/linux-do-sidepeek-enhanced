const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");

const read = (name) => fs.readFileSync(path.join(__dirname, "..", name), "utf8");
const source = read("src/content.js");
const statusFunctions = source.slice(source.indexOf("  function buildTrustStatusPanel()"), source.indexOf("  function ensureDrawer()"));

async function checkBackground() {
  let listener;
  let calls = 0;
  let shouldFail = false;
  const context = {
    chrome: { runtime: { id: "test-extension", onMessage: { addListener(fn) { listener = fn; } } } },
    AbortController, setTimeout, clearTimeout,
    async fetch(url, options) {
      calls++;
      assert.equal(url, "https://connect.linux.do/");
      assert.equal(options.credentials, "include");
      assert.equal(options.redirect, "error");
      if (shouldFail) throw new Error("测试网络异常");
      return { ok: true, headers: { get: () => "text/html" }, text: async () => "<html>test</html>" };
    }
  };
  vm.runInNewContext(read("src/background.js"), context);
  const message = { type: "ld-fetch-trust-status", url: "https://example.invalid/" };
  const sender = { id: "test-extension", frameId: 0, tab: {}, url: "https://linux.do/latest" };
  for (const invalid of [{ ...sender, url: "https://linux.do.evil.test/" }, { ...sender, frameId: 1 }, { ...sender, id: "other" }, {}]) {
    assert.equal(listener(message, invalid, () => assert.fail("不应响应非法来源")), false);
  }
  assert.equal(calls, 0);
  const request = () => new Promise((resolve) => assert.equal(listener(message, sender, resolve), true));
  const responses = await Promise.all([request(), request()]);
  assert.equal(calls, 1, "并发请求应合并");
  assert.equal(responses[0].html, "<html>test</html>");
  shouldFail = true;
  assert.ok((await request()).error);
  shouldFail = false;
  assert.ok((await request()).html, "失败后能够重试");
}

function checkBrowser() {
  const session = `sidepeek-status-check-${process.pid}`;
  const run = (args, input) => {
    const result = spawnSync("agent-browser", ["--session", session, ...args], { input, encoding: "utf8", maxBuffer: 2_000_000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout;
  };
  // 人工固定数据；不访问账号，也不发送阅读上报。
  const fixture = `<div class="card"><h2>信任级别 3 的要求</h2><div class="card-subtitle">@test-user · 示例</div>
    <div class="tl3-ring"><span class="tl3-ring-label">浏览话题</span><span class="tl3-ring-current">1,200</span><span class="tl3-ring-target">2,000</span></div>
    <div class="tl3-bar-item"><span class="tl3-bar-label">已读帖子 &lt;img src=x&gt;</span><span class="tl3-bar-nums">3,000 / 2,000</span></div>
    <div class="tl3-quota-card"><span class="tl3-quota-label">被举报帖子</span><span class="tl3-quota-nums">2 / 5</span></div>
    <div class="tl3-veto-item"><span class="tl3-veto-label">被禁言</span><span class="tl3-veto-value">1</span></div></div>`;
  const exposed = source.replace(/^  init\(\);$/m, "  globalThis.statusTest = { state, parseTrustStatus, buildTrustStatusPanel, refreshTrustStatus, syncTrustStatusVisibility };");
  try {
    run(["open", "about:blank"]);
    run(["network", "route", "https://linux.do/latest", "--body", "<!doctype html><title>状态面板固定页面</title><main>测试列表</main>"]);
    run(["open", "https://linux.do/latest"]);
    console.log(run(["eval", "--stdin"], `(async () => {
      ${exposed}
      const assert = (value, message) => { if (!value) throw new Error(message); };
      const api = globalThis.statusTest;
      const html = ${JSON.stringify(fixture)};
      const parsed = api.parseTrustStatus(html);
      assert(parsed.username === "@test-user" && parsed.targetLevel === "3", "用户和等级");
      assert(parsed.requirements.map(x => x.met).join() === "false,true,true,false", "正反向指标判定");
      assert(parsed.requirements[0].current === 1200, "千位分隔符");
      for (const invalid of ["<html>登录</html>", html.replace("1,200", "未知")]) {
        let rejected = false;
        try { api.parseTrustStatus(invalid); } catch { rejected = true; }
        assert(rejected, "登录页和异常指标应拒绝解析");
      }
      let calls = 0;
      globalThis.GM_xmlhttpRequest = options => {
        calls++;
        options.onload({ status: 200, finalUrl: "https://connect.linux.do/", responseText: html });
      };
      const style = document.createElement("style");
      style.textContent = ${JSON.stringify(read("src/content.css"))};
      document.head.append(style);
      localStorage.removeItem("ld-trust-status-pinned");
      api.buildTrustStatusPanel();
      assert(!api.state.trustPanel.open && calls === 0, "默认收起且不请求");
      api.state.trustPanel.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "touch" }));
      assert(!api.state.trustPanel.open, "触屏不应触发悬停展开");
      api.state.trustPanel.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" }));
      await new Promise(resolve => setTimeout(resolve, 30));
      assert(calls === 1 && document.querySelectorAll("#ld-trust-status dt").length === 4, "初次请求和渲染");
      assert(!document.querySelector("#ld-trust-status img"), "指标只能作为文本渲染");
      const rows = [...document.querySelectorAll("#ld-trust-status .ld-status-row")];
      assert(!document.querySelector("#ld-trust-status dd span"), "达标状态不能单独占行");
      assert(rows[0].getBoundingClientRect().height <= 30, "普通指标行高应不超过 30px");
      for (const [index, row] of rows.entries()) {
        const value = row.querySelector("dd");
        assert(value.classList.contains(parsed.requirements[index].met ? "ld-status-met" : "ld-status-unmet"), "数值状态配色");
        assert(value.getAttribute("aria-label").includes(parsed.requirements[index].met ? "已达标" : "未达标"), "保留无障碍状态说明");
      }
      await api.refreshTrustStatus();
      assert(calls === 1, "五分钟刷新间隔");
      api.state.settings.showTrustStatus = "off";
      api.syncTrustStatusVisibility();
      await api.refreshTrustStatus(true);
      assert(calls === 1 && api.state.trustPanel.hidden, "隐藏后不请求");
      api.state.settings.showTrustStatus = "on";
      api.syncTrustStatusVisibility();
      assert(!api.state.trustPanel.hidden, "重新显示");
      api.state.trustPanel.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" }));
      assert(!api.state.trustPanel.open, "移开后收起");
      await new Promise(resolve => setTimeout(resolve, 30));
      await api.refreshTrustStatus(true);
      assert(calls === 1 && localStorage.getItem("ld-trust-status-pinned") === null, "悬停不写持久状态且收起停止请求");
      api.state.trustPanel.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" }));
      api.state.trustRefreshButton.focus();
      api.state.trustPanel.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" }));
      assert(api.state.trustPanel.open, "面板内键盘焦点不能被移出鼠标关闭");
      api.state.trustRefreshButton.blur();
      assert(!api.state.trustPanel.open, "焦点移出后收起临时面板");
      const summary = api.state.trustPanel.querySelector("summary");
      summary.click();
      api.state.trustPanel.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" }));
      assert(api.state.trustPanel.open && localStorage.getItem("ld-trust-status-pinned") === "true", "点击固定后移开不收起");
      await api.refreshTrustStatus(true);
      assert(calls === 2, "手动刷新");
      globalThis.GM_xmlhttpRequest = options => options.onerror();
      await api.refreshTrustStatus(true);
      assert(api.state.trustContent.textContent.includes("登录或验证"), "失败提示");
      assert(!api.state.trustRefreshButton.disabled, "失败后允许重试");
      summary.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      assert(!api.state.trustPanel.open && !api.state.trustPinned && document.activeElement === summary, "Esc 收起并恢复焦点");
      summary.blur();
      return "状态解析、文本安全、折叠、刷新及错误处理：通过";
    })()`).trim());
    run(["hover", "#ld-trust-status summary"]);
    run(["wait", "--fn", "statusTest.state.trustPanel.open"]);
    run(["hover", "#ld-trust-status button"]);
    run(["wait", "--fn", "statusTest.state.trustPanel.open"]);
    run(["hover", "main"]);
    run(["wait", "--fn", "!statusTest.state.trustPanel.open"]);
    run(["focus", "#ld-trust-status summary"]);
    run(["press", "Enter"]);
    run(["wait", "--fn", "statusTest.state.trustPanel.open && statusTest.state.trustPinned"]);
    run(["set", "viewport", "390", "844"]);
    console.log(run(["eval", "--stdin"], `(async () => {
      globalThis.GM_xmlhttpRequest = options => options.onload({ status: 200, finalUrl: "https://connect.linux.do/", responseText: ${JSON.stringify(fixture)} });
      await statusTest.refreshTrustStatus(true);
      const row = document.querySelector("#ld-trust-status .ld-status-row");
      if (row.getBoundingClientRect().height > 30) throw Error("窄屏指标行高过大");
      return "紧凑单行指标及状态说明：通过";
    })()`));
    console.log(run(["eval", "--stdin"], `(() => { const r = document.querySelector("#ld-trust-status").getBoundingClientRect(); if (r.left < 0 || r.right > innerWidth || r.bottom > innerHeight) throw Error("窄屏溢出"); return "390px 窄屏边界：通过"; })()`).trim());
  } finally {
    run(["close"]);
  }
}

checkBackground().then(() => {
  console.log("状态后台来源校验、固定地址、请求合并和失败重试：通过");
  if (process.argv.includes("--browser")) checkBrowser();
}).catch((error) => { console.error(error); process.exitCode = 1; });
