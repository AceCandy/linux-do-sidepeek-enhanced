"use strict";

const state = { request: null };

// 只允许本站顶层内容脚本请求固定端点，不接受任意 URL 代理请求。
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!["ld-fetch-trust-status", "ld-bookmark-gist"].includes(message?.type) || sender.id !== chrome.runtime.id ||
      sender.frameId !== 0 || !sender.tab || !sender.url?.startsWith("https://linux.do/")) {
    return false;
  }

  if (message.type === "ld-bookmark-gist") {
    fetchBookmarkGist(message).then(sendResponse);
    return true;
  }

  if (!state.request) {
    state.request = fetchTrustStatus().finally(() => { state.request = null; });
  }
  state.request.then(sendResponse);
  return true;
});

// 固定 Gist 端点与文件名，不允许内容脚本指定任意 URL、请求头或文件。
async function fetchBookmarkGist({ token, gistId, method, content }) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_]{10,255}$/.test(token) ||
      typeof gistId !== "string" || (gistId && !/^[a-f0-9]{20,40}$/.test(gistId)) ||
      !["GET", "POST", "PATCH"].includes(method) || (method === "POST" ? !!gistId : !gistId) ||
      (method !== "GET" && (typeof content !== "string" || content.length > 900000))) {
    return { error: "Gist 请求参数无效" };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const body = method === "GET" ? undefined : JSON.stringify({
      ...(method === "POST" ? { public: false, description: "SidePeek 收藏整理同步" } : {}),
      files: { "sidepeek-bookmarks.json": { content } }
    });
    const response = await fetch(`https://api.github.com/gists${gistId ? `/${gistId}` : ""}`, {
      method, body, credentials: "omit", redirect: "error", cache: "no-store", signal: controller.signal,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
        "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28" }
    });
    if (!response.ok) return { error: `GitHub 请求失败（${response.status}），请检查 Token、权限和 Gist ID` };
    const text = await response.text();
    if (text.length > 6 * 1024 * 1024) return { error: "Gist 响应过大" };
    return { data: JSON.parse(text) };
  } catch {
    return { error: "Gist 网络请求失败；若是首次创建，请先在 GitHub 检查是否已创建再重试" };
  } finally {
    clearTimeout(timeout);
  }
}

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
