"use strict";

const state = { request: null };

// 只允许本站顶层内容脚本读取固定地址，不接受任意 URL 代理请求。
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "ld-fetch-trust-status" || sender.id !== chrome.runtime.id ||
      sender.frameId !== 0 || !sender.tab || !sender.url?.startsWith("https://linux.do/")) {
    return false;
  }

  if (!state.request) {
    state.request = fetchTrustStatus().finally(() => { state.request = null; });
  }
  state.request.then(sendResponse);
  return true;
});

async function fetchTrustStatus() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch("https://connect.linux.do/", {
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal
    });
    if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) {
      throw new Error("无法获取状态页面");
    }
    const html = await response.text();
    if (html.length > 2_000_000) {
      throw new Error("状态页面过大");
    }
    return { html };
  } catch {
    return { error: "获取失败，请先打开 Connect 完成登录或验证，再重试。" };
  } finally {
    clearTimeout(timeout);
  }
}
