(function () {
  "use strict";

  const PAGE_WINDOW = window;

  const ROOT_ID = "ld-drawer-root";
  const IMAGE_PREVIEW_ROOT_ID = "ld-image-preview-root";
  const PAGE_OPEN_CLASS = "ld-drawer-page-open";
  const PAGE_IFRAME_OPEN_CLASS = "ld-drawer-page-iframe-open";
  const ACTIVE_LINK_CLASS = "ld-drawer-topic-link-active";
  const IFRAME_MODE_CLASS = "ld-drawer-iframe-mode";
  const NATIVE_OVERLAY_SELECTOR = ".pswp--open, .discourse-boosts-content, .emoji-picker-content, .d-modal, .dialog-container, .fk-d-menu, .menu-panel, .chat-drawer";
  const SETTINGS_KEY = "ld-drawer-settings-v1";
  const LOAD_MORE_BATCH_SIZE = 20;
  const LOAD_MORE_TRIGGER_OFFSET = 240;
  const DIRECT_REPLIES_MAX_BATCHES = 5;
  const DIRECT_REPLIES_FALLBACK_BATCHES = 3;
  const TOPIC_CACHE_MAX_ENTRIES = 100;
  const TOPIC_CACHE_TTL = 10 * 60 * 1000;
  const TOPIC_CACHE_BACKGROUND_REFRESH_AGE = 30 * 1000;
  const IMAGE_PREVIEW_SCALE_MIN = 1;
  const IMAGE_PREVIEW_SCALE_MAX = 4;
  const IMAGE_PREVIEW_SCALE_STEP = 0.2;
  const POST_BODY_FONT_SIZE_MIN = 13;
  const POST_BODY_FONT_SIZE_MAX = 18;
  const REPLY_UPLOAD_MARKER = "\u2063";
  const DEFAULT_SETTINGS = {
    previewMode: "auto",
    postMode: "all",
    postBodyFontSize: 15,
    authorFilter: "all",
    replyOrder: "default",
    floatingReplyButton: "on",
    showTrustStatus: "on",
    listAlignLeft: "off",
    drawerWidth: "narrow",
    drawerWidthCustom: 720,
    drawerMode: "overlay",
    trackPreviewVisit: "on",
    replyPanelPosition: null
  };
  const DRAWER_WIDTHS = {
    narrow: "clamp(320px, 34vw, 680px)",
    medium: "clamp(360px, 42vw, 920px)",
    wide: "clamp(420px, 52vw, 1200px)"
  };
  const LIST_ROW_SELECTOR = [
    "tr.topic-list-item",
    ".topic-list-item",
    ".latest-topic-list-item",
    "tbody.topic-list-body tr"
  ].join(", ");
  const PRIMARY_TOPIC_LINK_SELECTOR = [
    "a.title",
    ".main-link a.raw-topic-link",
    ".main-link a.title",
    ".search-link",
    ".search-result-topic a",
    ".user-stream .title a",
    ".user-main .item .title a"
  ].join(", ");
  const ENTRY_CONTAINER_SELECTOR = [
    LIST_ROW_SELECTOR,
    ".search-result",
    ".fps-result",
    ".user-stream .item",
    ".user-main .item"
  ].join(", ");
  const MAIN_CONTENT_SELECTOR = "#main-outlet";
  const TOPIC_TRACKER_SELECTOR = [
    "#list-area .show-more.has-topics",
    ".contents > .show-more.has-topics"
  ].join(", ");
  // 选择器列表不能直接拼 `${TOPIC_TRACKER_SELECTOR} ...`，否则只会给最后一段补后缀。
  const TOPIC_TRACKER_CLICKABLE_SELECTOR = TOPIC_TRACKER_SELECTOR
    .split(",")
    .map((selector) => `${selector.trim()} .alert.clickable`)
    .join(", ");
  const TOPIC_TRACKER_VERTICAL_SELECTOR = [
    ".list-controls .navigation-container",
    ".navigation-container",
    ".list-controls",
    "#navigation-bar"
  ].join(", ");
  const EXCLUDED_LINK_CONTEXT_SELECTOR = [
    ".cooked",
    ".topic-post",
    ".topic-body",
    ".topic-map",
    ".timeline-container",
    "#reply-control",
    ".d-editor-container",
    ".composer-popup",
    ".select-kit",
    ".modal",
    ".menu-panel",
    ".popup-menu",
    ".user-card",
    ".group-card"
  ].join(", ");

  const state = {
    root: null,
    header: null,
    title: null,
    meta: null,
    replyPanelMain: null,
    drawerBody: null,
    content: null,
    replyToggleButton: null,
    replyFabButton: null,
    topFabButton: null,
    bottomFabButton: null,
    replyPanel: null,
    replyPanelHead: null,
    replyPanelTitle: null,
    replyTextarea: null,
    replySubmitButton: null,
    replyCancelButton: null,
    replyStatus: null,
    imagePreviewRoot: null,
    imagePreview: null,
    imagePreviewImage: null,
    imagePreviewCloseButton: null,
    imagePreviewScale: 1,
    openInTab: null,
    settingsPanel: null,
    settingsCard: null,
    postBodyFontSizeField: null,
    postBodyFontSizeControl: null,
    postBodyFontSizeValue: null,
    postBodyFontSizeHint: null,
    settingsCloseButton: null,
    settingsToggle: null,
    latestRepliesRefreshButton: null,
    topicSearchButton: null,
    topicSearchPanel: null,
    topicSearchInput: null,
    topicSearchStatus: null,
    topicSearchResults: null,
    topicSearchAbortController: null,
    topicSearchHighlightObserver: null,
    topicSearchQuery: "",
    topicSearchPage: 1,
    prevButton: null,
    nextButton: null,
    resizeHandle: null,
    headerLayoutObserver: null,
    activeLink: null,
    currentUrl: "",
    currentEntryElement: null,
    currentEntryKey: "",
    currentTopicIdHint: null,
    currentTopicTrackingKey: "",
    currentViewTracked: false,
    currentTrackRequest: null,
    currentTrackRequestKey: "",
    currentResolvedTargetPostNumber: null,
    currentFallbackTitle: "",
    currentTopic: null,
    currentLatestRepliesTopic: null,
    currentTopicFetchedAt: 0,
    currentTargetSpec: null,
    replyTargetPostNumber: null,
    replyTargetLabel: "",
    abortController: null,
    loadMoreAbortController: null,
    replyAbortController: null,
    directRepliesAbortController: null,
    directReplyCache: new Map(),
    topicCache: new Map(),
    prefetchObserver: null,
    prefetchObserved: new Set(),
    prefetchVisible: new Set(),
    prefetchAttempted: new WeakMap(),
    prefetchRequests: new Map(),
    prefetchScanTimer: 0,
    prefetchNextAt: 0,
    prefetchPausedUntil: 0,
    previewPageHidden: false,
    reading: null,
    replyUploadControllers: [],
    replyUploadPendingCount: 0,
    replyUploadSerial: 0,
    replyComposerSessionId: 0,
    deferOwnerFilterAutoLoad: false,
    lastLocation: location.href,
    settings: loadSettings(),
    isResizing: false,
    isReplyPanelDragging: false,
    isLoadingMorePosts: false,
    isRefreshingLatestReplies: false,
    isReplySubmitting: false,
    replyPanelDragPointerId: null,
    replyPanelDragOffsetX: 0,
    replyPanelDragOffsetY: 0,
    replyPanelDragMoved: false,
    replyPanelDragLastPosition: null,
    suppressReplyPanelClick: false,
    loadMoreError: "",
    loadMoreStatus: null,
    hasShownPreviewNotice: false,
    topicTrackerSyncQueued: false,
    topicTrackerRefreshTimer: 0,
    topicTrackerRefreshStartedAt: 0,
    topicTrackerRefreshLoadingObserved: false,
    availableReactions: null,
    toastStack: null,
    trustPanel: null,
    trustPinned: false,
    trustContent: null,
    trustRefreshButton: null,
    trustLoading: false,
    trustLastAttempt: 0
  };

  function init() {
    ensureDrawer();
    bindEvents();
    watchLocationChanges();
    buildTrustStatusPanel();
    initPreviewAcceleration();
  }

  function buildTrustStatusPanel() {
    const panel = document.createElement("details");
    panel.id = "ld-trust-status";
    try {
      state.trustPinned = localStorage.getItem("ld-trust-status-pinned") === "true";
    } catch {}
    panel.open = state.trustPinned;

    const summary = document.createElement("summary");
    summary.textContent = "等级";
    summary.setAttribute("aria-label", "信任等级进度");
    summary.title = "悬停查看，点击固定展开；再次点击或按 Esc 收起";
    const badge = document.createElement("span");
    badge.className = "ld-status-level";
    badge.textContent = "进度";
    summary.append(badge);
    const actions = document.createElement("div");
    actions.className = "ld-status-actions";
    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.textContent = "刷新";
    refresh.addEventListener("click", () => refreshTrustStatus(true));
    const link = document.createElement("a");
    link.href = "https://connect.linux.do/";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Connect ↗";
    actions.append(refresh, link);
    const content = document.createElement("div");
    content.className = "ld-status-content";
    content.setAttribute("aria-live", "polite");
    content.textContent = "展开后获取信任等级进度。";
    panel.append(summary, actions, content);
    state.trustPanel = panel;
    state.trustContent = content;
    state.trustRefreshButton = refresh;
    document.body.append(panel);
    syncTrustStatusVisibility();
    function setPinned(pinned) {
      state.trustPinned = pinned;
      panel.open = pinned;
      try { localStorage.setItem("ld-trust-status-pinned", String(pinned)); } catch {}
    }
    summary.addEventListener("click", (event) => {
      event.preventDefault();
      setPinned(!state.trustPinned);
    });
    panel.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "mouse") panel.open = true;
    });
    panel.addEventListener("pointerleave", (event) => {
      if (event.pointerType === "mouse" && !state.trustPinned && !panel.contains(document.activeElement)) panel.open = false;
    });
    panel.addEventListener("focusout", (event) => {
      if (!state.trustPinned && !panel.matches(":hover") && !panel.contains(event.relatedTarget)) panel.open = false;
    });
    panel.addEventListener("toggle", () => refreshTrustStatus());
    panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setPinned(false);
        summary.focus();
      }
    });
    document.addEventListener("visibilitychange", () => refreshTrustStatus());
    setInterval(() => refreshTrustStatus(), 300000);
    refreshTrustStatus();
  }

  function syncTrustStatusVisibility() {
    if (!state.trustPanel) return;
    state.trustPanel.hidden = state.settings.showTrustStatus === "off";
    state.trustPanel.open = !state.trustPanel.hidden && state.trustPinned;
    refreshTrustStatus();
  }

  function fetchTrustStatusHtml() {
    return new Promise((resolve, reject) => {
      const fail = () => reject(new Error("获取失败，请先打开 Connect 完成登录或验证，再重试。"));
      if (typeof GM_xmlhttpRequest === "function") {
        GM_xmlhttpRequest({
          method: "GET",
          url: "https://connect.linux.do/",
          timeout: 15000,
          onload(response) {
            if (response.status !== 200 || !response.finalUrl?.startsWith("https://connect.linux.do/")) {
              fail();
              return;
            }
            resolve(response.responseText);
          },
          onerror: fail,
          ontimeout: fail,
          onabort: fail
        });
        return;
      }
      if (!globalThis.chrome?.runtime?.sendMessage) {
        fail();
        return;
      }
      chrome.runtime.sendMessage({ type: "ld-fetch-trust-status" }, (response) => {
        if (chrome.runtime.lastError || typeof response?.html !== "string") {
          fail();
          return;
        }
        resolve(response.html);
      });
    });
  }

  function parseTrustStatus(html) {
    if (typeof html !== "string" || html.length > 2_000_000) {
      throw new Error("状态页面格式不正确。");
    }
    const doc = new DOMParser().parseFromString(html, "text/html");
    const card = Array.from(doc.querySelectorAll(".card")).find((node) =>
      /信任级别\s*\d+\s*的要求/.test(node.querySelector(".card-title, h2")?.textContent || "")
    );
    if (!card) {
      throw new Error("未找到等级数据，请先打开 Connect 确认登录及页面状态。若已登录，页面结构可能已变更。");
    }
    const requirements = [];
    for (const item of card.querySelectorAll(".tl3-ring, .tl3-bar-item, .tl3-quota-card, .tl3-veto-item")) {
      const name = item.querySelector(".tl3-ring-label, .tl3-bar-label, .tl3-quota-label, .tl3-veto-label")?.textContent.trim();
      const currentNode = item.querySelector(".tl3-ring-current");
      const numberText = item.querySelector(".tl3-bar-nums, .tl3-quota-nums, .tl3-veto-value")?.textContent || "";
      const numbers = numberText.replace(/,/g, "").match(/\d+/g) || [];
      const currentText = currentNode?.textContent || numbers[0];
      const requiredText = item.querySelector(".tl3-ring-target")?.textContent || numbers[1];
      const current = Number(String(currentText).replace(/,/g, "").match(/\d+/)?.[0]);
      const required = item.matches(".tl3-veto-item") ? 0 : Number(String(requiredText).replace(/,/g, "").match(/\d+/)?.[0]);
      if (!name || !Number.isSafeInteger(current) || !Number.isSafeInteger(required)) {
        throw new Error("等级指标格式已变更，请在 Connect 查看原始数据。");
      }
      const reverse = item.matches(".tl3-quota-card, .tl3-veto-item");
      const met = item.matches(".met") || Boolean(item.querySelector(".met"));
      const unmet = item.matches(".unmet") || Boolean(item.querySelector(".unmet"));
      requirements.push({ name, current, required, met: met ? true : unmet ? false : reverse ? current <= required : current >= required });
    }
    if (!requirements.length) {
      throw new Error("未找到可识别的等级指标，请在 Connect 查看原始数据。");
    }
    const subtitle = card.querySelector(".card-subtitle")?.textContent || "";
    const username = subtitle.match(/@[^\s·]+/)?.[0] || doc.querySelector(".user-menu-info .font-semibold")?.textContent.trim() || "";
    const targetLevel = card.querySelector(".card-title, h2").textContent.match(/信任级别\s*(\d+)/)[1];
    return { username, targetLevel, requirements };
  }

  function renderTrustStatus(data) {
    state.trustPanel.querySelector(".ld-status-level").textContent = `目标 TL${data.targetLevel}`;
    const heading = document.createElement("p");
    heading.textContent = `${data.username} · 信任级别 ${data.targetLevel} 要求`;
    const list = document.createElement("dl");
    for (const item of data.requirements) {
      const row = document.createElement("div");
      row.className = "ld-status-row";
      const name = document.createElement("dt");
      name.textContent = item.name;
      const value = document.createElement("dd");
      value.textContent = `${item.current.toLocaleString()} / ${item.required.toLocaleString()}`;
      value.className = item.met ? "ld-status-met" : "ld-status-unmet";
      value.title = item.met ? "已达标" : "未达标";
      value.setAttribute("aria-label", `${value.textContent}，${value.title}`);
      row.append(name, value);
      list.append(row);
    }
    const updated = document.createElement("small");
    updated.textContent = `更新于 ${new Date().toLocaleTimeString()}；数据来自 Connect，统计可能延迟。`;
    state.trustContent.replaceChildren(heading, list, updated);
  }

  async function refreshTrustStatus(force = false) {
    if (state.settings.showTrustStatus === "off" || !state.trustPanel?.open || document.hidden || state.trustLoading ||
        (!force && Date.now() - state.trustLastAttempt < 300000)) {
      return;
    }
    state.trustLoading = true;
    state.trustLastAttempt = Date.now();
    state.trustRefreshButton.disabled = true;
    state.trustContent.setAttribute("aria-busy", "true");
    state.trustContent.textContent = "正在获取等级进度…";
    try {
      renderTrustStatus(parseTrustStatus(await fetchTrustStatusHtml()));
    } catch (error) {
      state.trustContent.textContent = error.message;
    } finally {
      state.trustLoading = false;
      state.trustRefreshButton.disabled = false;
      state.trustContent.setAttribute("aria-busy", "false");
    }
  }

  function ensureDrawer() {
    if (state.root) {
      return;
    }

    const root = document.createElement("aside");
    root.id = ROOT_ID;
    root.setAttribute("aria-hidden", "true");
    root.innerHTML = `
      <div class="ld-drawer-resize-handle" role="separator" aria-label="调整抽屉宽度" aria-orientation="vertical" title="拖动调整宽度"></div>
      <div class="ld-drawer-shell">
        <div class="ld-toast-stack" aria-live="polite" aria-atomic="true"></div>
        <div class="ld-drawer-main">
          <div class="ld-drawer-header">
            <div class="ld-drawer-header-top">
              <div class="ld-drawer-header-actions" role="toolbar" aria-label="抽屉操作">
                <button class="ld-drawer-nav" type="button" data-nav="prev" data-tooltip="上一帖" aria-label="上一帖">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
                </button>
                <button class="ld-drawer-nav" type="button" data-nav="next" data-tooltip="下一帖" aria-label="下一帖">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
                </button>
                <span class="ld-header-action-divider" aria-hidden="true"></span>
                <button class="ld-drawer-settings-toggle" type="button" aria-expanded="false" aria-controls="ld-drawer-settings" data-tooltip="选项" aria-label="选项">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06-.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                </button>
                <button class="ld-drawer-reply-toggle ld-drawer-reply-trigger" type="button" aria-expanded="false" aria-controls="ld-drawer-reply-panel" aria-label="回复当前主题" data-tooltip="回复当前主题" hidden>
                  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 12.5c0-4.14 3.36-7.5 7.5-7.5h7a1.5 1.5 0 0 1 0 3h-7A4.5 4.5 0 0 0 7 12.5v1.38l1.44-1.44a1.5 1.5 0 0 1 2.12 2.12l-4 4a1.5 1.5 0 0 1-2.12 0l-4-4a1.5 1.5 0 1 1 2.12-2.12L4 13.88V12.5Z"/></svg>
                </button>
                <a class="ld-drawer-link" href="https://linux.do/latest" target="_blank" rel="noopener noreferrer" data-tooltip="新标签打开" aria-label="新标签打开">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                </a>
                <button class="ld-drawer-close" type="button" aria-label="关闭抽屉" data-tooltip="关闭">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              </div>
            </div>
            <div class="ld-drawer-title-group">
              <h2 class="ld-drawer-title">点击帖子标题开始预览</h2>
            </div>
            <div class="ld-drawer-meta"></div>
          </div>
          <div class="ld-drawer-settings" id="ld-drawer-settings" hidden>
            <div class="ld-drawer-settings-card" role="dialog" aria-modal="true" aria-label="预览选项">
              <div class="ld-settings-head">
                <div class="ld-settings-title">预览选项</div>
                <button class="ld-settings-close" type="button" aria-label="关闭预览选项">关闭</button>
              </div>
              <label class="ld-setting-field">
                <span class="ld-setting-label">预览模式</span>
                <select class="ld-setting-control" data-setting="previewMode">
                  <option value="auto">自动（推荐）</option>
                  <option value="smart">智能预览</option>
                  <option value="iframe">整页模式</option>
                </select>
              </label>
              <label class="ld-setting-field">
                <span class="ld-setting-label">内容范围</span>
                <select class="ld-setting-control" data-setting="postMode">
                  <option value="all">完整主题</option>
                  <option value="first">仅首帖</option>
                </select>
              </label>
              <label class="ld-setting-field" data-setting-group="postBodyFontSize">
                <div class="ld-setting-row">
                  <span class="ld-setting-label">正文字号</span>
                  <span class="ld-setting-value" data-setting-value="postBodyFontSize">15px</span>
                </div>
                <input
                  class="ld-setting-range"
                  type="range"
                  min="${POST_BODY_FONT_SIZE_MIN}"
                  max="${POST_BODY_FONT_SIZE_MAX}"
                  step="1"
                  data-setting="postBodyFontSize"
                />
                <span class="ld-setting-hint" data-setting-hint="postBodyFontSize">只调整帖子正文和代码字号，不影响标题和按钮</span>
              </label>
              <label class="ld-setting-field">
                <span class="ld-setting-label">作者过滤</span>
                <select class="ld-setting-control" data-setting="authorFilter">
                  <option value="all">全部作者</option>
                  <option value="topicOwner">只看楼主</option>
                </select>
                <span class="ld-setting-hint">只在智能预览里过滤显示，不影响原帖内容</span>
              </label>
              <label class="ld-setting-field">
                <span class="ld-setting-label">回复排序</span>
                <select class="ld-setting-control" data-setting="replyOrder">
                  <option value="default">默认顺序</option>
                  <option value="latestFirst">首帖 + 最新回复</option>
                </select>
                <span class="ld-setting-hint">长帖下会优先显示最新一批回复，不代表把整帖一次性完整倒序</span>
              </label>
              <label class="ld-setting-field">
                <span class="ld-setting-label">悬浮回复入口</span>
                <select class="ld-setting-control" data-setting="floatingReplyButton">
                  <option value="off">关闭</option>
                  <option value="on">开启</option>
                </select>
                <span class="ld-setting-hint">开启后在智能预览和整页模式中都显示右侧悬浮快捷回复入口</span>
              </label>
              <label class="ld-setting-field">
                <span class="ld-setting-label">阅读状态</span>
                <select class="ld-setting-control" data-setting="trackPreviewVisit">
                  <option value="on">同步实际阅读进度</option>
                  <option value="off">不同步阅读进度</option>
                </select>
                <span class="ld-setting-hint">仅上报前台实际阅读的楼层；预取不计已读。阅读末楼可能推进整帖已读位置，整页模式由原网页处理</span>
              </label>
              <label class="ld-setting-field">
                <span class="ld-setting-label">抽屉模式</span>
                <select class="ld-setting-control" data-setting="drawerMode">
                  <option value="push">挤压模式</option>
                  <option value="overlay">浮层模式</option>
                </select>
                <span class="ld-setting-hint">浮层模式下抽屉悬浮于页面上方，不压缩原有内容</span>
              </label>
              <label class="ld-setting-field">
                <span class="ld-setting-label">信任等级悬浮框</span>
                <select class="ld-setting-control" data-setting="showTrustStatus">
                  <option value="on">显示</option>
                  <option value="off">隐藏</option>
                </select>
                <span class="ld-setting-hint">隐藏后停止自动获取等级数据</span>
              </label>
              <label class="ld-setting-field">
                <span class="ld-setting-label">宽屏帖子列表靠左</span>
                <select class="ld-setting-control" data-setting="listAlignLeft">
                  <option value="off">保持原站布局</option>
                  <option value="on">开启</option>
                </select>
                <span class="ld-setting-hint">宽屏帖子列表和搜索页靠左；原站边栏正常展开收起，独立于抽屉开关和悬浮或挤压模式</span>
              </label>
              <label class="ld-setting-field">
                <span class="ld-setting-label">抽屉宽度</span>
                <select class="ld-setting-control" data-setting="drawerWidth">
                  <option value="narrow">窄</option>
                  <option value="medium">中</option>
                  <option value="wide">宽</option>
                  <option value="custom">自定义</option>
                </select>
                <span class="ld-setting-hint">也可以直接拖动抽屉左边边缘</span>
              </label>
              <button class="ld-settings-reset" type="button">恢复默认</button>
            </div>
          </div>
          <section class="ld-topic-search-panel" id="ld-topic-search" aria-label="帖内搜索" hidden>
            <form class="ld-topic-search-form" role="search" aria-label="搜索当前帖子">
              <input class="ld-topic-search-input" type="search" aria-label="帖内搜索关键词" placeholder="搜索当前帖子全部楼层" required />
              <button class="ld-reply-action" type="submit">搜索</button>
              <button class="ld-reply-action ld-topic-search-close" type="button" aria-label="关闭帖内搜索">关闭</button>
            </form>
            <div class="ld-topic-search-status" role="status"></div>
            <div class="ld-topic-search-results"></div>
            <div class="ld-topic-search-pages">
              <button class="ld-reply-action" type="button" data-search-page="prev" hidden>上一页</button>
              <button class="ld-reply-action" type="button" data-search-page="next" hidden>下一页</button>
            </div>
          </section>
          <div class="ld-drawer-body">
            <div class="ld-drawer-content"></div>
          </div>
          <button class="ld-drawer-reply-fab ld-drawer-top-fab ld-drawer-refresh" type="button" aria-label="刷新当前帖子" title="刷新当前帖子" hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.5"/></svg>
          </button>
          <button class="ld-drawer-reply-fab ld-drawer-top-fab ld-drawer-search" type="button" aria-label="帖内搜索" title="帖内搜索" aria-expanded="false" aria-controls="ld-topic-search" hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>
          </button>
          <button class="ld-drawer-reply-fab ld-drawer-top-fab ld-drawer-back-top" type="button" aria-label="回到顶部" title="回到顶部">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 4h14M12 20V8m-6 6 6-6 6 6"/></svg>
          </button>
          <button class="ld-drawer-reply-fab ld-drawer-top-fab ld-drawer-go-bottom" type="button" aria-label="跳到最新回复" title="跳到最新回复">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 20h14M12 4v12m-6-6 6 6 6-6"/></svg>
          </button>
          <button class="ld-drawer-reply-fab ld-drawer-reply-trigger" type="button" aria-expanded="false" aria-controls="ld-drawer-reply-panel" aria-label="回复当前主题" title="回复当前主题">
            <span class="ld-drawer-reply-fab-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M4 12.5c0-4.14 3.36-7.5 7.5-7.5h7a1.5 1.5 0 0 1 0 3h-7A4.5 4.5 0 0 0 7 12.5v1.38l1.44-1.44a1.5 1.5 0 0 1 2.12 2.12l-4 4a1.5 1.5 0 0 1-2.12 0l-4-4a1.5 1.5 0 1 1 2.12-2.12L4 13.88V12.5Z" fill="currentColor"></path>
              </svg>
            </span>
            <span class="ld-drawer-reply-fab-label">回复</span>
          </button>
          <div class="ld-drawer-reply-panel" id="ld-drawer-reply-panel" hidden>
            <div class="ld-reply-panel-head">
              <div class="ld-reply-panel-title">回复主题</div>
              <button class="ld-reply-panel-close" type="button" aria-label="关闭快速回复">关闭</button>
            </div>
            <textarea class="ld-reply-textarea" rows="7" placeholder="写点什么... 支持 Markdown，可直接粘贴图片自动上传。Ctrl+Enter 或 Cmd+Enter 可发送"></textarea>
            <div class="ld-reply-status" aria-live="polite"></div>
            <div class="ld-reply-actions">
              <button class="ld-reply-action" type="button" data-action="cancel">取消</button>
              <button class="ld-reply-action ld-reply-action-primary" type="button" data-action="submit">发送回复</button>
            </div>
          </div>
        </div>
      </div>
    `;

    const imagePreviewRoot = document.createElement("div");
    imagePreviewRoot.id = IMAGE_PREVIEW_ROOT_ID;
    imagePreviewRoot.setAttribute("aria-hidden", "true");
    imagePreviewRoot.innerHTML = `
      <div class="ld-image-preview" hidden aria-hidden="true">
        <button class="ld-image-preview-close" type="button" aria-label="关闭图片预览">关闭</button>
        <div class="ld-image-preview-stage">
          <img class="ld-image-preview-image" alt="图片预览" />
        </div>
      </div>
    `;

    root.prepend(root.querySelector(".ld-drawer-header-top"));
    document.body.append(root, imagePreviewRoot);

    state.root = root;
    state.header = root.querySelector(".ld-drawer-header");
    state.title = root.querySelector(".ld-drawer-title");
    state.meta = root.querySelector(".ld-drawer-meta");
    state.replyPanelMain = root.querySelector(".ld-drawer-main");
    state.drawerBody = root.querySelector(".ld-drawer-body");
    state.content = root.querySelector(".ld-drawer-content");
    state.replyToggleButton = root.querySelector(".ld-drawer-reply-toggle");
    state.replyFabButton = root.querySelector(".ld-drawer-reply-fab.ld-drawer-reply-trigger");
    state.topFabButton = root.querySelector(".ld-drawer-back-top");
    state.bottomFabButton = root.querySelector(".ld-drawer-go-bottom");
    state.replyPanel = root.querySelector(".ld-drawer-reply-panel");
    state.replyPanelHead = root.querySelector(".ld-reply-panel-head");
    state.replyPanelTitle = root.querySelector(".ld-reply-panel-title");
    state.replyTextarea = root.querySelector(".ld-reply-textarea");
    state.replySubmitButton = root.querySelector('[data-action="submit"]');
    state.replyCancelButton = root.querySelector('[data-action="cancel"]');
    state.replyStatus = root.querySelector(".ld-reply-status");
    state.imagePreviewRoot = imagePreviewRoot;
    state.imagePreview = imagePreviewRoot.querySelector(".ld-image-preview");
    state.imagePreviewImage = imagePreviewRoot.querySelector(".ld-image-preview-image");
    state.imagePreviewCloseButton = imagePreviewRoot.querySelector(".ld-image-preview-close");
    state.openInTab = root.querySelector(".ld-drawer-link");
    state.settingsPanel = root.querySelector(".ld-drawer-settings");
    state.settingsCard = root.querySelector(".ld-drawer-settings-card");
    state.postBodyFontSizeField = root.querySelector('[data-setting-group="postBodyFontSize"]');
    state.postBodyFontSizeControl = root.querySelector('[data-setting="postBodyFontSize"]');
    state.postBodyFontSizeValue = root.querySelector('[data-setting-value="postBodyFontSize"]');
    state.postBodyFontSizeHint = root.querySelector('[data-setting-hint="postBodyFontSize"]');
    state.settingsCloseButton = root.querySelector(".ld-settings-close");
    state.settingsToggle = root.querySelector(".ld-drawer-settings-toggle");
    state.latestRepliesRefreshButton = root.querySelector(".ld-drawer-refresh");
    state.topicSearchButton = root.querySelector(".ld-drawer-search");
    state.topicSearchPanel = root.querySelector(".ld-topic-search-panel");
    state.topicSearchInput = root.querySelector(".ld-topic-search-input");
    state.topicSearchStatus = root.querySelector(".ld-topic-search-status");
    state.topicSearchResults = root.querySelector(".ld-topic-search-results");
    state.prevButton = root.querySelector('[data-nav="prev"]');
    state.nextButton = root.querySelector('[data-nav="next"]');
    state.resizeHandle = root.querySelector(".ld-drawer-resize-handle");
    state.toastStack = root.querySelector(".ld-toast-stack");

    state.headerLayoutObserver = new ResizeObserver(syncNativeHeaderLayout);
    state.headerLayoutObserver.observe(root.querySelector(".ld-drawer-header-actions"));
    const nativeHeader = document.querySelector(".d-header");
    if (nativeHeader) state.headerLayoutObserver.observe(nativeHeader);

    root.querySelector(".ld-drawer-close").addEventListener("click", closeDrawer);
    state.prevButton.addEventListener("click", () => navigateTopic(-1));
    state.nextButton.addEventListener("click", () => navigateTopic(1));
    state.topFabButton.addEventListener("click", () => {
      state.drawerBody.scrollTo({ top: 0, behavior: "instant" });
    });
    state.bottomFabButton.addEventListener("click", handleJumpToLatestPost);
    state.settingsToggle.addEventListener("click", toggleSettingsPanel);
    state.latestRepliesRefreshButton.addEventListener("click", handleLatestRepliesRefresh);
    state.topicSearchButton.addEventListener("click", () => setTopicSearchOpen(state.topicSearchPanel.hidden));
    root.querySelector(".ld-topic-search-close").addEventListener("click", () => setTopicSearchOpen(false));
    root.querySelector(".ld-topic-search-form").addEventListener("submit", (event) => {
      event.preventDefault();
      searchCurrentTopic(state.topicSearchInput.value.trim());
    });
    root.querySelectorAll("[data-search-page]").forEach((button) => {
      button.addEventListener("click", () => searchCurrentTopic(
        state.topicSearchQuery, state.topicSearchPage + (button.dataset.searchPage === "next" ? 1 : -1)
      ));
    });
    state.replyToggleButton.addEventListener("click", toggleReplyPanel);
    state.replyFabButton.addEventListener("click", toggleReplyPanel);
    state.replyCancelButton.addEventListener("click", () => setReplyPanelOpen(false));
    state.replySubmitButton.addEventListener("click", handleReplySubmit);
    root.querySelector(".ld-reply-panel-close").addEventListener("click", () => setReplyPanelOpen(false));
    state.replyTextarea.addEventListener("keydown", handleReplyTextareaKeydown);
    state.replyTextarea.addEventListener("paste", handleReplyTextareaPaste);
    state.replyPanelHead.addEventListener("pointerdown", startReplyPanelDrag);
    root.addEventListener("click", handleDrawerRootClick);
    root.addEventListener("wheel", handleDrawerRootWheel, { passive: false });
    imagePreviewRoot.addEventListener("click", handleImagePreviewClick);
    imagePreviewRoot.addEventListener("wheel", handleImagePreviewWheel, { passive: false });
    state.drawerBody.addEventListener("scroll", handleDrawerBodyScroll, { passive: true });
    state.settingsPanel.addEventListener("click", handleSettingsPanelClick);
    state.settingsPanel.addEventListener("input", handleSettingsInput);
    state.settingsPanel.addEventListener("change", handleSettingsChange);
    state.settingsCloseButton.addEventListener("click", () => setSettingsPanelOpen(false));
    state.settingsPanel.querySelector(".ld-settings-reset").addEventListener("click", resetSettings);
    state.resizeHandle.addEventListener("pointerdown", startDrawerResize);

    syncSettingsUI();
    applyPostBodyFontSize();
    applyDrawerWidth();
    applyDrawerMode();
    syncNavigationState();
    syncLatestRepliesRefreshUI();
    syncReplyUI();
    updateSettingsPopoverPosition();
  }

  function bindEvents() {
    document.addEventListener("click", handleDocumentClick, true);
    document.addEventListener("keydown", handleKeydown, true);
    document.addEventListener("pointermove", handleDrawerResizeMove, true);
    document.addEventListener("pointerup", stopDrawerResize, true);
    document.addEventListener("pointercancel", stopDrawerResize, true);
    document.addEventListener("pointermove", handleReplyPanelDragMove, true);
    document.addEventListener("pointerup", stopReplyPanelDrag, true);
    document.addEventListener("pointercancel", stopReplyPanelDrag, true);
    window.addEventListener("resize", handleWindowResize, true);
    window.addEventListener("scroll", handleWindowScroll, { capture: true, passive: true });
  }

  function handleDocumentClick(event) {
    if (event.defaultPrevented) {
      return;
    }

    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    if (state.suppressReplyPanelClick) {
      state.suppressReplyPanelClick = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const link = target.closest("a[href]");
    const topicUrl = getTopicUrlFromLink(link);
    if (!topicUrl && (target.closest(NATIVE_OVERLAY_SELECTOR) || target.closest(".d-header-wrap, .sidebar-wrapper"))) {
      return;
    }

    if (!state.imagePreview?.hidden && target.closest(`#${IMAGE_PREVIEW_ROOT_ID}`)) {
      return;
    }

    if (!state.settingsPanel?.hidden && !target.closest(".ld-drawer-settings-card") && !target.closest(".ld-drawer-settings-toggle")) {
      setSettingsPanelOpen(false);
    }

    if (!state.replyPanel?.hidden && !target.closest(".ld-drawer-reply-panel") && !target.closest(".ld-drawer-reply-trigger")) {
      setReplyPanelOpen(false);
    }

    if (!target.closest(".ld-flag-wrap") && !target.closest(".ld-post-react-wrap") && !target.closest(".ld-post-replies-stat-wrap")) {
      closeAllPopovers();
    }

    if (handleTopicTrackerClick(target)) {
      return;
    }

    if (topicUrl) {
      event.preventDefault();
      event.stopPropagation();
      if (link.closest(".user-menu.menu-panel")) {
        document.querySelector(".d-header .current-user button")?.click();
      }
      // 交由原站收起搜索下拉框，保留搜索词及再次展开能力。
      link.closest(".search-menu")?.querySelector(".search-term__input")?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true })
      );
      openDrawer(topicUrl, link.textContent.trim(), link);
      return;
    }

    if (
      state.settings.drawerMode === "overlay" &&
      document.body.classList.contains(PAGE_OPEN_CLASS) &&
      !target.closest(`#${ROOT_ID}`)
    ) {
      event.preventDefault();
      event.stopPropagation();
      closeDrawer();
      return;
    }
  }

  function hasNativeOverlay() {
    return [...document.querySelectorAll(NATIVE_OVERLAY_SELECTOR)].some((element) =>
      element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden"
    );
  }

  function handleKeydown(event) {
    if (hasNativeOverlay()) {
      return;
    }

    if (event.key === "Escape" && !state.imagePreview?.hidden) {
      event.preventDefault();
      event.stopPropagation();
      closeImagePreview();
      return;
    }

    if (
      event.key === "Escape" &&
      state.root?.querySelector(
        ".ld-reactions-popover:not([hidden]), .ld-flag-popover:not([hidden]), .ld-post-replies-popover:not([hidden])"
      )
    ) {
      event.preventDefault();
      event.stopPropagation();
      closeAllPopovers();
      return;
    }

    if (event.key === "Escape" && !state.settingsPanel?.hidden) {
      event.preventDefault();
      event.stopPropagation();
      setSettingsPanelOpen(false);
      return;
    }

    if (event.key === "Escape" && !state.replyPanel?.hidden) {
      event.preventDefault();
      event.stopPropagation();
      setReplyPanelOpen(false);
      return;
    }

    if (event.key === "Escape" && state.topicSearchPanel && !state.topicSearchPanel.hidden) {
      event.preventDefault();
      event.stopPropagation();
      setTopicSearchOpen(false);
      return;
    }

    if (isTypingTarget(event.target)) {
      return;
    }

    if (event.key === "Escape" && document.body.classList.contains(PAGE_OPEN_CLASS)) {
      closeDrawer();
      return;
    }

    if (!document.body.classList.contains(PAGE_OPEN_CLASS)) {
      return;
    }

    if (event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
      if (event.key === "ArrowUp") {
        event.preventDefault();
        navigateTopic(-1);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        navigateTopic(1);
      }
    }
  }

  function getTopicUrlFromLink(link) {
    if (!(link instanceof HTMLAnchorElement)) {
      return null;
    }

    if (link.target && link.target !== "_self") {
      return null;
    }

    if (link.hasAttribute("download")) {
      return null;
    }

    if (link.closest(`#${ROOT_ID}`)) {
      return null;
    }

    // 通知菜单和原站搜索结果可能位于主内容区之外；搜索菜单还带有 menu-panel。
    const isSearchResult = link.matches("a.search-link") && link.closest(".search-menu, .search-results");
    if (!link.closest(".user-menu.menu-panel") && !isSearchResult && (
      !link.closest(MAIN_CONTENT_SELECTOR) ||
      link.closest(EXCLUDED_LINK_CONTEXT_SELECTOR) ||
      !isPrimaryTopicLink(link)
    )) {
      return null;
    }

    let url;

    try {
      url = new URL(link.href, location.href);
    } catch {
      return null;
    }

    if (url.origin !== location.origin || !url.pathname.startsWith("/t/")) {
      return null;
    }

    return normalizeTopicUrl(url);
  }

  function getTopicCacheKey(topicUrl) {
    return getTopicTrackingKey(topicUrl);
  }

  function initPreviewAcceleration() {
    if (typeof IntersectionObserver === "function") {
      state.prefetchObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            state.prefetchVisible.add(entry.target);
          } else {
            state.prefetchVisible.delete(entry.target);
            state.prefetchAttempted.delete(entry.target);
          }
        }
      });
      queuePrefetchScan();
      setInterval(runTopicPrefetch, 500);
    }
    setInterval(tickReading, 1000);
    const pause = () => {
      if (!state.reading) return;
      state.reading.onscreen.clear();
      state.reading.lastTick = performance.now();
      flushReading(state.reading);
    };
    document.addEventListener("visibilitychange", pause);
    window.addEventListener("blur", pause);
    window.addEventListener("focus", () => {
      if (state.reading) state.reading.lastActivity = performance.now();
      pause();
    });
    window.addEventListener("pagehide", () => {
      state.previewPageHidden = true;
      setTopicSearchOpen(false);
      stopReading();
      state.abortController?.abort();
      state.abortController = null;
      cancelLoadMoreRequest();
      cancelDirectRepliesRequest();
      for (const request of state.prefetchRequests.values()) request.controller.abort();
    });
    window.addEventListener("pageshow", () => {
      state.previewPageHidden = false;
      queuePrefetchScan();
      if (state.currentUrl && !state.currentTopic) {
        loadTopic(state.currentUrl, state.currentFallbackTitle, state.currentTopicIdHint);
      } else {
        startReading();
      }
    });
  }

  function queuePrefetchScan() {
    if (!state.prefetchObserver || state.prefetchScanTimer) return;
    state.prefetchScanTimer = window.setTimeout(() => {
      state.prefetchScanTimer = 0;
      for (const link of state.prefetchObserved) {
        if (!link.isConnected) {
          state.prefetchObserver.unobserve(link);
          state.prefetchObserved.delete(link);
          state.prefetchVisible.delete(link);
        }
      }
      document.querySelector(MAIN_CONTENT_SELECTOR)?.querySelectorAll(PRIMARY_TOPIC_LINK_SELECTOR).forEach((link) => {
        if (!state.prefetchObserved.has(link) && getTopicUrlFromLink(link)) {
          state.prefetchObserved.add(link);
          state.prefetchObserver.observe(link);
        }
      });
    }, 80);
  }

  function runTopicPrefetch() {
    const now = Date.now();
    if (document.hidden || state.previewPageHidden || state.settings.previewMode === "iframe" ||
        state.abortController || state.loadMoreAbortController || state.prefetchRequests.size >= 2 ||
        now < state.prefetchNextAt || now < state.prefetchPausedUntil) return;
    pruneTopicCache();
    for (const link of state.prefetchVisible) {
      if (!link.isConnected) continue;
      const url = getTopicUrlFromLink(link);
      const topicId = url && getTopicIdFromUrl(url);
      const key = url && getTopicCacheKey(url);
      if (state.prefetchAttempted.get(link) === key) continue;
      if (!Number.isSafeInteger(topicId) || topicId < 1 || state.topicCache.has(key) || state.prefetchRequests.has(key)) continue;
      const rect = link.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.top >= window.innerHeight ||
          rect.right <= 0 || rect.left >= window.innerWidth) continue;
      state.prefetchAttempted.set(link, key);
      state.prefetchNextAt = now + 500;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const promise = fetchTrackedTopicJson(url, controller.signal, topicId, { canonical: true, trackVisit: false })
        .then((topic) => {
          if (controller.signal.aborted) return null;
          if (topic?.id !== topicId || !Array.isArray(topic.post_stream?.posts) || !topic.post_stream.posts.length) {
            throw new Error("Invalid topic preview");
          }
          if (!state.topicCache.has(key)) {
            state.topicCache.set(key, { topic, fetchedAt: Date.now(), cachedAt: Date.now(), views: new Map(), currentViewTracked: false });
            pruneTopicCache();
          }
          return topic;
        }).catch(() => {
          // 失败后暂停一段时间，避免后台请求持续占用站点额度。
          state.prefetchPausedUntil = Date.now() + 60000;
          return null;
        }).finally(() => {
          clearTimeout(timeout);
          state.prefetchRequests.delete(key);
        });
      state.prefetchRequests.set(key, { controller, promise });
      return;
    }
  }

  function canTrackReading() {
    return state.settings.trackPreviewVisit === "on" && !state.previewPageHidden &&
      !document.hidden && document.hasFocus() && Boolean(document.querySelector("#current-user")) && Boolean(getCsrfToken()) &&
      document.body.classList.contains(PAGE_OPEN_CLASS) && state.currentTopic &&
      !state.currentTopic.__sidePeekIframeShell && !state.root?.classList.contains(IFRAME_MODE_CLASS) &&
      state.settingsPanel?.hidden !== false && state.replyPanel?.hidden !== false && state.imagePreview?.hidden !== false &&
      !hasNativeOverlay();
  }

  function startReading() {
    if (!state.currentTopic || state.currentTopic.__sidePeekIframeShell || state.settings.trackPreviewVisit !== "on") return;
    const topicId = Number(state.currentTopic.id);
    if (!Number.isSafeInteger(topicId) || topicId < 1) return;
    if (state.reading?.topicId !== topicId) {
      stopReading();
      const now = performance.now();
      state.reading = { topicId, token: getCsrfToken(), timings: new Map(), totals: new Map(), onscreen: new Set(), topicTime: 0,
        lastTick: now, lastActivity: now, lastFlush: now, sending: false, closed: false, errorShown: false, nextSendAt: 0, retryTimer: 0 };
    }
    state.reading.onscreen.clear();
    state.reading.lastTick = performance.now();
  }

  function getVisibleReadingPosts() {
    const visible = new Set();
    const bounds = state.drawerBody.getBoundingClientRect();
    const top = Math.max(0, bounds.top);
    const bottom = Math.min(window.innerHeight, bounds.bottom);
    const left = Math.max(0, bounds.left);
    const right = Math.min(window.innerWidth, bounds.right);
    if (bottom <= top || right <= left) return visible;
    for (const card of state.content.querySelectorAll(".ld-topic-post-list > .ld-post-card[data-post-number]")) {
      const number = Number(card.dataset.postNumber);
      const rect = card.getBoundingClientRect();
      const visibleTop = Math.max(top, rect.top);
      const visibleBottom = Math.min(bottom, rect.bottom);
      const visibleLeft = Math.max(left, rect.left);
      const visibleRight = Math.min(right, rect.right);
      if (!Number.isSafeInteger(number) || number < 1 || rect.height <= 0 || visibleRight <= visibleLeft ||
          visibleBottom - visibleTop < Math.min(rect.height, bottom - top) / 2) continue;
      const hit = document.elementFromPoint((visibleLeft + visibleRight) / 2, (visibleTop + visibleBottom) / 2);
      if (hit && card.contains(hit)) visible.add(number);
    }
    return visible;
  }

  function tickReading() {
    const reading = state.reading;
    if (!reading) return;
    const now = performance.now();
    const elapsed = now - reading.lastTick;
    reading.lastTick = now;
    if (!canTrackReading() || now - reading.lastActivity > 180000 || elapsed <= 0 || elapsed > 2000) {
      reading.onscreen.clear();
      return;
    }
    const visible = getVisibleReadingPosts();
    let counted = false;
    for (const number of visible) {
      if (!reading.onscreen.has(number)) continue;
      const previous = reading.totals.get(number) || 0;
      const time = Math.min(Math.round(elapsed), 360000 - previous);
      if (time <= 0) continue;
      reading.timings.set(number, (reading.timings.get(number) || 0) + time);
      reading.totals.set(number, previous + time);
      counted = true;
    }
    if (counted) reading.topicTime += Math.round(elapsed);
    reading.onscreen = visible;
    if (now - reading.lastFlush >= 5000) flushReading(reading);
  }

  function stopReading() {
    const reading = state.reading;
    if (!reading) return;
    tickReading();
    state.reading = null;
    reading.closed = true;
    flushReading(reading);
  }

  async function flushReading(reading) {
    if (reading.sending) {
      reading.flushPending = true;
      return;
    }
    if (!reading.timings.size) return;
    const token = getCsrfToken();
    if (!token || token !== reading.token || !document.querySelector("#current-user")) {
      reading.timings.clear();
      reading.topicTime = 0;
      return;
    }
    const delay = reading.nextSendAt - performance.now();
    if (delay > 0) {
      if ((reading.closed || document.hidden || !document.hasFocus()) && !reading.retryTimer) {
        reading.retryTimer = setTimeout(() => {
          reading.retryTimer = 0;
          flushReading(reading);
        }, delay);
      }
      return;
    }
    const body = new URLSearchParams({ topic_id: String(reading.topicId), topic_time: String(Math.min(reading.topicTime, 60000)) });
    for (const [number, time] of reading.timings) body.set(`timings[${number}]`, String(Math.min(time, 60000)));
    reading.timings.clear();
    reading.topicTime = 0;
    reading.lastFlush = performance.now();
    reading.sending = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${location.origin}/topics/timings`, {
        method: "POST", credentials: "include", body, keepalive: true, redirect: "error", signal: controller.signal,
        headers: { "X-CSRF-Token": token, "X-Requested-With": "XMLHttpRequest", "Discourse-Background": "true", "X-SILENCE-LOGGER": "true" }
      });
      if (!response.ok || response.headers.get("content-type")?.includes("text/html")) throw new Error("Reading sync failed");
      reading.errorShown = false;
    } catch {
      reading.nextSendAt = performance.now() + 30000;
      // 上报是累加接口；网络结果不明时不重放同一批，避免重复累计阅读时间。
      if (!reading.errorShown && state.reading === reading) {
        showToast("本批阅读进度未确认同步，请检查网络或登录状态", "error");
        reading.errorShown = true;
      }
    } finally {
      clearTimeout(timeout);
      reading.sending = false;
      if (reading.closed || reading.flushPending) {
        reading.flushPending = false;
        flushReading(reading);
      }
    }
  }

  function getTopicViewKey(topicUrl) {
    return [getTopicTargetSpec(topicUrl)?.targetSegments.join("/") || "",
      state.settings.postMode, state.settings.replyOrder, state.settings.authorFilter].join(":");
  }

  function pruneTopicCache() {
    const now = Date.now();

    for (const [key, entry] of state.topicCache) {
      if (!entry || now - Number(entry.fetchedAt || entry.cachedAt || 0) > TOPIC_CACHE_TTL) {
        state.topicCache.delete(key);
      }
    }

    while (state.topicCache.size > TOPIC_CACHE_MAX_ENTRIES) {
      const oldestKey = state.topicCache.keys().next().value;
      if (!oldestKey) {
        break;
      }
      state.topicCache.delete(oldestKey);
    }
  }

  function cacheCurrentTopic() {
    if (!state.currentUrl || !state.currentTopic || state.currentTopic.__sidePeekIframeShell) {
      return;
    }

    const key = getTopicCacheKey(state.currentUrl);
    const views = state.topicCache.get(key)?.views || new Map();
    const viewKey = getTopicViewKey(state.currentUrl);
    views.delete(viewKey);
    views.set(viewKey, {
      resolvedTargetPostNumber: state.currentResolvedTargetPostNumber,
      scrollTop: state.drawerBody?.scrollTop || 0
    });
    if (views.size > TOPIC_CACHE_MAX_ENTRIES) views.delete(views.keys().next().value);
    const entry = {
      cachedAt: Date.now(),
      topic: state.currentTopic,
      latestRepliesTopic: state.currentLatestRepliesTopic,
      views,
      topicIdHint: state.currentTopicIdHint,
      fallbackTitle: state.currentFallbackTitle,
      currentViewTracked: state.currentViewTracked,
      fetchedAt: Number(state.currentTopicFetchedAt || 0)
    };

    state.topicCache.delete(key);
    state.topicCache.set(key, entry);
    pruneTopicCache();
  }

  function getCachedTopic(topicUrl) {
    pruneTopicCache();
    const key = getTopicCacheKey(topicUrl);
    const entry = state.topicCache.get(key);
    if (!entry) {
      return null;
    }

    state.topicCache.delete(key);
    state.topicCache.set(key, entry);
    return entry;
  }

  function restoreCachedTopic(entry, topicUrl, fallbackTitle, topicIdHint = null) {
    if (!entry?.topic) {
      return false;
    }

    const targetSpec = getTopicTargetSpec(topicUrl, topicIdHint);
    const view = entry.views?.get(getTopicViewKey(topicUrl));
    const savedTarget = view?.resolvedTargetPostNumber;
    const resolvedTarget = resolveTopicTargetPostNumber(targetSpec, entry.topic,
      targetSpec?.targetToken === "last" ? entry.latestRepliesTopic : null) ||
      (targetSpec?.targetToken && (topicHasPostNumber(entry.topic, savedTarget) || topicHasPostNumber(entry.latestRepliesTopic, savedTarget)) ? savedTarget : null);
    if ((shouldFetchTargetedTopic(entry.topic, targetSpec) && !resolvedTarget) ||
        (shouldLoadLatestRepliesTopic(entry.topic, targetSpec) && !entry.latestRepliesTopic)) {
      return false;
    }
    state.currentTopicIdHint = entry.topicIdHint || topicIdHint || state.currentTopicIdHint;
    state.currentViewTracked = Boolean(entry.currentViewTracked);
    state.currentTopicFetchedAt = Number(entry.fetchedAt || entry.cachedAt || 0);
    state.currentTrackRequest = null;
    state.currentTrackRequestKey = "";
    state.currentFallbackTitle = fallbackTitle || entry.fallbackTitle || "";

    renderTopic(
      entry.topic,
      topicUrl,
      state.currentFallbackTitle,
      resolvedTarget,
      {
        latestRepliesTopic: entry.latestRepliesTopic || null,
        targetSpec,
        preserveScrollTop: view?.scrollTop ?? (targetSpec?.hasTarget ? undefined : 0)
      }
    );

    return true;
  }

  function openDrawer(topicUrl, fallbackTitle, activeLink) {
    ensureDrawer();
    cacheCurrentTopic();

    const entryElement = activeLink instanceof Element
      ? getTopicEntryContainer(activeLink)
      : null;
    const topicIdHint = activeLink instanceof Element
      ? (getTopicIdHintFromLink(activeLink) || getTopicIdFromUrl(topicUrl))
      : getTopicIdFromUrl(topicUrl);
    const currentEntry = activeLink instanceof Element
      ? getTopicEntries().find((entry) => entry.link === activeLink || entry.entryElement === entryElement)
      : null;
    const nextTrackingKey = getTopicTrackingKey(topicUrl, topicIdHint);
    const isSameTrackedTopic = Boolean(state.currentTopicTrackingKey) && state.currentTopicTrackingKey === nextTrackingKey;

    state.currentEntryElement = entryElement;
    state.currentEntryKey = currentEntry?.entryKey || buildEntryKey(topicUrl, 1);
    state.currentTopicIdHint = topicIdHint;
    if (!isSameTrackedTopic) {
      state.currentViewTracked = false;
      state.currentTrackRequest = null;
      state.currentTrackRequestKey = "";
    }
    state.currentTopicTrackingKey = nextTrackingKey;

    if (state.currentUrl === topicUrl && document.body.classList.contains(PAGE_OPEN_CLASS)) {
      highlightLink(activeLink);
      syncNavigationState();

      if (shouldRefreshCurrentTopicOnRepeatOpen()) {
        handleLatestRepliesRefresh();
        return;
      }

      if ((!state.currentTopic || state.currentTopic.__sidePeekIframeShell) &&
          state.settings.previewMode !== "iframe" && !state.abortController) {
        loadTopic(topicUrl, fallbackTitle, topicIdHint);
      } else {
        trackCurrentTopicVisit();
      }

      return;
    }

    if (!isSameTrackedTopic) setTopicSearchOpen(false);
    stopReading();
    state.abortController?.abort();
    state.abortController = null;
    cancelLoadMoreRequest();
    cancelDirectRepliesRequest();
    const cachedTopic = state.settings.previewMode === "iframe"
      ? null
      : getCachedTopic(topicUrl);

    state.currentUrl = topicUrl;
    state.currentFallbackTitle = fallbackTitle || "";
    state.currentResolvedTargetPostNumber = null;
    state.currentTargetSpec = null;
    state.currentTopic = null;
    state.currentLatestRepliesTopic = null;
    state.currentTopicFetchedAt = 0;
    state.drawerBody.scrollTop = 0;
    state.directReplyCache.clear();
    state.deferOwnerFilterAutoLoad = false;
    state.loadMoreError = "";
    state.isLoadingMorePosts = false;
    state.isRefreshingLatestReplies = false;
    resetReplyComposer();
    state.title.textContent = fallbackTitle || "加载中…";
    state.meta.textContent = cachedTopic ? "正在恢复上次预览…" : "正在载入帖子内容…";
    state.openInTab.href = topicUrl;

    if (!cachedTopic) {
      state.content.innerHTML = renderLoading();
    }

    highlightLink(activeLink);
    syncNavigationState();

    document.body.classList.add(PAGE_OPEN_CLASS);
    state.root.setAttribute("aria-hidden", "false");
    setIframeModeEnabled(state.settings.previewMode === "iframe");
    applyDrawerMode();
    updateSettingsPopoverPosition();
    scheduleTopicTrackerPositionSync();
    syncLatestRepliesRefreshUI();

    if (cachedTopic && restoreCachedTopic(cachedTopic, topicUrl, fallbackTitle, topicIdHint)) {
      const cacheAge = Date.now() - Number(cachedTopic.fetchedAt || cachedTopic.cachedAt || 0);
      if (cacheAge >= TOPIC_CACHE_BACKGROUND_REFRESH_AGE) {
        queueMicrotask(() => {
          if (state.currentUrl !== topicUrl || !document.body.classList.contains(PAGE_OPEN_CLASS)) {
            return;
          }

          loadTopic(topicUrl, fallbackTitle, topicIdHint, {
            preserveScrollTop: state.drawerBody?.scrollTop || 0
          });
        });
      }
      return;
    }

    if (cachedTopic) state.content.innerHTML = renderLoading();
    loadTopic(topicUrl, fallbackTitle, topicIdHint, {
      cachedTopic,
      preserveScrollTop: cachedTopic?.views?.get(getTopicViewKey(topicUrl))?.scrollTop
    });
  }

  function closeDrawer() {
    setTopicSearchOpen(false);
    stopReading();
    cacheCurrentTopic();

    if (state.abortController) {
      state.abortController.abort();
      state.abortController = null;
    }

    cancelLoadMoreRequest();
    cancelDirectRepliesRequest();
    cancelReplyRequest();

    document.body.classList.remove(PAGE_OPEN_CLASS);
    document.body.classList.remove("ld-drawer-mode-overlay");
    setIframeModeEnabled(false);
    state.root?.setAttribute("aria-hidden", "true");
    state.currentUrl = "";
    state.currentEntryElement = null;
    state.currentEntryKey = "";
    state.currentTopicIdHint = null;
    state.currentTopicTrackingKey = "";
    state.currentViewTracked = false;
    state.currentTrackRequest = null;
    state.currentTrackRequestKey = "";
    state.currentResolvedTargetPostNumber = null;
    state.currentFallbackTitle = "";
    state.currentTopic = null;
    state.currentLatestRepliesTopic = null;
    state.currentTopicFetchedAt = 0;
    state.directReplyCache.clear();
    state.currentTargetSpec = null;
    state.deferOwnerFilterAutoLoad = false;
    state.isRefreshingLatestReplies = false;
    state.meta.textContent = "";
    state.loadMoreError = "";
    state.isLoadingMorePosts = false;
    resetReplyComposer();
    closeImagePreview();
    clearHighlight();
    setSettingsPanelOpen(false);
    syncNavigationState();
    syncLatestRepliesRefreshUI();
    scheduleTopicTrackerPositionSync();
  }

  function handleTopicTrackerClick(target) {
    const clickable = getTopicTrackerClickable(target);
    if (!clickable) {
      return false;
    }

    armTopicTrackerRefreshSync();
    return true;
  }

  function getTopicTrackerClickable(target = document) {
    if (!(target instanceof Element) && !(target instanceof Document)) {
      return null;
    }

    const clickable = target instanceof Document
      ? target.querySelector(TOPIC_TRACKER_CLICKABLE_SELECTOR)
      : target.closest(TOPIC_TRACKER_CLICKABLE_SELECTOR);

    if (!(clickable instanceof Element)) {
      return null;
    }

    return clickable;
  }

  function getTopicTrackerAlignmentTarget() {
    return document.querySelector(TOPIC_TRACKER_VERTICAL_SELECTOR)
      || document.querySelector(".list-controls")
      || document.querySelector(MAIN_CONTENT_SELECTOR);
  }

  function armTopicTrackerRefreshSync() {
    clearTopicTrackerRefreshSync();
    state.topicTrackerRefreshStartedAt = Date.now();
    state.topicTrackerRefreshLoadingObserved = isTopicTrackerLoading();
    scrollDiscoveryContentToTop();
    scheduleTopicTrackerPositionSync();
    runTopicTrackerRefreshSync();
  }

  function runTopicTrackerRefreshSync() {
    if (state.topicTrackerRefreshTimer) {
      clearTimeout(state.topicTrackerRefreshTimer);
    }

    scrollDiscoveryContentToTop();

    const loading = isTopicTrackerLoading();
    const trackerVisible = Boolean(getTopicTrackerClickable());

    if (loading) {
      state.topicTrackerRefreshLoadingObserved = true;
    }

    const refreshFinished =
      state.topicTrackerRefreshLoadingObserved && !loading;
    const timeoutReached =
      Date.now() - state.topicTrackerRefreshStartedAt > 2500;

    if (refreshFinished || !trackerVisible || timeoutReached) {
      scrollDiscoveryContentToTop();
      requestAnimationFrame(() => scrollDiscoveryContentToTop());
      window.setTimeout(() => scrollDiscoveryContentToTop(), 80);
      clearTopicTrackerRefreshSync();
      return;
    }

    state.topicTrackerRefreshTimer = window.setTimeout(
      runTopicTrackerRefreshSync,
      loading ? 80 : 140
    );
  }

  function clearTopicTrackerRefreshSync() {
    if (state.topicTrackerRefreshTimer) {
      clearTimeout(state.topicTrackerRefreshTimer);
      state.topicTrackerRefreshTimer = 0;
    }

    state.topicTrackerRefreshStartedAt = 0;
    state.topicTrackerRefreshLoadingObserved = false;
  }

  function isTopicTrackerLoading() {
    return Boolean(getTopicTrackerClickable()?.classList.contains("loading"));
  }

  function scrollDiscoveryContentToTop() {
    const scrollingElement = document.scrollingElement || document.documentElement;
    const scrollTop = 0;
    const html = document.documentElement;
    const body = document.body;
    const previousHtmlBehavior = html.style.scrollBehavior;
    const previousBodyBehavior = body.style.scrollBehavior;

    html.style.scrollBehavior = "auto";
    body.style.scrollBehavior = "auto";
    window.scrollTo(0, scrollTop);
    scrollingElement.scrollTop = scrollTop;
    html.scrollTop = scrollTop;
    body.scrollTop = scrollTop;
    requestAnimationFrame(() => {
      window.scrollTo(0, scrollTop);
      scrollingElement.scrollTop = scrollTop;
      html.scrollTop = scrollTop;
      body.scrollTop = scrollTop;
    });

    requestAnimationFrame(() => {
      html.style.scrollBehavior = previousHtmlBehavior;
      body.style.scrollBehavior = previousBodyBehavior;
    });
  }

  function highlightLink(link) {
    clearHighlight();
    state.activeLink = link;
    state.activeLink?.classList.add(ACTIVE_LINK_CLASS);
    syncNavigationState();
  }

  function clearHighlight() {
    state.activeLink?.classList.remove(ACTIVE_LINK_CLASS);
    state.activeLink = null;
  }

  function getTopicEntries() {
    const entries = [];
    const seen = new WeakSet();
    const duplicateCounts = new Map();
    const mainContent = document.querySelector(MAIN_CONTENT_SELECTOR);

    if (!(mainContent instanceof Element)) {
      return entries;
    }

    for (const link of mainContent.querySelectorAll(PRIMARY_TOPIC_LINK_SELECTOR)) {
      if (!(link instanceof HTMLAnchorElement)) {
        continue;
      }

      const url = getTopicUrlFromLink(link);
      if (!url) {
        continue;
      }

      const entryElement = getTopicEntryContainer(link);
      if (seen.has(entryElement)) {
        continue;
      }

      seen.add(entryElement);
      const occurrence = (duplicateCounts.get(url) || 0) + 1;
      duplicateCounts.set(url, occurrence);
      entries.push({
        entryElement,
        entryKey: buildEntryKey(url, occurrence),
        topicIdHint: getTopicIdHintFromLink(link) || getTopicIdFromUrl(url),
        url,
        title: link.textContent.trim() || url,
        link
      });
    }

    return entries;
  }

  function resolveCurrentEntryIndex(entries) {
    if (!Array.isArray(entries) || !entries.length) {
      return -1;
    }

    if (state.currentEntryKey) {
      const indexByKey = entries.findIndex((entry) => entry.entryKey === state.currentEntryKey);
      if (indexByKey !== -1) {
        return indexByKey;
      }
    }

    if (state.currentEntryElement) {
      const indexByElement = entries.findIndex((entry) => entry.entryElement === state.currentEntryElement);
      if (indexByElement !== -1) {
        return indexByElement;
      }
    }

    return entries.findIndex((entry) => entry.url === state.currentUrl);
  }

  function syncNavigationState() {
    if (!state.prevButton || !state.nextButton) {
      return;
    }

    const entries = getTopicEntries();
    const currentIndex = resolveCurrentEntryIndex(entries);
    const hasDrawerOpen = Boolean(state.currentUrl);

    state.prevButton.disabled = !hasDrawerOpen || currentIndex <= 0;
    state.nextButton.disabled = !hasDrawerOpen || currentIndex === -1 || currentIndex >= entries.length - 1;
  }

  function navigateTopic(offset) {
    const entries = getTopicEntries();
    const currentIndex = resolveCurrentEntryIndex(entries);
    const nextEntry = currentIndex === -1 ? null : entries[currentIndex + offset];

    if (!nextEntry) {
      syncNavigationState();
      return;
    }

    nextEntry.link.scrollIntoView({ block: "nearest" });
    openDrawer(nextEntry.url, nextEntry.title, nextEntry.link);
  }

  async function loadTopic(topicUrl, fallbackTitle, topicIdHint = null, options = {}) {
    closeImagePreview();
    cancelLoadMoreRequest();
    cancelDirectRepliesRequest();
    state.isLoadingMorePosts = false;
    state.loadMoreError = "";

    if (state.abortController) {
      state.abortController.abort();
      state.abortController = null;
    }

    if (state.settings.previewMode === "iframe") {
      renderIframeFallback(topicUrl, fallbackTitle, null, true);
      syncLatestRepliesRefreshUI();
      return;
    }

    if (!state.currentViewTracked) {
      state.currentTrackRequest = null;
      state.currentTrackRequestKey = "";
    }

    const controller = new AbortController();
    state.abortController = controller;

    try {
      const targetSpec = getTopicTargetSpec(topicUrl, topicIdHint);
      let resolvedTargetPostNumber = null;
      let topic;
      let targetedTopic = null;
      let latestRepliesTopic = null;

      const pending = !state.isRefreshingLatestReplies && state.prefetchRequests.get(getTopicCacheKey(topicUrl));
      let fetchedAt = Date.now();
      if (options.cachedTopic?.topic) {
        topic = options.cachedTopic.topic;
        state.currentViewTracked = Boolean(options.cachedTopic.currentViewTracked) || state.currentViewTracked;
        fetchedAt = options.cachedTopic.fetchedAt || options.cachedTopic.cachedAt;
        latestRepliesTopic = options.cachedTopic.latestRepliesTopic || null;
      } else if (pending) {
        topic = await pending.promise;
        fetchedAt = state.topicCache.get(getTopicCacheKey(topicUrl))?.fetchedAt || Date.now();
      }
      if (controller.signal.aborted || state.currentUrl !== topicUrl) return;

      if (!topic && (state.settings.trackPreviewVisit === "off" || state.currentViewTracked)) {
        topic = await fetchTrackedTopicJson(topicUrl, controller.signal, topicIdHint, {
          canonical: true,
          trackVisit: false
        });
      } else if (!topic) {
        topic = await ensureTrackedTopicVisit(topicUrl, topicIdHint, controller.signal);
      }

      if (shouldFetchTargetedTopic(topic, targetSpec)) {
        targetedTopic = await fetchTrackedTopicJson(topicUrl, controller.signal, topicIdHint, {
          canonical: false,
          trackVisit: false
        });
        topic = mergeTopicPreviewData(topic, targetedTopic);
        resolvedTargetPostNumber = resolveTopicTargetPostNumber(targetSpec, topic, targetedTopic);
      } else {
        resolvedTargetPostNumber = resolveTopicTargetPostNumber(targetSpec, topic, null);
      }

      if (shouldLoadLatestRepliesTopic(topic, targetSpec) && !latestRepliesTopic) {
        if (targetSpec?.targetToken === "last" && targetedTopic) {
          latestRepliesTopic = targetedTopic;
        } else {
          try {
            latestRepliesTopic = await fetchLatestRepliesTopic(topicUrl, controller.signal, topicIdHint);
          } catch (latestError) {
            if (controller.signal.aborted) {
              throw latestError;
            }
            latestRepliesTopic = null;
          }
        }
      }

      if (controller.signal.aborted || state.currentUrl !== topicUrl) {
        return;
      }

      state.currentTopicFetchedAt = fetchedAt;
      renderTopic(topic, topicUrl, fallbackTitle, resolvedTargetPostNumber, {
        latestRepliesTopic,
        targetSpec,
        preserveScrollTop: options.preserveScrollTop
      });
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      renderIframeFallback(topicUrl, fallbackTitle, error);
    } finally {
      if (state.abortController === controller) {
        state.abortController = null;
      }
      syncLatestRepliesRefreshUI();
    }
  }

  function renderTopic(topic, topicUrl, fallbackTitle, resolvedTargetPostNumber = null, options = {}) {
    tickReading();
    setIframeModeEnabled(false);

    const posts = topic?.post_stream?.posts || [];

    if (!posts.length) {
      renderIframeFallback(topicUrl, fallbackTitle, new Error("No posts available"));
      return;
    }

    const targetSpec = options.targetSpec || getTopicTargetSpec(topicUrl, state.currentTopicIdHint);
    const latestRepliesTopic = options.latestRepliesTopic || null;
    const viewModel = buildTopicViewModel(topic, latestRepliesTopic, targetSpec);
    const shouldPreserveScroll = Number.isFinite(options.preserveScrollTop);

    state.currentTopic = topic;
    state.currentLatestRepliesTopic = latestRepliesTopic;
    state.currentTargetSpec = targetSpec;
    state.currentTopicIdHint = typeof topic?.id === "number" ? topic.id : state.currentTopicIdHint;
    state.currentResolvedTargetPostNumber = resolvedTargetPostNumber;
    state.deferOwnerFilterAutoLoad = shouldDeferOwnerFilterAutoLoad(viewModel);
    state.title.textContent = topic.title || fallbackTitle || "帖子预览";
    renderTopicMeta(topic, viewModel.posts.length);
    state.content.replaceChildren(buildTopicView(topic, viewModel));
    syncLatestRepliesRefreshUI();
    syncReplyUI();

    if (shouldPreserveScroll && state.drawerBody) {
      state.drawerBody.scrollTop = options.preserveScrollTop;
    } else {
      scrollTopicViewToTargetPost(resolvedTargetPostNumber);
    }

    updateLoadMoreStatus();
    queueAutoLoadCheck();
    cacheCurrentTopic();
    startReading();
    trackCurrentTopicVisit();
  }

  function canAppendLoadedPostsIncrementally() {
    return Boolean(
      state.content
      && state.settings.postMode === "all"
      && state.settings.replyOrder === "default"
      && state.settings.authorFilter === "all"
      && !state.currentTargetSpec?.hasTarget
      && state.content.querySelector(".ld-topic-post-list")
    );
  }

  function appendLoadedPostsIncrementally(nextTopic, fetchedPosts, previousScrollTop) {
    if (!canAppendLoadedPostsIncrementally()) {
      return false;
    }

    const postList = state.content.querySelector(".ld-topic-post-list");
    if (!postList) {
      return false;
    }

    const topicOwner = getTopicOwnerIdentity(nextTopic);
    const existingPostNumbers = new Set(
      Array.from(postList.querySelectorAll(".ld-post-card[data-post-number]"))
        .map((node) => Number(node.dataset.postNumber))
        .filter(Number.isFinite)
    );

    const fragment = document.createDocumentFragment();
    let appendedCount = 0;
    for (const post of [...(fetchedPosts || [])].sort((a, b) => Number(a?.post_number || 0) - Number(b?.post_number || 0))) {
      const postNumber = Number(post?.post_number);
      if (!Number.isFinite(postNumber) || existingPostNumbers.has(postNumber)) {
        continue;
      }
      existingPostNumbers.add(postNumber);
      fragment.appendChild(buildPostCard(post, topicOwner));
      appendedCount += 1;
    }

    if (appendedCount > 0) {
      postList.appendChild(fragment);
    }

    state.currentTopic = nextTopic;
    state.currentTopicIdHint = typeof nextTopic?.id === "number" ? nextTopic.id : state.currentTopicIdHint;
    state.deferOwnerFilterAutoLoad = false;
    renderTopicMeta(nextTopic, (nextTopic?.post_stream?.posts || []).length);

    if (state.drawerBody && Number.isFinite(previousScrollTop)) {
      state.drawerBody.scrollTop = previousScrollTop;
    }

    updateLoadMoreStatus();
    syncReplyUI();
    queueAutoLoadCheck();
    cacheCurrentTopic();
    return true;
  }

  function buildTopicView(topic, viewModel) {
    const wrapper = document.createElement("div");
    wrapper.className = "ld-topic-view";

    const visiblePosts = viewModel.posts;
    const basePosts = topic?.post_stream?.posts || [];
    const topicOwner = getTopicOwnerIdentity(topic);

    if (!state.hasShownPreviewNotice) {
      showToast("抽屉预览是便捷阅读视图，标签和回复顺序可能与原帖页略有差异；需要完整阅读时可点右上角“新标签打开”。", "info", 8000, true);
      state.hasShownPreviewNotice = true;
    }

    const postList = document.createElement("div");
    postList.className = "ld-topic-post-list";

    for (const post of visiblePosts) {
      postList.appendChild(buildPostCard(post, topicOwner));
    }

    wrapper.appendChild(postList);

    const footer = document.createElement("div");
    footer.className = "ld-topic-footer";

    if (viewModel.mode === "first" && basePosts.length > 1) {
      const note = document.createElement("div");
      note.className = "ld-topic-note";
      note.textContent = `当前为"仅首帖"模式。想看回复，可在右上角选项里切回"完整主题"。`;
      footer.appendChild(note);
    }

    const replyModeNote = buildReplyModeNote(viewModel);
    if (replyModeNote) {
      const note = document.createElement("div");
      note.className = "ld-topic-note";
      note.textContent = replyModeNote;
      footer.appendChild(note);
    }

    const authorFilterNote = buildAuthorFilterNote(viewModel, topicOwner);
    if (authorFilterNote) {
      const note = document.createElement("div");
      note.className = "ld-topic-note";
      note.textContent = authorFilterNote;
      footer.appendChild(note);
    }

    if (viewModel.canAutoLoadMore) {
      const status = document.createElement("div");
      status.className = "ld-topic-note ld-topic-note-loading";
      status.setAttribute("aria-live", "polite");
      footer.appendChild(status);
      state.loadMoreStatus = status;
    } else {
      state.loadMoreStatus = null;
    }

    if (footer.childElementCount > 0) {
      wrapper.appendChild(footer);
    }

    return wrapper;
  }

  function buildTopicViewModel(topic, latestRepliesTopic = null, targetSpec = null) {
    const posts = topic?.post_stream?.posts || [];
    const moreAvailable = hasMoreTopicPosts(topic);

    if (state.settings.postMode === "first" && !targetSpec?.targetPostNumber) {
      return applyAuthorFilterToViewModel({
        posts: posts.slice(0, 1),
        mode: "first",
        canAutoLoadMore: false,
        hasHiddenPosts: posts.length > 1 || moreAvailable
      }, topic);
    }

    if (targetSpec?.targetPostNumber) {
      return applyAuthorFilterToViewModel({
        posts,
        mode: "targeted",
        targetPostNumber: targetSpec.targetPostNumber,
        canAutoLoadMore: true,
        hasHiddenPosts: moreAvailable
      }, topic);
    }

    if (targetSpec?.targetToken === "last") {
      return applyAuthorFilterToViewModel({
        posts,
        mode: "targeted",
        canAutoLoadMore: false,
        hasHiddenPosts: moreAvailable
      }, topic);
    }

    if (state.settings.replyOrder !== "latestFirst" || posts.length <= 1) {
      return applyAuthorFilterToViewModel({
        posts,
        mode: "default",
        canAutoLoadMore: true,
        hasHiddenPosts: moreAvailable
      }, topic);
    }

    if (topicHasCompletePostStream(topic)) {
      return applyAuthorFilterToViewModel({
        posts: [posts[0], ...posts.slice(1).reverse()],
        mode: "latestComplete",
        canAutoLoadMore: false,
        hasHiddenPosts: false
      }, topic);
    }

    if (latestRepliesTopic) {
      return applyAuthorFilterToViewModel({
        posts: getLatestRepliesDisplayPosts(topic, latestRepliesTopic),
        mode: "latestWindow",
        canAutoLoadMore: false,
        hasHiddenPosts: moreAvailable
      }, topic);
    }

    return applyAuthorFilterToViewModel({
      posts,
      mode: "latestUnavailable",
      canAutoLoadMore: false,
      hasHiddenPosts: moreAvailable
    }, topic);
  }

  function applyAuthorFilterToViewModel(viewModel, topic) {
    if (!viewModel || state.settings.authorFilter !== "topicOwner") {
      return {
        ...(viewModel || {}),
        authorFilter: "all",
        filterHiddenCount: 0,
        filterUnavailable: false,
        preservedTargetPostNumber: null
      };
    }

    const topicOwner = getTopicOwnerIdentity(topic);
    const sourcePosts = Array.isArray(viewModel.posts) ? viewModel.posts : [];
    if (!topicOwner) {
      return {
        ...viewModel,
        authorFilter: "topicOwner",
        filterHiddenCount: 0,
        filterUnavailable: true,
        preservedTargetPostNumber: null
      };
    }

    const targetPostNumber = viewModel.mode === "targeted" && Number.isFinite(viewModel.targetPostNumber)
      ? Number(viewModel.targetPostNumber)
      : null;
    let preservedTargetPostNumber = null;
    const filteredPosts = sourcePosts.filter((post) => {
      if (isTopicOwnerPost(post, topicOwner)) {
        return true;
      }

      if (targetPostNumber !== null && Number(post?.post_number) === targetPostNumber) {
        preservedTargetPostNumber = targetPostNumber;
        return true;
      }

      return false;
    });

    return {
      ...viewModel,
      posts: filteredPosts,
      authorFilter: "topicOwner",
      filterHiddenCount: Math.max(0, sourcePosts.length - filteredPosts.length),
      filterUnavailable: false,
      preservedTargetPostNumber,
      hasHiddenPosts: Boolean(viewModel.hasHiddenPosts) || filteredPosts.length !== sourcePosts.length
    };
  }

  function getTagLabel(tag) {
    if (typeof tag === "string") {
      return tag;
    }

    if (!tag || typeof tag !== "object") {
      return "";
    }

    return tag.name || tag.id || tag.text || tag.label || "";
  }

  function buildPostCard(post, topicOwner = null) {
    const article = document.createElement("article");
    article.className = "ld-post-card";
    if (typeof post.post_number === "number") {
      article.dataset.postNumber = String(post.post_number);
    }

    const header = document.createElement("div");
    header.className = "ld-post-header";

    const avatar = document.createElement("img");
    avatar.className = "ld-post-avatar";
    avatar.alt = post.username || "avatar";
    avatar.loading = "lazy";
    avatar.src = avatarUrl(post.avatar_template);

    let avatarElement = avatar;
    if (post.username) {
      const avatarLink = document.createElement("a");
      avatarLink.className = "ld-post-avatar-link";
      avatarLink.href = `${location.origin}/u/${encodeURIComponent(post.username)}`;
      avatarLink.dataset.userCard = post.username;
      avatarLink.appendChild(avatar);
      avatarElement = avatarLink;
    }

    const authorBlock = document.createElement("div");
    authorBlock.className = "ld-post-author";

    const authorRow = document.createElement("div");
    authorRow.className = "ld-post-author-row";

    const displayName = document.createElement("strong");
    displayName.textContent = post.name || post.username || "匿名用户";

    const username = document.createElement("span");
    username.className = "ld-post-username";
    username.textContent = post.username ? `@${post.username}` : "";

    authorRow.append(displayName, username);

    const topicOwnerBadge = buildTopicOwnerBadge(post, topicOwner);
    if (topicOwnerBadge) {
      authorRow.appendChild(topicOwnerBadge);
    }

    const meta = document.createElement("div");
    meta.className = "ld-post-meta";
    meta.textContent = buildPostMeta(post);

    authorBlock.append(authorRow, meta);
    header.append(avatarElement, authorBlock);

    const replyToTab = buildReplyToTab(post);

    const body = document.createElement("div");
    body.className = "ld-post-body cooked";
    body.innerHTML = post.cooked || "";
    initializePostCarousels(body);
    queueMicrotask(() => {
      if (!body.isConnected) return;
      body.setAttribute("data-ld-native-post", JSON.stringify(post));
      body.dispatchEvent(new Event("ld-render-native-post", { bubbles: true }));
      body.removeAttribute("data-ld-native-post");
    });

    for (const link of body.querySelectorAll("a[href]")) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }

    const postInfos = buildPostInfos(post);

    const actions = document.createElement("div");
    actions.className = "ld-post-actions";

    // --- Left group: copy link, bookmark, flag ---
    const actionsLeft = document.createElement("div");
    actionsLeft.className = "ld-post-actions-left";

    const copyLinkBtn = document.createElement("button");
    copyLinkBtn.type = "button";
    copyLinkBtn.className = "ld-post-icon-btn";
    copyLinkBtn.setAttribute("aria-label", "复制帖子链接");
    copyLinkBtn.title = "将此帖子的链接复制到剪贴板";
    copyLinkBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
    copyLinkBtn.addEventListener("click", () => handleCopyPostLink(copyLinkBtn, post));

    const isBookmarked = post.bookmarked === true;
    const bookmarkBtn = document.createElement("button");
    bookmarkBtn.type = "button";
    bookmarkBtn.className = "ld-post-icon-btn" + (isBookmarked ? " ld-post-icon-btn--bookmarked" : "");
    bookmarkBtn.setAttribute("aria-label", isBookmarked ? "取消书签" : "添加书签");
    bookmarkBtn.title = "将此帖子加入书签";
    bookmarkBtn.innerHTML = isBookmarked
      ? `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v17l-7-3.5L5 21V4z"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v17l-7-3.5L5 21V4z"/></svg>`;
    bookmarkBtn.addEventListener("click", () => handlePostBookmark(bookmarkBtn, post));

    const flagWrap = document.createElement("div");
    flagWrap.className = "ld-flag-wrap";
    const flagBtn = document.createElement("button");
    flagBtn.type = "button";
    flagBtn.className = "ld-post-icon-btn ld-post-icon-btn--flag";
    flagBtn.setAttribute("aria-label", "举报此帖子");
    flagBtn.title = "以私密方式举报此帖子以引起注意，或发送一个关于它的个人消息";
    flagBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`;
    const flagPopover = buildFlagPopover(post);
    flagPopover.setAttribute("hidden", "");
    flagBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isHidden = flagPopover.hasAttribute("hidden");
      closeAllPopovers();
      if (isHidden) {
        flagPopover.removeAttribute("hidden");
      }
    });
    flagWrap.append(flagBtn, flagPopover);
    actionsLeft.append(copyLinkBtn, bookmarkBtn, flagWrap);

    // --- Right group: reactions, reply ---
    const actionsRight = document.createElement("div");
    actionsRight.className = "ld-post-actions-right";

    const reactWrap = document.createElement("div");
    reactWrap.className = "ld-post-react-wrap";

    const reactBtn = document.createElement("button");
    reactBtn.type = "button";
    reactBtn.className = "ld-post-react-btn";
    reactBtn.setAttribute("aria-expanded", "false");
    renderPostReactionButton(reactBtn, post);
    queueMicrotask(() => {
      if (!reactBtn.isConnected) return;
      reactBtn.dispatchEvent(new Event("ld-get-reactions", { bubbles: true }));
      try {
        const reactions = JSON.parse(reactBtn.getAttribute("data-ld-reactions"));
        if (Array.isArray(reactions) && reactions.length) {
          state.availableReactions = reactions.filter((r) => typeof r.id === "string");
          for (const r of state.availableReactions) {
            if (typeof r.url === "string" && /^(https?:\/\/|\/)/.test(r.url)) REACTION_URL_CACHE[r.id] = r.url;
          }
          renderPostReactionButton(reactBtn, post);
        }
      } catch {}
      reactBtn.removeAttribute("data-ld-reactions");
    });

    const reactionsPopover = document.createElement("div");
    reactionsPopover.className = "ld-reactions-popover";
    reactionsPopover.setAttribute("hidden", "");

    reactBtn.addEventListener("click", () => {
      const opening = reactionsPopover.hidden;
      closeAllPopovers();
      if (!opening) return;
      reactionsPopover.removeAttribute("hidden");
      reactBtn.setAttribute("aria-expanded", "true");
      if (!reactionsPopover.dataset.loaded) {
        reactionsPopover.dataset.loaded = "1";
        populateReactionsPopover(reactionsPopover, post, reactBtn);
      }
    });

    reactWrap.append(reactBtn, reactionsPopover);

    const replyButton = document.createElement("button");
    replyButton.type = "button";
    replyButton.className = "ld-post-reply-button";
    replyButton.setAttribute("aria-label", `回复第 ${post.post_number || "?"} 条`);
    replyButton.innerHTML = `
      <span class="ld-post-reply-button-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="M4 12.5c0-4.14 3.36-7.5 7.5-7.5h7a1.5 1.5 0 0 1 0 3h-7A4.5 4.5 0 0 0 7 12.5v1.38l1.44-1.44a1.5 1.5 0 0 1 2.12 2.12l-4 4a1.5 1.5 0 0 1-2.12 0l-4-4a1.5 1.5 0 1 1 2.12-2.12L4 13.88V12.5Z" fill="currentColor"></path>
        </svg>
      </span>
      <span class="ld-post-reply-button-label">回复这条</span>
    `;
    replyButton.addEventListener("click", () => openReplyPanelForPost(post));

    const stats = document.createElement("div");
    stats.className = "ld-post-actions-stats";
    stats.append(reactWrap);
    if (postInfos) stats.append(postInfos);
    const divider = document.createElement("span");
    divider.className = "ld-post-actions-divider";
    divider.textContent = "|";
    divider.setAttribute("aria-hidden", "true");
    actionsRight.append(replyButton);
    actions.append(stats, divider, actionsLeft, actionsRight);

    if (replyToTab) {
      article.append(header, replyToTab, body);
    } else {
      article.append(header, body);
    }
    article.appendChild(actions);
    if (!post.deleted && (post.can_boost || post.boosts?.length)) {
      const boosts = document.createElement("div");
      boosts.className = "ld-post-boosts";
      boosts.addEventListener("ld-native-boosts-change", () => {
        try {
          const data = JSON.parse(boosts.getAttribute("data-ld-native-boosts"));
          if (Array.isArray(data?.boosts) && typeof data.can_boost === "boolean") {
            post.boosts = data.boosts;
            post.can_boost = data.can_boost;
          }
        } catch {}
      });
      article.append(boosts);
      queueMicrotask(() => {
        if (!boosts.isConnected) return;
        boosts.setAttribute("data-ld-native-post", JSON.stringify(post));
        boosts.dispatchEvent(new Event("ld-render-native-post", { bubbles: true }));
        boosts.removeAttribute("data-ld-native-post");
      });
    }
    return article;
  }

  function renderPostReactionButton(button, post) {
    const reactions = Array.isArray(post.reactions) ? post.reactions : [];
    const like = post.actions_summary?.find((action) => action.id === 2);
    const reacted = Boolean(post.current_user_reaction || reactions.some((r) => r.reacted) || like?.acted);
    const count = post.reaction_users_count ?? (reactions.reduce((sum, r) => sum + (r.count || 0), 0) || post.like_count || like?.count || 0);
    button.classList.toggle("ld-post-react-btn--reacted", reacted);
    button.setAttribute("aria-label", `选择表情反应${count ? `，共 ${count} 个` : ""}`);
    button.title = "选择表情反应，再次选择已用表情可取消";
    const icons = document.createElement("span");
    icons.className = "ld-post-react-btn-icon";
    icons.setAttribute("aria-hidden", "true");
    const popular = reactions.filter((r) => r.count > 0).sort((a, b) => b.count - a.count).slice(0, 3);
    for (const reaction of popular) {
      const img = document.createElement("img");
      img.src = buildReactionEmojiSrc(reaction.id);
      img.alt = `:${reaction.id}:`;
      icons.append(img);
    }
    if (!popular.length) icons.innerHTML = buildReactHeartIconSvg(reacted);
    button.replaceChildren(icons);
    if (count > 0) {
      const counter = document.createElement("span");
      counter.className = "ld-post-react-count";
      counter.textContent = String(count);
      button.append(counter);
    }
  }

  function handleDrawerBodyScroll() {
    if (state.reading) {
      state.reading.lastActivity = performance.now();
      state.reading.onscreen.clear();
    }
    maybeLoadMorePosts();
  }

  function buildReactHeartIconSvg(isReacted) {
    if (isReacted) {
      return `<svg viewBox="0 0 24 24" focusable="false">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="currentColor"/>
        </svg>`;
    }
    return `<svg viewBox="0 0 24 24" fill="none" focusable="false">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
        </svg>`;
  }

  function toggleReplyPanel() {
    if (!state.currentTopic || state.isReplySubmitting) {
      return;
    }

    if (state.replyPanel?.hidden) {
      setReplyTarget(null);
    }

    setReplyPanelOpen(state.replyPanel?.hidden);
  }

  function openReplyPanelForPost(post) {
    if (!state.currentTopic || !post || state.isReplySubmitting) {
      return;
    }

    setReplyTarget(post);
    setReplyPanelOpen(true);
  }

  function forEachReplyTriggerButton(callback) {
    for (const button of [state.replyToggleButton, state.replyFabButton]) {
      if (button instanceof HTMLButtonElement) {
        callback(button);
      }
    }
  }

  function setReplyPanelOpen(isOpen) {
    if (!state.replyPanel) {
      return;
    }

    if (isOpen && !state.currentTopic) {
      return;
    }

    if (!isOpen) {
      stopReplyPanelDrag();
    }

    state.replyPanel.hidden = !isOpen;
    syncReplyUI();
    forEachReplyTriggerButton((button) => {
      button.setAttribute("aria-expanded", String(isOpen));
    });

    if (!isOpen) {
      clearReplyPanelPositionStyles();
      setReplyTarget(null);
      return;
    }

    applyReplyPanelPosition();
    queueMicrotask(() => state.replyTextarea?.focus());
  }

  function startReplyPanelDrag(event) {
    const target = event.target;
    if (
      event.button !== 0
      || window.innerWidth <= 720
      || !state.replyPanel
      || state.replyPanel.hidden
      || !state.replyPanelMain
      || !state.replyPanelHead
      || !(target instanceof Element)
      || Boolean(target.closest("button, a, input, textarea, select, label"))
    ) {
      return;
    }

    const panelRect = state.replyPanel.getBoundingClientRect();
    const containerRect = state.replyPanelMain.getBoundingClientRect();
    if (panelRect.width <= 0 || panelRect.height <= 0 || containerRect.width <= 0 || containerRect.height <= 0) {
      return;
    }

    const currentPosition = clampReplyPanelPosition({
      left: panelRect.left - containerRect.left,
      top: panelRect.top - containerRect.top
    });
    if (!currentPosition) {
      return;
    }

    event.preventDefault();
    state.isReplyPanelDragging = true;
    state.replyPanelDragPointerId = event.pointerId;
    state.replyPanelDragOffsetX = event.clientX - panelRect.left;
    state.replyPanelDragOffsetY = event.clientY - panelRect.top;
    state.replyPanelDragMoved = false;
    state.replyPanelDragLastPosition = currentPosition;
    document.body.classList.add("ld-reply-panel-dragging");
    state.replyPanel.classList.add("is-dragging");
    setReplyPanelInlinePosition(currentPosition);
    state.replyPanelHead.setPointerCapture?.(event.pointerId);
  }

  function handleReplyPanelDragMove(event) {
    if (
      !state.isReplyPanelDragging
      || event.pointerId !== state.replyPanelDragPointerId
      || !state.replyPanelMain
    ) {
      return;
    }

    event.preventDefault();
    const containerRect = state.replyPanelMain.getBoundingClientRect();
    const nextPosition = clampReplyPanelPosition({
      left: event.clientX - containerRect.left - state.replyPanelDragOffsetX,
      top: event.clientY - containerRect.top - state.replyPanelDragOffsetY
    });

    if (!nextPosition || isSameReplyPanelPosition(nextPosition, state.replyPanelDragLastPosition)) {
      return;
    }

    state.replyPanelDragMoved = true;
    state.replyPanelDragLastPosition = nextPosition;
    state.settings.replyPanelPosition = nextPosition;
    setReplyPanelInlinePosition(nextPosition);
  }

  function stopReplyPanelDrag(event) {
    if (!state.isReplyPanelDragging) {
      return;
    }

    if (event?.pointerId !== undefined && event.pointerId !== state.replyPanelDragPointerId) {
      return;
    }

    const shouldSave = state.replyPanelDragMoved;
    state.isReplyPanelDragging = false;
    document.body.classList.remove("ld-reply-panel-dragging");
    state.replyPanel?.classList.remove("is-dragging");

    if (
      state.replyPanelDragPointerId !== null
      && state.replyPanelHead?.hasPointerCapture?.(state.replyPanelDragPointerId)
    ) {
      state.replyPanelHead.releasePointerCapture(state.replyPanelDragPointerId);
    }

    state.replyPanelDragPointerId = null;
    state.replyPanelDragOffsetX = 0;
    state.replyPanelDragOffsetY = 0;
    state.replyPanelDragLastPosition = null;
    state.replyPanelDragMoved = false;

    if (shouldSave) {
      state.suppressReplyPanelClick = true;
      saveSettings();
      return;
    }

    applyReplyPanelPosition();
  }

  function applyReplyPanelPosition(shouldPersist = false) {
    if (!state.replyPanel) {
      return;
    }

    if (window.innerWidth <= 720 || state.replyPanel.hidden) {
      clearReplyPanelPositionStyles();
      return;
    }

    const position = clampReplyPanelPosition(state.settings.replyPanelPosition);
    if (!position) {
      clearReplyPanelPositionStyles();
      return;
    }

    setReplyPanelInlinePosition(position);

    if (!isSameReplyPanelPosition(position, state.settings.replyPanelPosition)) {
      state.settings.replyPanelPosition = position;
      if (shouldPersist) {
        saveSettings();
      }
    }
  }

  function setReplyPanelInlinePosition(position) {
    if (!state.replyPanel || !position) {
      return;
    }

    state.replyPanel.style.left = `${position.left}px`;
    state.replyPanel.style.top = `${position.top}px`;
    state.replyPanel.style.right = "auto";
    state.replyPanel.style.bottom = "auto";
  }

  function clearReplyPanelPositionStyles() {
    if (!state.replyPanel) {
      return;
    }

    state.replyPanel.style.removeProperty("left");
    state.replyPanel.style.removeProperty("top");
    state.replyPanel.style.removeProperty("right");
    state.replyPanel.style.removeProperty("bottom");
  }

  function normalizeReplyPanelPosition(value) {
    if (!value || typeof value !== "object") {
      return null;
    }

    const left = Number(value.left);
    const top = Number(value.top);
    if (!Number.isFinite(left) || !Number.isFinite(top)) {
      return null;
    }

    return {
      left: Math.round(left),
      top: Math.round(top)
    };
  }

  function clampReplyPanelPosition(position) {
    const normalized = normalizeReplyPanelPosition(position);
    if (!normalized || !state.replyPanel || !state.replyPanelMain || state.replyPanel.hidden) {
      return normalized;
    }

    const horizontalInset = 14;
    const verticalInset = 14;
    const minTop = getReplyPanelDefaultTop();
    const maxLeft = Math.max(horizontalInset, state.replyPanelMain.clientWidth - state.replyPanel.offsetWidth - horizontalInset);
    const maxTop = Math.max(minTop, state.replyPanelMain.clientHeight - state.replyPanel.offsetHeight - verticalInset);

    return {
      left: clampNumber(normalized.left, horizontalInset, maxLeft),
      top: clampNumber(normalized.top, minTop, maxTop)
    };
  }

  function isSameReplyPanelPosition(a, b) {
    return Boolean(a && b && a.left === b.left && a.top === b.top);
  }

  function getReplyPanelDefaultTop() {
    return Math.max(16, (state.header?.offsetHeight || 0) + 16);
  }

  function clampNumber(value, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return min;
    }

    return Math.min(Math.max(Math.round(numeric), min), max);
  }

  function setReplyTarget(post) {
    if (post && typeof post === "object" && Number.isFinite(post.post_number)) {
      state.replyTargetPostNumber = Number(post.post_number);
      state.replyTargetLabel = buildReplyTargetLabel(post);
    } else {
      state.replyTargetPostNumber = null;
      state.replyTargetLabel = "";
    }

    syncReplyUI();
  }

  function buildReplyTargetLabel(post) {
    const parts = [];

    if (Number.isFinite(post?.post_number)) {
      parts.push(`#${post.post_number}`);
    }

    if (post?.username) {
      parts.push(`@${post.username}`);
    }

    return parts.join(" ") || "这条回复";
  }

  function handleReplyTextareaKeydown(event) {
    if (!event.metaKey && !event.ctrlKey) {
      return;
    }

    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    handleReplySubmit();
  }

  function handleReplyTextareaPaste(event) {
    if (
      event.defaultPrevented ||
      event.target !== state.replyTextarea ||
      !state.currentTopic ||
      state.isReplySubmitting
    ) {
      return;
    }

    const files = getReplyPasteImageFiles(event);
    if (!files.length) {
      return;
    }

    event.preventDefault();
    queueReplyPasteUploads(files).catch(() => {});
  }

  function getReplyPasteImageFiles(event) {
    const clipboardData = event?.clipboardData;
    if (!clipboardData) {
      return [];
    }

    const types = Array.from(clipboardData.types || []);
    if (types.includes("text/plain") || types.includes("text/html")) {
      return [];
    }

    return Array.from(clipboardData.files || [])
      .map(normalizeReplyUploadFile)
      .filter((file) => file instanceof File && isImageUploadFile(file));
  }

  function normalizeReplyUploadFile(file) {
    if (!(file instanceof Blob)) {
      return null;
    }

    const fileName = resolveReplyUploadFileName(file);
    if (file instanceof File && file.name) {
      return file;
    }

    if (typeof File === "function") {
      return new File([file], fileName, {
        type: file.type || "image/png",
        lastModified: file instanceof File ? file.lastModified : Date.now()
      });
    }

    try {
      file.name = fileName;
    } catch {
      // 某些浏览器实现里 name 只读，忽略即可。
    }

    return file;
  }

  function resolveReplyUploadFileName(file) {
    const originalName = typeof file?.name === "string"
      ? file.name.trim()
      : "";
    if (originalName) {
      return originalName;
    }

    return `image.${mimeTypeToFileExtension(file?.type)}`;
  }

  function mimeTypeToFileExtension(mimeType) {
    const normalized = String(mimeType || "").toLowerCase();
    if (normalized === "image/jpeg") {
      return "jpg";
    }

    if (normalized === "image/svg+xml") {
      return "svg";
    }

    const match = normalized.match(/^image\/([a-z0-9.+-]+)$/i);
    if (!match) {
      return "png";
    }

    return match[1].replace("svg+xml", "svg");
  }

  function isImageUploadFile(file) {
    if (!(file instanceof File)) {
      return false;
    }

    if (String(file.type || "").toLowerCase().startsWith("image/")) {
      return true;
    }

    return isImageUploadName(file.name || "");
  }

  async function queueReplyPasteUploads(files) {
    if (!state.replyTextarea || !state.currentTopic) {
      return;
    }

    const sessionId = state.replyComposerSessionId;
    const placeholders = insertReplyUploadPlaceholders(files);
    if (!placeholders.length) {
      return;
    }

    state.replyUploadPendingCount += placeholders.length;
    syncReplyUI();
    updateReplyUploadStatus();

    const results = await Promise.allSettled(
      placeholders.map((entry) => uploadReplyPasteFile(entry, sessionId))
    );

    if (sessionId !== state.replyComposerSessionId || state.replyUploadPendingCount > 0 || !state.replyStatus) {
      return;
    }

    const successCount = results.filter((result) => result.status === "fulfilled").length;
    const failures = results.filter((result) => result.status === "rejected");

    if (!failures.length) {
      state.replyStatus.textContent = successCount > 1
        ? `已上传 ${successCount} 张图片，已插入回复内容。`
        : "图片已上传，已插入回复内容。";
      return;
    }

    if (!successCount) {
      state.replyStatus.textContent = failures.length > 1
        ? `图片上传失败（${failures.length} 张）：${failures.map((item) => item.reason?.message || "未知错误").join("；")}`
        : `图片上传失败：${failures[0].reason?.message || "未知错误"}`;
      return;
    }

    state.replyStatus.textContent = `图片上传完成：${successCount} 张成功，${failures.length} 张失败。`;
  }

  function insertReplyUploadPlaceholders(files) {
    if (!state.replyTextarea) {
      return [];
    }

    const entries = files.map((file) => buildReplyUploadPlaceholder(file));
    insertReplyTextareaText(entries.map((entry) => entry.insertedText).join(""));
    return entries;
  }

  function buildReplyUploadPlaceholder(file) {
    const uploadId = `ld-upload-${Date.now()}-${++state.replyUploadSerial}`;
    const visibleLabel = `[图片上传中：${sanitizeReplyUploadFileName(file.name || "image.png")}]`;
    const marker = `${REPLY_UPLOAD_MARKER}${uploadId}${REPLY_UPLOAD_MARKER}${visibleLabel}${REPLY_UPLOAD_MARKER}/${uploadId}${REPLY_UPLOAD_MARKER}`;

    return {
      file,
      marker,
      insertedText: `${marker}\n`
    };
  }

  function sanitizeReplyUploadFileName(fileName) {
    return String(fileName || "image.png")
      .replace(/\s+/g, " ")
      .trim();
  }

  function insertReplyTextareaText(text) {
    if (!state.replyTextarea) {
      return;
    }

    const textarea = state.replyTextarea;
    const start = Number.isFinite(textarea.selectionStart)
      ? textarea.selectionStart
      : textarea.value.length;
    const end = Number.isFinite(textarea.selectionEnd)
      ? textarea.selectionEnd
      : start;

    textarea.focus();
    textarea.setRangeText(text, start, end, "end");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async function uploadReplyPasteFile(entry, sessionId) {
    const controller = new AbortController();
    addReplyUploadController(controller);

    try {
      const upload = await createComposerUpload(entry.file, controller.signal, { pasted: true });
      if (controller.signal.aborted || sessionId !== state.replyComposerSessionId) {
        return upload;
      }

      const markdown = buildComposerUploadMarkdown(upload);
      const inserted = replaceReplyUploadPlaceholder(entry.marker, `${markdown}\n`);
      if (!inserted) {
        insertReplyTextareaText(`\n${markdown}\n`);
      }

      return upload;
    } catch (error) {
      if (!controller.signal.aborted && sessionId === state.replyComposerSessionId) {
        removeReplyUploadPlaceholder(entry.marker);
      }

      if (controller.signal.aborted) {
        return null;
      }

      throw error;
    } finally {
      removeReplyUploadController(controller);
      if (state.replyUploadPendingCount > 0) {
        state.replyUploadPendingCount -= 1;
      }

      syncReplyUI();
      if (sessionId === state.replyComposerSessionId && state.replyUploadPendingCount > 0) {
        updateReplyUploadStatus();
      }
    }
  }

  function replaceReplyUploadPlaceholder(marker, replacement) {
    return replaceReplyTextareaText(marker, replacement);
  }

  function removeReplyUploadPlaceholder(marker) {
    replaceReplyTextareaText(marker, "");
  }

  function replaceReplyTextareaText(searchText, replacementText) {
    if (!state.replyTextarea) {
      return false;
    }

    const textarea = state.replyTextarea;
    const start = textarea.value.indexOf(searchText);
    if (start === -1) {
      return false;
    }

    textarea.setRangeText(
      replacementText,
      start,
      start + searchText.length,
      "preserve"
    );
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  function addReplyUploadController(controller) {
    state.replyUploadControllers.push(controller);
  }

  function removeReplyUploadController(controller) {
    state.replyUploadControllers = state.replyUploadControllers.filter((item) => item !== controller);
  }

  function cancelReplyUploads() {
    for (const controller of state.replyUploadControllers) {
      controller.abort();
    }

    state.replyUploadControllers = [];
    state.replyUploadPendingCount = 0;
  }

  function updateReplyUploadStatus() {
    if (!state.replyStatus || state.replyUploadPendingCount <= 0) {
      return;
    }

    state.replyStatus.textContent = state.replyUploadPendingCount > 1
      ? `正在上传 ${state.replyUploadPendingCount} 张图片...`
      : "正在上传图片...";
  }

  async function handleReplySubmit() {
    if (!state.currentTopic || state.isReplySubmitting || !state.replyTextarea || !state.replyStatus) {
      return;
    }

    if (state.replyUploadPendingCount > 0) {
      state.replyStatus.textContent = state.replyUploadPendingCount > 1
        ? `还有 ${state.replyUploadPendingCount} 张图片正在上传，请稍候再发送。`
        : "图片还在上传中，请稍候再发送。";
      return;
    }

    const raw = state.replyTextarea.value.trim();
    if (!raw) {
      state.replyStatus.textContent = "先写点内容再发送。";
      state.replyTextarea.focus();
      return;
    }

    cancelReplyRequest();
    state.isReplySubmitting = true;
    syncReplyUI();
    state.replyStatus.textContent = "正在发送回复...";

    const controller = new AbortController();
    state.replyAbortController = controller;

    try {
      const createdPost = await createTopicReply(
        state.currentTopic.id,
        raw,
        controller.signal,
        state.replyTargetPostNumber
      );
      if (controller.signal.aborted) {
        return;
      }

      state.replyTextarea.value = "";
      state.replyStatus.textContent = "回复已发送。";
      if (state.root?.classList.contains(IFRAME_MODE_CLASS)) {
        refreshIframeAfterCreatedReply(createdPost);
        showToast("回复已发送", "success");
      } else {
        appendCreatedReplyToCurrentTopic(createdPost);
      }
      setReplyPanelOpen(false);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      state.replyStatus.textContent = error?.message || "回复发送失败";
    } finally {
      if (state.replyAbortController === controller) {
        state.replyAbortController = null;
      }

      state.isReplySubmitting = false;
      syncReplyUI();
    }
  }

  function queueAutoLoadCheck() {
    requestAnimationFrame(() => {
      maybeLoadMorePosts();
    });
  }

  function maybeLoadMorePosts() {
    if (!state.drawerBody || !state.currentTopic) {
      return;
    }

    if (!buildTopicViewModel(state.currentTopic, state.currentLatestRepliesTopic, state.currentTargetSpec).canAutoLoadMore || state.isLoadingMorePosts || !hasMoreTopicPosts(state.currentTopic)) {
      updateLoadMoreStatus();
      return;
    }

    if (state.deferOwnerFilterAutoLoad && state.drawerBody.scrollTop <= 0) {
      updateLoadMoreStatus();
      return;
    }

    const remainingDistance = state.drawerBody.scrollHeight - state.drawerBody.scrollTop - state.drawerBody.clientHeight;
    if (remainingDistance > LOAD_MORE_TRIGGER_OFFSET) {
      updateLoadMoreStatus();
      return;
    }

    loadMorePosts().catch(() => {});
  }

  async function loadMorePosts() {
    if (!state.currentTopic || state.isLoadingMorePosts || !buildTopicViewModel(state.currentTopic, state.currentLatestRepliesTopic, state.currentTargetSpec).canAutoLoadMore) {
      return;
    }

    const nextPostIds = getNextTopicPostIds(state.currentTopic);
    if (!nextPostIds.length) {
      updateLoadMoreStatus();
      return;
    }

    cancelLoadMoreRequest();
    state.isLoadingMorePosts = true;
    state.loadMoreError = "";
    updateLoadMoreStatus();

    const controller = new AbortController();
    const currentUrl = state.currentUrl;
    state.loadMoreAbortController = controller;

    try {
      const posts = await fetchTopicPostsBatch(currentUrl, nextPostIds, controller.signal, state.currentTopicIdHint);
      if (controller.signal.aborted || state.currentUrl !== currentUrl) {
        return;
      }
      if (!posts.length) {
        throw new Error("未获取到更多回复，请稍后重试");
      }

      const nextTopic = mergeTopicPreviewData(state.currentTopic, {
        posts_count: state.currentTopic.posts_count,
        post_stream: {
          posts
        }
      });

      state.isLoadingMorePosts = false;
      state.loadMoreError = "";
      const previousScrollTop = state.drawerBody?.scrollTop || 0;
      if (!appendLoadedPostsIncrementally(nextTopic, posts, previousScrollTop)) {
        renderTopic(nextTopic, currentUrl, state.currentFallbackTitle, state.currentResolvedTargetPostNumber, {
          targetSpec: state.currentTargetSpec,
          preserveScrollTop: previousScrollTop
        });
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      state.isLoadingMorePosts = false;
      state.loadMoreError = error?.message || "加载更多失败";
      updateLoadMoreStatus();
    } finally {
      if (state.loadMoreAbortController === controller) {
        state.loadMoreAbortController = null;
      }
    }
  }

  function cancelLoadMoreRequest() {
    if (state.loadMoreAbortController) {
      state.loadMoreAbortController.abort();
      state.loadMoreAbortController = null;
    }
  }

  function cancelDirectRepliesRequest() {
    if (state.directRepliesAbortController) {
      state.directRepliesAbortController.abort();
      state.directRepliesAbortController = null;
    }
  }

  function cancelReplyRequest() {
    if (state.replyAbortController) {
      state.replyAbortController.abort();
      state.replyAbortController = null;
    }
  }

  function updateLoadMoreStatus() {
    if (!state.loadMoreStatus) {
      return;
    }

    if (!state.currentTopic) {
      state.loadMoreStatus.textContent = "";
      state.loadMoreStatus.hidden = true;
      return;
    }

    state.loadMoreStatus.hidden = false;

    if (state.isLoadingMorePosts) {
      state.loadMoreStatus.textContent = "正在加载更多回复...";
      return;
    }

    if (state.loadMoreError) {
      state.loadMoreStatus.textContent = `加载更多失败：${state.loadMoreError}`;
      return;
    }

    if (hasMoreTopicPosts(state.currentTopic)) {
      const loadedCount = (state.currentTopic.post_stream?.posts || []).length;
      const totalCount = state.currentTopic.posts_count || loadedCount;
      state.loadMoreStatus.textContent = `已加载 ${loadedCount} / ${totalCount}，继续下滑自动加载更多`;
      return;
    }

    state.loadMoreStatus.textContent = "已加载完当前主题内容";
  }

  function initializePostCarousels(body) {
    for (const grid of body.querySelectorAll('.d-image-grid[data-mode="carousel"]')) {
      if (grid.classList.contains("ld-carousel")) {
        continue;
      }

      const items = [...new Set([...grid.querySelectorAll("img:not(.emoji):not(.thumbnail):not(.ytp-thumbnail-image)")]
        .filter((img) => img.closest(".d-image-grid") === grid)
        .map((img) => img.closest(".lightbox-wrapper") || img.closest("a") || img))];
      if (!items.length) {
        continue;
      }

      grid.classList.add("ld-carousel");
      grid.setAttribute("role", "group");
      grid.setAttribute("aria-label", "图片轮播");
      const slides = items.map((item) => {
        const slide = document.createElement("div");
        slide.className = "ld-carousel-slide";
        slide.append(item);
        return slide;
      });
      const controls = document.createElement("div");
      controls.className = "ld-carousel-controls";
      let activeIndex = 0;
      const show = (index) => {
        activeIndex = (index + slides.length) % slides.length;
        slides.forEach((slide, i) => { slide.hidden = i !== activeIndex; });
        dots.forEach((dot, i) => dot.setAttribute("aria-pressed", String(i === activeIndex)));
      };
      const button = (label, text, onClick) => {
        const element = document.createElement("button");
        element.type = "button";
        element.setAttribute("aria-label", label);
        element.textContent = text;
        element.addEventListener("click", onClick);
        return element;
      };
      const dots = slides.map((slide, i) => button(`第 ${i + 1} 张，共 ${slides.length} 张`, "●", () => show(i)));
      controls.append(
        button("上一张图片", "‹", () => show(activeIndex - 1)),
        ...dots,
        button("下一张图片", "›", () => show(activeIndex + 1))
      );
      controls.hidden = slides.length < 2;
      grid.replaceChildren(...slides, controls);
      grid.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        show(activeIndex + (event.key === "ArrowLeft" ? -1 : 1));
      });
      show(0);
    }
  }

  function handleDrawerRootClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    if (target.closest(".ld-native-body")) {
      return;
    }

    const image = target.closest(".ld-post-body img");
    if (!(image instanceof HTMLImageElement)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    openImagePreview(image);
  }

  function handleImagePreviewClick(event) {
    if (state.imagePreview?.hidden) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Element) || !target.closest(".ld-image-preview")) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    closeImagePreview();
  }

  function openImagePreview(image) {
    if (!state.imagePreviewRoot || !state.imagePreview || !state.imagePreviewImage) {
      return;
    }

    const previewSrc = getPreviewImageSrc(image);
    if (!previewSrc) {
      return;
    }

    resetImagePreviewScale();
    state.imagePreviewImage.src = previewSrc;
    state.imagePreviewImage.alt = image.alt || "图片预览";
    state.imagePreviewImage.classList.remove("is-ready");
    state.imagePreviewRoot.setAttribute("aria-hidden", "false");
    state.imagePreview.hidden = false;
    state.imagePreview.setAttribute("aria-hidden", "false");
    if (state.imagePreviewImage.complete) {
      state.imagePreviewImage.classList.add("is-ready");
    } else {
      state.imagePreviewImage.addEventListener("load", handlePreviewImageLoad, { once: true });
      state.imagePreviewImage.addEventListener("error", handlePreviewImageLoad, { once: true });
    }
    state.imagePreviewCloseButton?.focus();
  }

  function closeImagePreview() {
    if (!state.imagePreviewRoot || !state.imagePreview || !state.imagePreviewImage) {
      return;
    }

    state.imagePreviewRoot.setAttribute("aria-hidden", "true");
    state.imagePreview.hidden = true;
    state.imagePreview.setAttribute("aria-hidden", "true");
    resetImagePreviewScale();
    state.imagePreviewImage.classList.remove("is-ready");
    state.imagePreviewImage.removeAttribute("src");
    state.imagePreviewImage.alt = "图片预览";
  }

  function handlePreviewImageLoad() {
    state.imagePreviewImage?.classList.add("is-ready");
  }

  function handleImagePreviewWheel(event) {
    if (state.imagePreview?.hidden) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    event.preventDefault();

    if (!target.closest(".ld-image-preview-stage")) {
      return;
    }

    const nextScale = clampImagePreviewScale(
      state.imagePreviewScale + (event.deltaY < 0 ? IMAGE_PREVIEW_SCALE_STEP : -IMAGE_PREVIEW_SCALE_STEP)
    );

    if (nextScale === state.imagePreviewScale) {
      return;
    }

    updateImagePreviewTransformOrigin(event.clientX, event.clientY);
    state.imagePreviewScale = nextScale;
    applyImagePreviewScale();
  }

  function handleDrawerRootWheel(event) {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    if (event.deltaY <= 0 || !target.closest(".ld-drawer-body") || !shouldLoadMoreFromOwnerFilterWheel()) {
      return;
    }

    event.preventDefault();
    loadMorePosts().catch(() => {});
  }

  function resetImagePreviewScale() {
    state.imagePreviewScale = IMAGE_PREVIEW_SCALE_MIN;
    if (state.imagePreviewImage) {
      state.imagePreviewImage.style.transformOrigin = "center center";
    }
    applyImagePreviewScale();
  }

  function applyImagePreviewScale() {
    if (!state.imagePreview || !state.imagePreviewImage) {
      return;
    }

    state.imagePreviewImage.style.setProperty("--ld-image-preview-scale", String(state.imagePreviewScale));
    state.imagePreview.classList.toggle("is-zoomed", state.imagePreviewScale > IMAGE_PREVIEW_SCALE_MIN);
  }

  function clampImagePreviewScale(value) {
    return Math.min(IMAGE_PREVIEW_SCALE_MAX, Math.max(IMAGE_PREVIEW_SCALE_MIN, Number(value) || IMAGE_PREVIEW_SCALE_MIN));
  }

  function updateImagePreviewTransformOrigin(clientX, clientY) {
    if (!state.imagePreviewImage) {
      return;
    }

    const rect = state.imagePreviewImage.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }

    const offsetX = ((clientX - rect.left) / rect.width) * 100;
    const offsetY = ((clientY - rect.top) / rect.height) * 100;
    const originX = Math.min(100, Math.max(0, offsetX));
    const originY = Math.min(100, Math.max(0, offsetY));

    state.imagePreviewImage.style.transformOrigin = `${originX}% ${originY}%`;
  }

  function getPreviewImageSrc(image) {
    if (!(image instanceof HTMLImageElement)) {
      return "";
    }

    const link = image.closest("a[href]");
    if (link instanceof HTMLAnchorElement && looksLikeImageUrl(link.href)) {
      return link.href;
    }

    return image.currentSrc || image.src || "";
  }

  function looksLikeImageUrl(url) {
    try {
      const parsed = new URL(url, location.href);
      return /\.(avif|bmp|gif|jpe?g|png|svg|webp)(?:$|[?#])/i.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  function renderTopicError(topicUrl, fallbackTitle, error) {
    cancelLoadMoreRequest();
    cancelReplyRequest();
    state.currentTopic = null;
    state.currentLatestRepliesTopic = null;
    state.currentTargetSpec = null;
    state.currentResolvedTargetPostNumber = null;
    state.deferOwnerFilterAutoLoad = false;
    state.isLoadingMorePosts = false;
    state.isRefreshingLatestReplies = false;
    state.isReplySubmitting = false;
    state.loadMoreError = "";
    state.loadMoreStatus = null;
    state.title.textContent = fallbackTitle || "帖子预览";
    state.meta.textContent = "智能预览暂时不可用。";
    resetReplyComposer();
    syncLatestRepliesRefreshUI();

    const container = document.createElement("div");
    container.className = "ld-topic-error-state";

    const errorNote = document.createElement("div");
    errorNote.className = "ld-topic-note ld-topic-note-error";
    errorNote.textContent = `预览加载失败：${error?.message || "未知错误"}`;

    const hintNote = document.createElement("div");
    hintNote.className = "ld-topic-note";
    hintNote.textContent = `可以点右上角“新标签打开”查看原帖：${topicUrl}`;

    container.append(errorNote, hintNote);
    state.content.replaceChildren(container);
  }

  function renderIframeFallback(topicUrl, fallbackTitle, error, forcedIframe = false) {
    stopReading();
    setIframeModeEnabled(true);
    cancelLoadMoreRequest();
    cancelReplyRequest();

    state.currentTopic = buildIframeReplyTopic(topicUrl, fallbackTitle);
    state.currentLatestRepliesTopic = null;
    state.currentTargetSpec = null;
    state.currentResolvedTargetPostNumber = null;
    state.deferOwnerFilterAutoLoad = false;
    state.isLoadingMorePosts = false;
    state.isRefreshingLatestReplies = false;
    state.isReplySubmitting = false;
    state.loadMoreError = "";
    state.loadMoreStatus = null;
    state.title.textContent = fallbackTitle || "帖子预览";
    state.meta.textContent = forcedIframe ? "当前为整页模式。" : "接口预览失败，已回退为完整页面。";
    resetReplyComposer();
    syncLatestRepliesRefreshUI();

    const container = document.createElement("div");
    container.className = "ld-iframe-fallback";

    if (error) {
      const note = document.createElement("div");
      note.className = "ld-topic-note ld-topic-note-error";
      note.textContent = `预览接口不可用：${error?.message || "未知错误"}`;
      container.append(note);
    }

    const iframe = document.createElement("iframe");
    iframe.className = "ld-topic-iframe";
    iframe.src = topicUrl;
    iframe.loading = "lazy";
    iframe.referrerPolicy = "strict-origin-when-cross-origin";

    container.append(iframe);
    state.content.replaceChildren(container);
  }

  function buildIframeReplyTopic(topicUrl, fallbackTitle) {
    const topicId = getTopicIdFromUrl(topicUrl, state.currentTopicIdHint);
    if (!Number.isFinite(topicId)) {
      return null;
    }

    return {
      id: Number(topicId),
      title: fallbackTitle || state.currentFallbackTitle || "当前主题",
      __sidePeekIframeShell: true
    };
  }

  function refreshIframeAfterCreatedReply(createdPost) {
    const iframe = state.content?.querySelector(".ld-topic-iframe");
    if (!(iframe instanceof HTMLIFrameElement)) {
      return;
    }

    const topicId = Number(createdPost?.topic_id || state.currentTopic?.id || state.currentTopicIdHint);
    const postNumber = Number(createdPost?.post_number);

    if (Number.isFinite(topicId) && Number.isFinite(postNumber)) {
      iframe.src = `${location.origin}/t/${topicId}/${postNumber}`;
    } else if (state.currentUrl) {
      iframe.src = state.currentUrl;
    }
  }

  function setIframeModeEnabled(enabled) {
    state.root?.classList.toggle(IFRAME_MODE_CLASS, enabled);
    document.body.classList.toggle(PAGE_IFRAME_OPEN_CLASS, Boolean(state.currentUrl) && enabled);
  }

  function setTopicSearchOpen(isOpen) {
    if (!state.topicSearchPanel) return;
    state.topicSearchPanel.hidden = !isOpen;
    state.topicSearchButton.setAttribute("aria-expanded", String(isOpen));
    if (isOpen) {
      if (!state.topicSearchHighlightObserver) {
        state.topicSearchHighlightObserver = new MutationObserver(updateTopicSearchHighlights);
        state.topicSearchHighlightObserver.observe(state.content, { childList: true, subtree: true, characterData: true });
      }
      state.topicSearchInput.focus();
      return;
    }

    state.topicSearchAbortController?.abort();
    state.topicSearchAbortController = null;
    if (state.topicSearchPanel.contains(document.activeElement)) state.topicSearchButton.focus();
    state.topicSearchInput.value = "";
    state.topicSearchStatus.textContent = "";
    state.topicSearchResults.replaceChildren();
    state.topicSearchPanel.querySelectorAll("[data-search-page]").forEach((button) => { button.hidden = true; });
    state.topicSearchQuery = "";
    state.topicSearchPage = 1;
    state.topicSearchHighlightObserver?.disconnect();
    state.topicSearchHighlightObserver = null;
    updateTopicSearchHighlights();
  }

  function updateTopicSearchHighlights() {
    if (!globalThis.CSS?.highlights || typeof Highlight === "undefined") return;
    CSS.highlights.delete("ld-topic-search");
    if (!state.topicSearchQuery || state.topicSearchPanel.hidden) return;

    const terms = state.topicSearchQuery.split(/\s+/).filter(Boolean)
      .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const pattern = new RegExp(terms.join("|"), "giu");
    const highlight = new Highlight();
    // 原生高亮不修改正文 DOM，原站组件重绘后由观察器重建范围。
    for (const root of [state.topicSearchResults, ...state.content.querySelectorAll(".ld-post-body")]) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.parentElement?.closest("script, style, textarea, [hidden]")) continue;
        for (const match of node.textContent.matchAll(pattern)) {
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          highlight.add(range);
        }
      }
    }
    CSS.highlights.set("ld-topic-search", highlight);
  }

  async function searchCurrentTopic(query, page = 1) {
    const topicId = getTopicIdFromUrl(state.currentUrl, state.currentTopicIdHint);
    if (!query || !topicId || state.topicSearchPanel.hidden) return;
    state.topicSearchAbortController?.abort();
    const controller = new AbortController();
    state.topicSearchAbortController = controller;
    state.topicSearchStatus.textContent = "搜索中…";
    state.topicSearchResults.replaceChildren();
    state.topicSearchQuery = "";
    updateTopicSearchHighlights();
    const prev = state.topicSearchPanel.querySelector('[data-search-page="prev"]');
    const next = state.topicSearchPanel.querySelector('[data-search-page="next"]');
    prev.hidden = next.hidden = true;

    try {
      const url = new URL("/search.json", location.origin);
      // 主题限定词也避免短关键词被整站搜索的最小长度校验拦截。
      url.searchParams.set("q", `${query} topic:${topicId}`);
      url.searchParams.set("search_context[type]", "topic");
      url.searchParams.set("search_context[id]", String(topicId));
      url.searchParams.set("page", String(page));
      const response = await fetch(url.toString(), { credentials: "include", signal: controller.signal });
      if (!response.ok) throw new Error("Search failed");
      const data = await response.json();
      if (controller.signal.aborted) return;
      if (!data || data.errors || data.grouped_search_result?.error) throw new Error("Search failed");
      const posts = (Array.isArray(data.posts) ? data.posts : []).filter((post) =>
        Number(post?.topic_id) === topicId && Number.isSafeInteger(post?.post_number) && post.post_number > 0
      );
      for (const post of posts) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ld-topic-search-result";
        const snippet = new DOMParser().parseFromString(typeof post.blurb === "string" ? post.blurb : "", "text/html").body.textContent || "";
        button.textContent = `#${post.post_number} · ${post.username || ""} · ${snippet}`;
        button.title = "在当前侧栏定位楼层";
        button.addEventListener("click", () => {
          navigateToPost(post.post_number);
        });
        state.topicSearchResults.append(button);
      }
      state.topicSearchQuery = query;
      state.topicSearchPage = page;
      updateTopicSearchHighlights();
      const more = Boolean(data.grouped_search_result?.more_full_page_results || data.grouped_search_result?.more_posts);
      state.topicSearchStatus.textContent = posts.length
        ? `第 ${page} 页 · ${posts.length} 条结果${more && page >= 10 ? "；请缩小搜索范围查看更多" : ""}`
        : "当前帖子没有匹配内容。";
      prev.hidden = page <= 1;
      next.hidden = !more || page >= 10;
      state.topicSearchResults.scrollTop = 0;
    } catch {
      if (!controller.signal.aborted) state.topicSearchStatus.textContent = "搜索失败，请稍后重试，或调整关键词。";
    } finally {
      if (state.topicSearchAbortController === controller) state.topicSearchAbortController = null;
    }
  }

  async function handleLatestRepliesRefresh() {
    if (!state.currentUrl || state.isRefreshingLatestReplies || state.abortController) {
      return;
    }

    state.isRefreshingLatestReplies = true;
    syncLatestRepliesRefreshUI();

    try {
      await loadTopic(
        state.currentUrl,
        state.currentFallbackTitle,
        state.currentTopicIdHint,
        { preserveScrollTop: state.drawerBody?.scrollTop }
      );
    } finally {
      state.isRefreshingLatestReplies = false;
      syncLatestRepliesRefreshUI();
    }
  }

  function handleJumpToLatestPost() {
    if (!state.currentTopic || state.settings.postMode === "first") {
      return;
    }

    const latestPosts = state.currentLatestRepliesTopic?.post_stream?.posts || [];
    const loadedPosts = state.currentTopic.post_stream?.posts || [];
    const knownLatestPost = state.currentTargetSpec?.targetToken === "last"
      ? state.currentResolvedTargetPostNumber
      : (latestPosts.length || topicHasCompletePostStream(state.currentTopic)
        ? [...latestPosts, ...loadedPosts].reduce((latest, post) => Math.max(latest, Number(post?.post_number) || 0), 0)
        : null);
    const target = knownLatestPost
      ? state.content?.querySelector(`.ld-post-card[data-post-number="${knownLatestPost}"]`)
      : null;
    if (target) {
      target.scrollIntoView({ block: "start", behavior: "instant" });
      return;
    }

    const topicId = Number(state.currentTopic.id || state.currentTopicIdHint);
    if (!Number.isFinite(topicId)) {
      return;
    }

    const slug = typeof state.currentTopic.slug === "string" && state.currentTopic.slug.trim()
      ? state.currentTopic.slug.trim()
      : "topic";
    openDrawer(`${location.origin}/t/${slug}/${topicId}/last`, state.currentFallbackTitle, state.activeLink);
  }

  function shouldRefreshCurrentTopicOnRepeatOpen() {
    return canRefreshLatestReplies()
      && !state.isRefreshingLatestReplies
      && !state.abortController;
  }

  function refreshCurrentView() {
    if (!state.currentUrl) {
      return;
    }

    if (state.settings.previewMode === "iframe") {
      if (state.abortController) {
        state.abortController.abort();
        state.abortController = null;
      }

      if (!state.currentViewTracked) {
        state.currentTrackRequest = null;
        state.currentTrackRequestKey = "";
      }

      renderIframeFallback(state.currentUrl, state.currentFallbackTitle, null, true);
      syncLatestRepliesRefreshUI();
      return;
    }

    if (state.root?.classList.contains(IFRAME_MODE_CLASS)) {
      loadTopic(state.currentUrl, state.currentFallbackTitle, state.currentTopicIdHint);
      return;
    }

    if (state.currentTopic) {
      const targetSpec = getTopicTargetSpec(state.currentUrl, state.currentTopicIdHint);
      const needsTargetReload = shouldFetchTargetedTopic(state.currentTopic, targetSpec)
        && !state.currentResolvedTargetPostNumber;
      const needsLatestRepliesReload = shouldLoadLatestRepliesTopic(state.currentTopic, targetSpec)
        && !state.currentLatestRepliesTopic;

      if (!needsTargetReload && !needsLatestRepliesReload) {
        renderTopic(state.currentTopic, state.currentUrl, state.currentFallbackTitle, state.currentResolvedTargetPostNumber, {
          latestRepliesTopic: state.currentLatestRepliesTopic,
          targetSpec
        });
        return;
      }
    }

    loadTopic(state.currentUrl, state.currentFallbackTitle, state.currentTopicIdHint);
  }

  function canRefreshLatestReplies() {
    if (!state.currentUrl || !state.currentTopic) {
      return false;
    }

    if (state.root?.classList.contains(IFRAME_MODE_CLASS)) {
      return false;
    }

    if (state.settings.postMode === "first" || state.settings.replyOrder !== "latestFirst") {
      return false;
    }

    const targetSpec = state.currentTargetSpec || getTopicTargetSpec(state.currentUrl, state.currentTopicIdHint);
    if (targetSpec?.targetPostNumber) {
      return false;
    }

    if (targetSpec?.hasTarget && targetSpec.targetToken && targetSpec.targetToken !== "last") {
      return false;
    }

    return true;
  }

  function syncLatestRepliesRefreshUI() {
    if (!state.latestRepliesRefreshButton) {
      return;
    }

    const shouldShow = Boolean(state.currentUrl) && state.settingsPanel?.hidden && state.replyPanel?.hidden;
    if (state.topicSearchButton) state.topicSearchButton.hidden = !shouldShow;
    const isRefreshing = state.isRefreshingLatestReplies;
    state.latestRepliesRefreshButton.hidden = !shouldShow;
    state.latestRepliesRefreshButton.disabled = !shouldShow || isRefreshing || Boolean(state.abortController);
    state.latestRepliesRefreshButton.classList.toggle("is-refreshing", isRefreshing);
    const label = isRefreshing ? "刷新中..." : "刷新当前帖子";
    state.latestRepliesRefreshButton.title = label;
    state.latestRepliesRefreshButton.setAttribute("aria-label", label);
  }

  function shouldLoadLatestRepliesTopic(topic, targetSpec) {
    if (state.settings.postMode === "first" || state.settings.replyOrder !== "latestFirst") {
      return false;
    }

    if (targetSpec?.targetPostNumber) {
      return false;
    }

    if (targetSpec?.hasTarget && targetSpec.targetToken && targetSpec.targetToken !== "last") {
      return false;
    }

    return !topicHasCompletePostStream(topic);
  }

  function getLatestRepliesDisplayPosts(topic, latestRepliesTopic) {
    const firstPost = getFirstTopicPost(topic) || getFirstTopicPost(latestRepliesTopic);
    const replies = [];
    const seenPostNumbers = new Set();

    for (const post of latestRepliesTopic?.post_stream?.posts || []) {
      if (typeof post?.post_number !== "number") {
        continue;
      }

      if (firstPost && post.post_number === firstPost.post_number) {
        continue;
      }

      if (seenPostNumbers.has(post.post_number)) {
        continue;
      }

      seenPostNumbers.add(post.post_number);
      replies.push(post);
    }

    replies.sort((left, right) => right.post_number - left.post_number);

    if (!firstPost) {
      return replies;
    }

    return [firstPost, ...replies];
  }

  function getFirstTopicPost(topic) {
    const posts = topic?.post_stream?.posts || [];
    return posts.find((post) => post?.post_number === 1) || posts[0] || null;
  }

  function buildReplyModeNote(viewModel) {
    if (viewModel.mode === "latestComplete") {
      return `当前为\u201C首帖 + 最新回复\u201D模式。首帖固定在顶部，其余回复按从新到旧显示。`;
    }

    if (viewModel.mode === "latestWindow") {
      return `当前为\u201C首帖 + 最新回复\u201D模式。首帖固定在顶部，下面显示的是最新一批回复；长帖不会一次性把整帖完整倒序。`;
    }

    if (viewModel.mode === "latestUnavailable") {
      return `当前已切到\u201C首帖 + 最新回复\u201D模式，但这次没拿到最新回复窗口，暂按当前顺序显示。`;
    }

    return "";
  }

  function buildAuthorFilterNote(viewModel, topicOwner) {
    if (viewModel.authorFilter !== "topicOwner") {
      return "";
    }

    if (viewModel.filterUnavailable || !topicOwner) {
      return `当前已切到\u201C只看楼主\u201D模式，但这次没识别出楼主身份，暂按当前结果显示。`;
    }

    const ownerLabel = topicOwner.displayUsername ? `@${topicOwner.displayUsername}` : "楼主";
    if (Number.isFinite(viewModel.preservedTargetPostNumber)) {
      return `当前为\u201C只看楼主\u201D模式，已保留当前定位的 #${viewModel.preservedTargetPostNumber}，其余仅显示 ${ownerLabel} 的发言。`;
    }

    if (!viewModel.posts.length && viewModel.canAutoLoadMore) {
      return `当前为\u201C只看楼主\u201D模式，已加载范围内还没有 ${ownerLabel} 的更多发言，继续下滑会继续尝试加载。`;
    }

    return `当前为\u201C只看楼主\u201D模式，仅显示 ${ownerLabel} 的发言。`;
  }

  function getLatestRepliesTopicUrl(topicUrl, topicIdHint = null) {
    const url = new URL(topicUrl);
    const parsed = parseTopicPath(url.pathname, topicIdHint);

    url.hash = "";
    url.search = "";
    url.pathname = parsed?.topicPath
      ? `${parsed.topicPath}/last`
      : `${stripTrailingSlash(url.pathname)}/last`;

    return url.toString().replace(/\/$/, "");
  }

  async function fetchLatestRepliesTopic(topicUrl, signal, topicIdHint = null) {
    return fetchTrackedTopicJson(getLatestRepliesTopicUrl(topicUrl, topicIdHint), signal, topicIdHint, {
      canonical: false,
      trackVisit: false
    });
  }

  function renderLoading() {
    return `
      <div class="ld-loading-state" aria-label="loading">
        <div class="ld-loading-bar"></div>
        <div class="ld-loading-bar ld-loading-bar-short"></div>
        <div class="ld-loading-card"></div>
        <div class="ld-loading-card"></div>
      </div>
    `;
  }

  function toTopicJsonUrl(topicUrl, options = {}) {
    const { canonical = false, trackVisit = true, topicIdHint = null } = options;
    const url = new URL(topicUrl);
    const parsed = parseTopicPath(url.pathname, topicIdHint);

    url.hash = "";
    url.search = "";
    url.pathname = `${canonical ? (parsed?.topicPath || stripTrailingSlash(url.pathname)) : stripTrailingSlash(url.pathname)}.json`;
    if (trackVisit) {
      url.searchParams.set("track_visit", "true");
    }
    return url.toString();
  }

  async function fetchTrackedTopicJson(topicUrl, signal, topicIdHint = null, options = {}) {
    const { canonical = false, trackVisit = true } = options;
    const topicId = topicIdHint || getTopicIdFromUrl(topicUrl);
    const response = await fetch(toTopicJsonUrl(topicUrl, { canonical, trackVisit, topicIdHint }), {
      credentials: "include",
      cache: "no-store",
      signal,
      headers: trackVisit ? buildTopicRequestHeaders(topicId) : { Accept: "application/json" }
    });

    const contentType = response.headers.get("content-type") || "";

    if (!response.ok || !contentType.includes("json")) {
      throw new Error(`Unexpected response: ${response.status}`);
    }

    return response.json();
  }

  function ensureTrackedTopicVisit(topicUrl, topicIdHint = null, signal) {
    const trackingKey = getTopicTrackingKey(topicUrl, topicIdHint);

    if (state.currentTrackRequest && state.currentTrackRequestKey === trackingKey) {
      return state.currentTrackRequest;
    }

    const request = fetchTrackedTopicJson(topicUrl, signal, topicIdHint, {
      canonical: true,
      trackVisit: true
    }).then((topic) => {
      const entry = state.topicCache.get(getTopicCacheKey(topicUrl));
      if (entry) entry.currentViewTracked = true;
      if (state.currentTopicTrackingKey === trackingKey) {
        state.currentViewTracked = true;
      }
      return topic;
    }).finally(() => {
      if (state.currentTrackRequest === request) {
        state.currentTrackRequest = null;
        state.currentTrackRequestKey = "";
      }
    });

    state.currentTrackRequest = request;
    state.currentTrackRequestKey = trackingKey;
    return request;
  }

  function trackCurrentTopicVisit() {
    if (state.settings.trackPreviewVisit !== "on" || state.currentViewTracked ||
        !state.currentTopic || state.currentTopic.__sidePeekIframeShell) return;
    ensureTrackedTopicVisit(state.currentUrl, state.currentTopicIdHint, state.abortController?.signal).catch(() => {});
  }

  function toTopicPostsJsonUrl(topicUrl, postIds, topicIdHint = null) {
    const url = new URL(topicUrl);
    const parsed = parseTopicPath(url.pathname, topicIdHint);

    url.hash = "";
    url.search = "";
    url.pathname = parsed?.topicId
      ? `/t/${parsed.topicId}/posts.json`
      : `${stripTrailingSlash(url.pathname)}/posts.json`;

    for (const postId of postIds) {
      if (Number.isFinite(postId)) {
        url.searchParams.append("post_ids[]", String(postId));
      }
    }

    return url.toString().replace(/\/$/, "");
  }

  async function fetchTopicPostsBatch(topicUrl, postIds, signal, topicIdHint = null) {
    const response = await fetch(toTopicPostsJsonUrl(topicUrl, postIds, topicIdHint), {
      credentials: "include",
      signal,
      headers: {
        Accept: "application/json"
      }
    });

    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.includes("json")) {
      throw new Error(`Unexpected response: ${response.status}`);
    }

    const data = await response.json();
    return data?.post_stream?.posts || [];
  }

  async function createTopicReply(topicId, raw, signal, replyToPostNumber = null) {
    const csrfToken = getCsrfToken();
    if (!csrfToken) {
      throw new Error("未找到登录令牌，请刷新页面后重试");
    }

    const body = new URLSearchParams();
    body.set("raw", raw);
    body.set("topic_id", String(topicId));
    if (Number.isFinite(replyToPostNumber)) {
      body.set("reply_to_post_number", String(replyToPostNumber));
    }

    const response = await fetch(`${location.origin}/posts.json`, {
      method: "POST",
      credentials: "include",
      signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "X-CSRF-Token": csrfToken
      },
      body
    });

    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("json")
      ? await response.json()
      : null;

    if (!response.ok) {
      const message = Array.isArray(data?.errors) && data.errors.length > 0
        ? data.errors.join("；")
        : (data?.error || `Unexpected response: ${response.status}`);
      throw new Error(message);
    }

    return data;
  }

  async function populateReactionsPopover(popoverEl, post, reactBtn) {
    const available = await fetchAvailableReactions();
    const reactions = Array.isArray(post.reactions) ? post.reactions : [];

    popoverEl.replaceChildren();

    for (const r of available) {
      const existing = reactions.find((rx) => rx.id === r.id);
      const count = existing?.count || 0;
      const isActive = post.current_user_reaction?.id === r.id || existing?.reacted === true
        || (r.id === "heart" && (post.actions_summary?.find((a) => a.id === 2)?.acted === true));

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ld-reaction-btn" + (isActive ? " ld-reaction-btn--active" : "");
      btn.setAttribute("aria-label", r.id + (count > 0 ? ` (${count})` : ""));
      btn.title = r.id;
      btn.setAttribute("aria-pressed", String(isActive));

      const img = document.createElement("img");
      img.alt = `:${r.id}:`;
      img.loading = "lazy";
      img.src = buildReactionEmojiSrc(r.id);
      img.onerror = () => {
        img.onerror = null;
        btn.hidden = true;
        btn.style.display = "none";
      };

      const countEl = document.createElement("span");
      countEl.className = "ld-reaction-btn-count";
      countEl.textContent = count > 0 ? String(count) : "";

      btn.append(img, countEl);
      btn.addEventListener("click", () => {
        closeAllPopovers();
        reactBtn.focus();
        handlePostReact(reactBtn, post, r.id, popoverEl);
      });

      popoverEl.appendChild(btn);
    }
  }

  async function fetchAvailableReactions() {
    if (state.availableReactions) {
      return state.availableReactions;
    }

    // 1. Read from Discourse's live Ember app (most reliable — TM @grant none runs in page context)
    try {
      const siteSettings = PAGE_WINDOW.Discourse?.SiteSettings;
      if (siteSettings) {
        const enabledStr = siteSettings.discourse_reactions_enabled_reactions;
        if (typeof enabledStr === "string" && enabledStr.trim()) {
          const ids = enabledStr.split("|").map((s) => s.trim()).filter(Boolean);
          if (ids.length > 0) {
            state.availableReactions = ids.map((id) => ({ id, type: "emoji" }));
            return state.availableReactions;
          }
        }
      }
    } catch { /* ignore */ }

    // 2. Try API endpoint (works when authenticated and endpoint exists)
    try {
      const res = await fetch(`${location.origin}/discourse-reactions/custom-reactions`, {
        credentials: "include",
        headers: { Accept: "application/json" }
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length) {
          state.availableReactions = data;
          return state.availableReactions;
        }
      }
    } catch { /* ignore */ }

    // 3. Reasonable fallback matching Discourse defaults
    state.availableReactions = [
      { id: "heart", type: "emoji" },
      { id: "+1", type: "emoji" },
      { id: "laughing", type: "emoji" },
      { id: "open_mouth", type: "emoji" },
      { id: "cry", type: "emoji" },
      { id: "angry", type: "emoji" },
      { id: "tada", type: "emoji" }
    ];
    return state.availableReactions;
  }

  const REACTION_URL_CACHE = {};

  function buildReactionEmojiSrc(reactionId) {
    if (REACTION_URL_CACHE[reactionId]) {
      return REACTION_URL_CACHE[reactionId];
    }

    const set = (url) => {
      if (url) REACTION_URL_CACHE[reactionId] = url;
      return url;
    };

    // 1. Discourse AMD module for standard emojis (heart, +1, laughing, etc.)
    try {
      for (const loaderKey of ["require", "requirejs"]) {
        const loader = PAGE_WINDOW[loaderKey];
        if (typeof loader !== "function") continue;
        for (const modPath of ["discourse/lib/emoji", "discourse-common/utils/emoji"]) {
          try {
            const mod = loader(modPath);
            if (!mod) continue;
            const buildFn = mod.buildEmojiUrl || mod.default?.buildEmojiUrl
              || mod.emojiUrlFor || mod.default?.emojiUrlFor;
            if (typeof buildFn === "function") {
              const url = buildFn(reactionId, PAGE_WINDOW.Discourse?.SiteSettings);
              if (url) return set(url);
            }
          } catch { /* ignore */ }
        }
        break;
      }
    } catch { /* ignore */ }

    // 2. Standard emoji path fallback
    const emojiSet = PAGE_WINDOW.Discourse?.SiteSettings?.emoji_set || "twitter";
    return `/images/emoji/${emojiSet}/${encodeURIComponent(reactionId)}.png`;
  }

  function showToast(message, type = "info", duration = 2200, dismissible = false) {
    if (!state.toastStack || !message) {
      return;
    }

    const toast = document.createElement("div");
    toast.className = "ld-toast";
    toast.dataset.type = type;
    toast.setAttribute("role", type === "error" ? "alert" : "status");
    toast.textContent = String(message);
    state.toastStack.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add("is-visible"));
    const remove = () => {
      toast.classList.remove("is-visible");
      window.setTimeout(() => toast.remove(), 180);
    };
    if (dismissible) {
      toast.classList.add("ld-toast-dismissible");
      const close = document.createElement("button");
      close.type = "button";
      close.className = "ld-toast-close";
      close.setAttribute("aria-label", "关闭预览提示");
      close.textContent = "×";
      close.addEventListener("click", remove);
      toast.append(close);
    }
    window.setTimeout(remove, Math.max(900, Number(duration) || 2200));
  }

  async function handlePostReact(reactBtn, post, reactionId, popoverEl) {
    if (reactBtn.disabled) return;
    reactBtn.disabled = true;
    try {
      const reactions = Array.isArray(post.reactions) ? post.reactions : [];
      const like = post.actions_summary?.find((action) => action.id === 2);
      const previous = post.current_user_reaction?.id || reactions.find((r) => r.reacted)?.id || (like?.acted ? "heart" : null);
      const undo = previous === reactionId;
      const updated = await performToggleReaction(post.id, reactionId, undo);
      if (Array.isArray(updated?.reactions)) {
        post.reactions = updated.reactions;
        post.current_user_reaction = updated.current_user_reaction === undefined
          ? (undo ? null : { id: reactionId, can_undo: true }) : updated.current_user_reaction;
        post.reaction_users_count = updated.reaction_users_count
          ?? updated.reactions.reduce((sum, r) => sum + (r.count || 0), 0);
      } else {
        const legacyCount = post.like_count || like?.count || 0;
        const counts = reactions.length ? reactions : legacyCount ? [{ id: "heart", type: "emoji", count: legacyCount }] : [];
        const next = counts.map((r) => ({ ...r, reacted: false, count: Math.max(0, r.count - (r.id === previous ? 1 : 0)) }));
        if (!undo) {
          const selected = next.find((r) => r.id === reactionId);
          if (selected) selected.count++;
          else next.push({ id: reactionId, type: "emoji", count: 1 });
        }
        post.reactions = next.filter((r) => r.count > 0);
        post.current_user_reaction = undo ? null : { id: reactionId, can_undo: true };
        post.reaction_users_count = Math.max(0, (post.reaction_users_count ?? (reactions.reduce((sum, r) => sum + (r.count || 0), 0) || post.like_count || like?.count || 0)) + (undo ? -1 : previous ? 0 : 1));
      }
      post.like_count = post.reaction_users_count;
      if (like) {
        like.acted = post.current_user_reaction?.id === "heart";
        like.count = post.reactions.find((r) => r.id === "heart")?.count || 0;
      }
      renderPostReactionButton(reactBtn, post);
      if (popoverEl) delete popoverEl.dataset.loaded;
    } catch (error) {
      showToast(`反应失败：${error?.message || "请求未完成"}`, "error");
    } finally {
      reactBtn.disabled = false;
    }
  }

  async function performToggleReaction(postId, reactionId, undo) {
    const csrfToken = getCsrfToken();
    if (!csrfToken) {
      throw new Error("未找到 CSRF 令牌");
    }

    const response = await fetch(
      `${location.origin}/discourse-reactions/posts/${postId}/custom-reactions/${encodeURIComponent(reactionId)}/toggle`,
      {
        method: "PUT",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "X-CSRF-Token": csrfToken
        }
      }
    );

    if (!response.ok) {
      if (reactionId === "heart" && [404, 405].includes(response.status)) {
        return performLegacyLikeToggle(postId, undo);
      }
      const data = await response.json().catch(() => null);
      throw new Error(
        Array.isArray(data?.errors) && data.errors.length
          ? data.errors.join("；")
          : `反应失败：${response.status}`
      );
    }

    return response.json().catch(() => null);
  }

  async function performLegacyLikeToggle(postId, undo) {
    const csrfToken = getCsrfToken();
    if (!csrfToken) {
      throw new Error("未找到 CSRF 令牌");
    }

    const likeRes = await fetch(undo
      ? `${location.origin}/post_actions/${postId}?post_action_type_id=2`
      : `${location.origin}/post_actions`, {
      method: undo ? "DELETE" : "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "X-CSRF-Token": csrfToken
      },
      body: undo ? undefined : new URLSearchParams({ id: String(postId), post_action_type_id: "2", flag_topic: "false" })
    });

    if (likeRes.ok) {
      return null;
    }

    throw new Error(`操作失败：${likeRes.status}`);
  }

  async function handleCopyPostLink(btn, post) {
    const topicId = state.currentTopic?.id || post.topic_id;
    const topicSlug = state.currentTopic?.slug || "";
    const postNum = post.post_number;

    const url = topicSlug
      ? `${location.origin}/t/${topicSlug}/${topicId}/${postNum}`
      : `${location.origin}/t/topic/${topicId}/${postNum}`;

    try {
      await navigator.clipboard.writeText(url);
      const origHTML = btn.innerHTML;
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;
      setTimeout(() => {
        btn.innerHTML = origHTML;
      }, 1500);
      showToast("帖子链接已复制", "success", 1500);
    } catch (error) {
      showToast(`复制失败：${error?.message || "浏览器未授权剪贴板"}`, "error");
    }
  }

  async function handlePostBookmark(btn, post) {
    if (btn.disabled) {
      return;
    }

    btn.disabled = true;
    const wasBookmarked = post.bookmarked === true;

    try {
      if (wasBookmarked && post.bookmark_id) {
        await performDeleteBookmark(post.bookmark_id);
        post.bookmarked = false;
        post.bookmark_id = null;
      } else {
        const result = await performCreateBookmark(post.id);
        post.bookmarked = true;
        if (result?.id) {
          post.bookmark_id = result.id;
        }
      }

      const nowBookmarked = post.bookmarked === true;
      showToast(nowBookmarked ? "已添加书签" : "已取消书签", "success");
      btn.className = "ld-post-icon-btn" + (nowBookmarked ? " ld-post-icon-btn--bookmarked" : "");
      btn.setAttribute("aria-label", nowBookmarked ? "取消书签" : "添加书签");
      btn.innerHTML = nowBookmarked
        ? `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v17l-7-3.5L5 21V4z"/></svg>`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v17l-7-3.5L5 21V4z"/></svg>`;
    } catch (error) {
      showToast(`书签操作失败：${error?.message || "请求未完成"}`, "error");
    } finally {
      btn.disabled = false;
    }
  }

  async function performCreateBookmark(postId) {
    const csrfToken = getCsrfToken();
    if (!csrfToken) {
      throw new Error("未找到 CSRF 令牌");
    }

    const response = await fetch(`${location.origin}/bookmarks`, {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "X-CSRF-Token": csrfToken
      },
      body: JSON.stringify({ bookmarkable_type: "Post", bookmarkable_id: postId })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.errors?.join("；") || `书签失败：${response.status}`);
    }

    return response.json().catch(() => null);
  }

  async function performDeleteBookmark(bookmarkId) {
    const csrfToken = getCsrfToken();
    if (!csrfToken) {
      throw new Error("未找到 CSRF 令牌");
    }

    const response = await fetch(`${location.origin}/bookmarks/${bookmarkId}`, {
      method: "DELETE",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "X-CSRF-Token": csrfToken
      }
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.errors?.join("；") || `取消书签失败：${response.status}`);
    }
  }

  function buildFlagPopover(post) {
    const popover = document.createElement("div");
    popover.className = "ld-flag-popover";
    popover.setAttribute("role", "menu");

    const flagOptions = [
      {
        id: 3,
        label: "垃圾信息",
        description: "此帖子是广告或垃圾内容",
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`
      },
      {
        id: 4,
        label: "不当内容",
        description: "此帖子包含令人反感的内容",
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
      },
      {
        id: 7,
        label: "需要版主关注",
        description: "需要版主处理的问题",
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`
      }
    ];

    for (const opt of flagOptions) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ld-flag-option";
      btn.setAttribute("role", "menuitem");
      btn.title = opt.description;
      btn.innerHTML = `${opt.icon}<span>${opt.label}</span>`;
      btn.addEventListener("click", () => handleFlagPost(post.id, opt.id, popover));
      popover.appendChild(btn);
    }

    return popover;
  }

  async function handleFlagPost(postId, actionTypeId, popoverEl) {
    popoverEl.setAttribute("hidden", "");

    try {
      await performFlagPost(postId, actionTypeId);
      showToast("举报已提交", "success");
    } catch (error) {
      showToast(`举报失败：${error?.message || "请求未完成"}`, "error");
    }
  }

  async function performFlagPost(postId, actionTypeId) {
    const csrfToken = getCsrfToken();
    if (!csrfToken) {
      throw new Error("未找到 CSRF 令牌");
    }

    const response = await fetch(`${location.origin}/post_actions`, {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "X-CSRF-Token": csrfToken
      },
      body: new URLSearchParams({
        id: String(postId),
        post_action_type_id: String(actionTypeId),
        flag_topic: "false"
      })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.errors?.join("；") || `举报失败：${response.status}`);
    }
  }

  async function createComposerUpload(file, signal, options = {}) {
    const csrfToken = getCsrfToken();
    if (!csrfToken) {
      throw new Error("未找到登录令牌，请刷新页面后重试");
    }

    const formData = new FormData();
    formData.set("upload_type", "composer");
    formData.set("file", file, file.name || "image.png");
    if (options.pasted) {
      formData.set("pasted", "true");
    }

    const response = await fetch(`${location.origin}/uploads.json`, {
      method: "POST",
      credentials: "include",
      signal,
      headers: {
        Accept: "application/json",
        "X-CSRF-Token": csrfToken
      },
      body: formData
    });

    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("json")
      ? await response.json()
      : null;

    if (!response.ok) {
      const message = Array.isArray(data?.errors) && data.errors.length > 0
        ? data.errors.join("；")
        : (data?.message || data?.error || `Unexpected response: ${response.status}`);
      throw new Error(message);
    }

    if (!data || typeof data !== "object") {
      throw new Error(`Unexpected response: ${response.status}`);
    }

    return data;
  }

  function buildComposerUploadMarkdown(upload) {
    const fileName = upload?.original_filename || "image.png";
    const uploadUrl = upload?.short_url || upload?.url || "";
    if (!uploadUrl) {
      throw new Error("上传成功但未返回可用图片地址");
    }

    if (isImageUploadName(fileName)) {
      return buildComposerImageMarkdown(upload, uploadUrl);
    }

    return `[${fileName}|attachment](${uploadUrl})`;
  }

  function buildComposerImageMarkdown(upload, uploadUrl) {
    const altText = markdownNameFromFileName(upload?.original_filename || "image.png");
    const width = Number(upload?.thumbnail_width || upload?.width || 0);
    const height = Number(upload?.thumbnail_height || upload?.height || 0);
    const sizeSegment = width > 0 && height > 0
      ? `|${width}x${height}`
      : "";

    return `![${altText}${sizeSegment}](${uploadUrl})`;
  }

  function markdownNameFromFileName(fileName) {
    const normalized = String(fileName || "").trim();
    const dotIndex = normalized.lastIndexOf(".");
    const baseName = dotIndex > 0
      ? normalized.slice(0, dotIndex)
      : normalized;

    return (baseName || "image").replace(/[\[\]|]/g, "");
  }

  function isImageUploadName(fileName) {
    return /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(String(fileName || ""));
  }

  function closeAllPopovers() {
    state.root?.querySelectorAll(".ld-reactions-popover, .ld-flag-popover, .ld-post-replies-popover").forEach((p) => {
      p.setAttribute("hidden", "");
    });
    state.root?.querySelectorAll(".ld-post-info-item--replies-trigger, .ld-post-react-btn").forEach((btn) => {
      btn.setAttribute("aria-expanded", "false");
    });
  }

  function getCsrfToken() {
    const token = document.querySelector('meta[name="csrf-token"]')?.getAttribute("content") || "";
    return token.trim();
  }

  function buildTopicRequestHeaders(topicId) {
    const headers = {
      Accept: "application/json"
    };

    if (topicId) {
      headers["Discourse-Track-View"] = "true";
      headers["Discourse-Track-View-Topic-Id"] = String(topicId);
    }

    return headers;
  }

  function getTopicStreamIds(topic) {
    const stream = topic?.post_stream?.stream;
    if (Array.isArray(stream) && stream.length > 0) {
      return stream.filter((postId) => Number.isFinite(postId));
    }

    return (topic?.post_stream?.posts || [])
      .map((post) => post?.id)
      .filter((postId) => Number.isFinite(postId));
  }

  function getLoadedTopicPostIds(topic) {
    return (topic?.post_stream?.posts || [])
      .map((post) => post?.id)
      .filter((postId) => Number.isFinite(postId));
  }

  function getNextTopicPostIds(topic, batchSize = LOAD_MORE_BATCH_SIZE) {
    const streamIds = getTopicStreamIds(topic);
    if (!streamIds.length) {
      return [];
    }

    const loadedPostIds = new Set(getLoadedTopicPostIds(topic));
    return streamIds.filter((postId) => !loadedPostIds.has(postId)).slice(0, batchSize);
  }

  function hasMoreTopicPosts(topic) {
    if (getNextTopicPostIds(topic, 1).length > 0) {
      return true;
    }

    const posts = topic?.post_stream?.posts || [];
    const totalPosts = Number(topic?.posts_count || 0);
    return totalPosts > 0 && posts.length < totalPosts;
  }

  function topicHasPostNumber(topic, postNumber) {
    if (!postNumber) {
      return false;
    }

    return (topic?.post_stream?.posts || []).some((post) => post?.post_number === postNumber);
  }

  function getTopicTargetSpec(topicUrl, topicIdHint = null) {
    try {
      const parsed = parseTopicPath(new URL(topicUrl).pathname, topicIdHint);
      if (!parsed) {
        return null;
      }

      return {
        hasTarget: parsed.targetSegments.length > 0,
        targetSegments: parsed.targetSegments,
        targetPostNumber: parsed.targetPostNumber,
        targetToken: parsed.targetToken
      };
    } catch {
      return null;
    }
  }

  function shouldFetchTargetedTopic(topic, targetSpec) {
    if (!targetSpec?.hasTarget || (state.settings.postMode === "first" && !targetSpec.targetPostNumber)) {
      return false;
    }

    if (targetSpec.targetPostNumber) {
      return !topicHasPostNumber(topic, targetSpec.targetPostNumber);
    }

    if (targetSpec.targetToken === "last") {
      return !topicHasCompletePostStream(topic);
    }

    return true;
  }

  function topicHasCompletePostStream(topic) {
    return !hasMoreTopicPosts(topic);
  }

  function resolveTopicTargetPostNumber(targetSpec, topic, targetedTopic) {
    if (!targetSpec?.hasTarget) {
      return null;
    }

    if (targetSpec.targetPostNumber) {
      if (topicHasPostNumber(targetedTopic, targetSpec.targetPostNumber) || topicHasPostNumber(topic, targetSpec.targetPostNumber)) {
        return targetSpec.targetPostNumber;
      }
      return null;
    }

    const sourcePosts = targetedTopic?.post_stream?.posts || [];
    if (sourcePosts.length > 0) {
      if (targetSpec.targetToken === "last") {
        return sourcePosts[sourcePosts.length - 1]?.post_number || null;
      }

      return sourcePosts[0]?.post_number || null;
    }

    const fallbackPosts = topic?.post_stream?.posts || [];
    if (targetSpec.targetToken === "last" && topicHasCompletePostStream(topic) && fallbackPosts.length > 0) {
      return fallbackPosts[fallbackPosts.length - 1]?.post_number || null;
    }

    return null;
  }

  function mergeTopicPreviewData(primaryTopic, supplementalTopic) {
    const mergedPosts = new Map();
    const mergedStream = [];
    const seenStreamPostIds = new Set();

    for (const post of primaryTopic?.post_stream?.posts || []) {
      if (typeof post?.post_number === "number") {
        mergedPosts.set(post.post_number, post);
      }
    }

    for (const post of supplementalTopic?.post_stream?.posts || []) {
      if (typeof post?.post_number === "number" && !mergedPosts.has(post.post_number)) {
        mergedPosts.set(post.post_number, post);
      }
    }

    for (const postId of getTopicStreamIds(primaryTopic)) {
      if (!seenStreamPostIds.has(postId)) {
        seenStreamPostIds.add(postId);
        mergedStream.push(postId);
      }
    }

    for (const postId of getTopicStreamIds(supplementalTopic)) {
      if (!seenStreamPostIds.has(postId)) {
        seenStreamPostIds.add(postId);
        mergedStream.push(postId);
      }
    }

    for (const postId of getLoadedTopicPostIds({ post_stream: { posts: Array.from(mergedPosts.values()) } })) {
      if (!seenStreamPostIds.has(postId)) {
        seenStreamPostIds.add(postId);
        mergedStream.push(postId);
      }
    }

    const posts = Array.from(mergedPosts.values()).sort((left, right) => left.post_number - right.post_number);

    return {
      ...primaryTopic,
      posts_count: Math.max(Number(primaryTopic?.posts_count || 0), Number(supplementalTopic?.posts_count || 0)) || primaryTopic?.posts_count || supplementalTopic?.posts_count,
      post_stream: {
        ...(primaryTopic?.post_stream || {}),
        stream: mergedStream,
        posts
      }
    };
  }

  function appendCreatedReplyToCurrentTopic(createdPost) {
    if (!state.currentTopic || !createdPost || typeof createdPost !== "object") {
      return;
    }

    const createdPostId = Number(createdPost.id);
    const createdPostNumber = Number(createdPost.post_number);
    if (!Number.isFinite(createdPostId) || !Number.isFinite(createdPostNumber)) {
      return;
    }

    const previousScrollTop = state.drawerBody?.scrollTop || 0;
    const nextTopic = mergeTopicPreviewData(state.currentTopic, {
      posts_count: Math.max(
        Number(state.currentTopic.posts_count || 0),
        Number(createdPost.topic_posts_count || 0),
        (state.currentTopic.post_stream?.posts || []).length + 1
      ),
      post_stream: {
        stream: [createdPostId],
        posts: [createdPost]
      }
    });

    renderTopic(nextTopic, state.currentUrl, state.currentFallbackTitle, null, {
      targetSpec: state.currentTargetSpec,
      preserveScrollTop: previousScrollTop
    });

    requestAnimationFrame(() => {
      const target = state.content?.querySelector(`.ld-post-card[data-post-number="${createdPostNumber}"]`);
      target?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }

  function isPrimaryTopicLink(link) {
    if (!(link instanceof HTMLAnchorElement)) {
      return false;
    }

    if (link.closest(LIST_ROW_SELECTOR)) {
      return link.matches(PRIMARY_TOPIC_LINK_SELECTOR);
    }

    return link.matches(PRIMARY_TOPIC_LINK_SELECTOR);
  }

  function buildEntryKey(url, occurrence) {
    return occurrence > 1 ? `${url}::${occurrence}` : url;
  }

  function getTopicEntryContainer(link) {
    if (!(link instanceof Element)) {
      return null;
    }

    return link.closest(ENTRY_CONTAINER_SELECTOR)
      || link.closest("[data-topic-id]")
      || link;
  }

  function readTopicIdHint(element) {
    if (!(element instanceof Element)) {
      return null;
    }

    const rawTopicId = element.getAttribute("data-topic-id") || element.dataset?.topicId || "";
    return /^\d+$/.test(rawTopicId) ? Number(rawTopicId) : null;
  }

  function getTopicIdHintFromLink(link) {
    if (!(link instanceof Element)) {
      return null;
    }

    const directTopicId = readTopicIdHint(link);
    if (directTopicId) {
      return directTopicId;
    }

    const hintedAncestor = link.closest("[data-topic-id]");
    if (hintedAncestor) {
      return readTopicIdHint(hintedAncestor);
    }

    return readTopicIdHint(getTopicEntryContainer(link));
  }

  function getTopicTrackingKey(topicUrl, topicIdHint = null) {
    try {
      const parsed = parseTopicPath(new URL(topicUrl).pathname, topicIdHint);
      if (parsed?.topicId) {
        return `topic:${parsed.topicId}`;
      }
      return parsed?.topicPath || topicUrl;
    } catch {
      return topicUrl;
    }
  }

  function normalizeTopicUrl(url) {
    const parsed = parseTopicPath(url.pathname);

    url.hash = "";
    url.search = "";
    url.pathname = parsed?.destinationPath || stripTrailingSlash(url.pathname);

    return url.toString().replace(/\/$/, "");
  }

  function getTopicIdFromUrl(topicUrl, topicIdHint = null) {
    try {
      return parseTopicPath(new URL(topicUrl).pathname, topicIdHint)?.topicId || null;
    } catch {
      return null;
    }
  }

  function getTopicTargetPostNumber(topicUrl, topicIdHint = null) {
    return getTopicTargetSpec(topicUrl, topicIdHint)?.targetPostNumber || null;
  }

  function navigateToPost(postNumber) {
    const numericPostNumber = Number(postNumber);
    if (!Number.isSafeInteger(numericPostNumber) || numericPostNumber <= 0) {
      return false;
    }

    const target = state.content?.querySelector(`.ld-post-card[data-post-number="${numericPostNumber}"]`);
    if (target) {
      target.scrollIntoView({ block: "start", behavior: "smooth" });
      return true;
    }

    const url = buildAbsoluteTopicPostUrl(state.currentTopic, numericPostNumber, state.currentTopicIdHint);
    if (url) {
      openDrawer(url, state.currentFallbackTitle, state.activeLink);
      return true;
    }

    showToast(`暂时无法定位第 ${numericPostNumber} 楼`, "error");
    return false;
  }

  function scrollTopicViewToTargetPost(targetPostNumber) {
    if (!targetPostNumber) {
      return;
    }

    requestAnimationFrame(() => {
      const target = state.content?.querySelector(`.ld-post-card[data-post-number="${targetPostNumber}"]`);
      target?.scrollIntoView({ block: "start", behavior: "auto" });
    });
  }

  function parseTopicPath(pathname, topicIdHint = null) {
    const trimmedPath = stripTrailingSlash(pathname);
    const segments = trimmedPath.split("/");
    const first = segments[2] || "";
    const second = segments[3] || "";

    if (segments[1] !== "t") {
      return null;
    }

    const firstIsNumber = /^\d+$/.test(first);
    const secondIsNumber = /^\d+$/.test(second);

    let topicId = null;
    let topicPath = "";
    let extraSegments = [];

    if (firstIsNumber) {
      topicId = Number(first);
      topicPath = `/t/${first}`;
      extraSegments = segments.slice(3).filter(Boolean);
    } else if (secondIsNumber) {
      topicId = Number(second);
      topicPath = `/t/${first}/${second}`;
      extraSegments = segments.slice(4).filter(Boolean);
    } else {
      return null;
    }

    const destinationPath = extraSegments.length > 0
      ? `${topicPath}/${extraSegments.join("/")}`
      : topicPath;
    const targetPostNumber = /^\d+$/.test(extraSegments[0] || "")
      ? Number(extraSegments[0])
      : null;
    const targetToken = !targetPostNumber && extraSegments[0]
      ? String(extraSegments[0])
      : null;

    return {
      topicId,
      topicPath,
      destinationPath,
      targetSegments: extraSegments,
      targetPostNumber,
      targetToken
    };
  }

  function stripTrailingSlash(pathname) {
    return pathname.replace(/\/+$/, "") || pathname;
  }

  function avatarUrl(template) {
    if (!template) {
      return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96'%3E%3Crect width='96' height='96' fill='%23d8dee9'/%3E%3C/svg%3E";
    }

    return new URL(template.replace("{size}", "96"), location.origin).toString();
  }

  function normalizeUsername(value) {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
  }

  function getTopicOwnerIdentity(topic) {
    const createdBy = topic?.created_by && typeof topic.created_by === "object"
      ? topic.created_by
      : (topic?.details?.created_by && typeof topic.details.created_by === "object" ? topic.details.created_by : null);

    if (!createdBy) {
      return null;
    }

    const displayUsername = typeof createdBy.username === "string" ? createdBy.username.trim() : "";
    const normalizedUsername = normalizeUsername(createdBy.username);
    const userId = Number.isFinite(createdBy.id) ? Number(createdBy.id) : null;

    if (!displayUsername && userId === null) {
      return null;
    }

    return { displayUsername, normalizedUsername, userId };
  }

  function isTopicOwnerPost(post, topicOwner) {
    if (!post || typeof post !== "object" || !topicOwner) {
      return false;
    }

    const postUserId = Number.isFinite(post.user_id) ? Number(post.user_id) : null;
    if (topicOwner.userId !== null && postUserId !== null && topicOwner.userId === postUserId) {
      return true;
    }

    const postUsername = normalizeUsername(post.username);
    return Boolean(topicOwner.normalizedUsername && postUsername && topicOwner.normalizedUsername === postUsername);
  }

  function buildTopicOwnerBadge(post, topicOwner) {
    if (!isTopicOwnerPost(post, topicOwner)) {
      return null;
    }

    const badge = document.createElement("span");
    badge.className = "ld-post-topic-owner-badge";
    badge.textContent = "Topic Owner";
    badge.title = "楼主";
    badge.setAttribute("aria-label", "楼主");
    return badge;
  }

  function renderTopicMeta(topic, loadedPostCount) {
    const text = document.createElement("span");
    text.textContent = buildTopicMeta(topic, loadedPostCount);
    state.meta.replaceChildren(text);
    if (!Array.isArray(topic.tags)) return;
    const tags = document.createElement("span");
    tags.className = "ld-tag-list";
    for (const tag of topic.tags) {
      const label = getTagLabel(tag);
      if (!label) continue;
      const item = document.createElement("span");
      item.className = "ld-tag";
      item.textContent = label;
      tags.append(item);
    }
    if (tags.childElementCount) state.meta.append(tags);
  }

  function buildTopicMeta(topic, loadedPostCount) {
    const parts = [];

    const topicOwner = getTopicOwnerIdentity(topic);
    if (topicOwner?.displayUsername) {
      parts.push(`楼主 @${topicOwner.displayUsername}`);
    }

    if (topic.created_at) {
      parts.push(formatDate(topic.created_at));
    }

    if (typeof topic.views === "number") {
      parts.push(`${topic.views.toLocaleString()} 浏览`);
    }

    const totalPosts = topic.posts_count || loadedPostCount;
    parts.push(`${totalPosts} 帖`);

    return parts.join(" · ");
  }

  function buildReplyToTab(post) {
    const replyPostNum = post.reply_to_post_number;
    if (!Number.isFinite(replyPostNum) || replyPostNum === post.post_number) {
      return null;
    }

    const replyUser = post.reply_to_user;
    const displayName = replyUser?.username ? `@${replyUser.username}` : `第 ${replyPostNum} 楼`;

    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "ld-reply-to-tab";
    tab.setAttribute("aria-label", `跳转到被回复的帖子：${displayName}`);
    tab.title = `跳转到第 ${replyPostNum} 楼`;

    const icon = document.createElement("span");
    icon.className = "ld-reply-to-tab-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>`;

    const label = document.createElement("span");
    label.className = "ld-reply-to-tab-label";
    label.textContent = displayName;

    tab.append(icon, label);
    tab.addEventListener("click", (e) => {
      e.stopPropagation();
      navigateToPost(replyPostNum);
    });

    return tab;
  }

  function excerptFromCookedForReplyPreview(cooked, maxLen) {
    const cap = typeof maxLen === "number" && maxLen > 8 ? maxLen : 80;
    if (!cooked || typeof cooked !== "string") {
      return "";
    }

    try {
      const tmp = document.createElement("div");
      tmp.innerHTML = cooked;
      const text = (tmp.textContent || "").replace(/\s+/g, " ").trim();
      if (text.length <= cap) {
        return text;
      }

      return `${text.slice(0, cap - 1).trimEnd()}…`;
    } catch {
      return "";
    }
  }

  function getDirectRepliesToPostNumber(topic, parentPostNumber) {
    if (!Number.isFinite(parentPostNumber) || !topic?.post_stream?.posts) {
      return [];
    }

    return topic.post_stream.posts
      .filter((p) => p && typeof p === "object"
        && Number.isFinite(p.reply_to_post_number)
        && p.reply_to_post_number === parentPostNumber)
      .slice()
      .sort((a, b) => (Number(a.post_number) || 0) - (Number(b.post_number) || 0));
  }

  function getKnownDirectReplies(topic, parentPostNumber) {
    const merged = new Map();
    for (const post of getDirectRepliesToPostNumber(topic, parentPostNumber)) {
      if (Number.isFinite(post?.post_number)) {
        merged.set(post.post_number, post);
      }
    }
    for (const post of state.directReplyCache.get(parentPostNumber) || []) {
      if (Number.isFinite(post?.post_number) && !merged.has(post.post_number)) {
        merged.set(post.post_number, post);
      }
    }
    return Array.from(merged.values()).sort((a, b) => (Number(a.post_number) || 0) - (Number(b.post_number) || 0));
  }

  function buildAbsoluteTopicPostUrl(topic, postNumber, topicIdHint = null) {
    const topicId = Number(topic?.id ?? topicIdHint);
    const pn = Number(postNumber);
    if (!Number.isFinite(topicId) || !Number.isFinite(pn)) {
      return "";
    }

    const slug = typeof topic?.slug === "string" ? topic.slug.trim() : "";
    if (slug) {
      return `${location.origin}/t/${slug}/${topicId}/${pn}`;
    }

    return `${location.origin}/t/topic/${topicId}/${pn}`;
  }

  function buildPostReplyPreviewRow(replyPost) {
    const row = document.createElement("div");
    row.className = "ld-post-reply-preview-row";

    const num = replyPost.post_number;
    const user = replyPost.username ? `@${replyPost.username}` : "";
    const snippet = excerptFromCookedForReplyPreview(replyPost.cooked, 96);
    const metaLine = [user, snippet].filter(Boolean).join(" · ") || "（无预览）";

    const jumpBtn = document.createElement("button");
    jumpBtn.type = "button";
    jumpBtn.className = "ld-post-reply-preview-jump";
    jumpBtn.setAttribute(
      "aria-label",
      Number.isFinite(num) ? `跳转到第 ${num} 楼（抽屉内无该楼时新标签打开）` : "跳转到该回复"
    );

    const numSpan = document.createElement("span");
    numSpan.className = "ld-post-reply-preview-num";
    numSpan.textContent = Number.isFinite(num) ? `#${num}` : "#?";

    const metaSpan = document.createElement("span");
    metaSpan.className = "ld-post-reply-preview-meta";
    metaSpan.textContent = metaLine;

    jumpBtn.append(numSpan, metaSpan);
    jumpBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeAllPopovers();
      if (!Number.isFinite(num)) {
        return;
      }

      navigateToPost(num);
    });

    row.appendChild(jumpBtn);
    return row;
  }

  function canEagerLoadMissingDirectReplies() {
    if (!state.currentTopic) {
      return false;
    }

    if (state.settings.postMode === "first") {
      return false;
    }

    if (state.settings.replyOrder === "latestFirst") {
      return false;
    }

    if (state.currentTargetSpec?.hasTarget) {
      return false;
    }

    return hasMoreTopicPosts(state.currentTopic);
  }

  async function waitForTopicLoadMoreIdle(maxWaitMs = 12000) {
    const deadline = Date.now() + maxWaitMs;
    while (state.isLoadingMorePosts && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
  }

  async function fallbackSequentialDirectRepliesLoad(parentPostNumber, maxBatches = DIRECT_REPLIES_FALLBACK_BATCHES) {
    if (!Number.isFinite(parentPostNumber)) {
      return;
    }

    let batches = 0;
    while (batches < maxBatches) {
      if (getDirectRepliesToPostNumber(state.currentTopic, parentPostNumber).length > 0) {
        return;
      }

      if (!canEagerLoadMissingDirectReplies()) {
        return;
      }

      await waitForTopicLoadMoreIdle();

      if (!canEagerLoadMissingDirectReplies()) {
        return;
      }

      const loadedBefore = getLoadedTopicPostIds(state.currentTopic).length;
      await loadMorePosts();
      batches += 1;

      const loadedAfter = getLoadedTopicPostIds(state.currentTopic).length;
      if (loadedAfter <= loadedBefore) {
        return;
      }
    }
  }

  async function ensureDirectRepliesLoadedForPopover(parentPostNumber, maxStreamBatches = DIRECT_REPLIES_MAX_BATCHES) {
    if (!Number.isFinite(parentPostNumber) || !state.currentUrl || !state.currentTopic) {
      return;
    }

    const urlAtStart = state.currentUrl;
    let topic = state.currentTopic;
    const parentFromTopic = (topic.post_stream?.posts || []).find((p) => p?.post_number === parentPostNumber);
    if (!parentFromTopic || !Number.isFinite(parentFromTopic.id)) {
      await fallbackSequentialDirectRepliesLoad(parentPostNumber);
      return;
    }

    const expected = typeof parentFromTopic.reply_count === "number" ? parentFromTopic.reply_count : 0;
    if (expected <= 0 || getKnownDirectReplies(topic, parentPostNumber).length >= expected) {
      return;
    }

    cancelDirectRepliesRequest();
    const controller = new AbortController();
    state.directRepliesAbortController = controller;
    const signal = controller.signal;

    try {
      const totalPosts = Number(topic.posts_count || 0);
      const rawStream = topic?.post_stream?.stream;
      const streamLen = Array.isArray(rawStream) ? rawStream.length : 0;
      const needsStreamHydrate = streamLen === 0 || (totalPosts > 0 && streamLen < totalPosts);

      if (needsStreamHydrate) {
        const freshMeta = await fetchTrackedTopicJson(state.currentUrl, signal, state.currentTopicIdHint, {
          canonical: true,
          trackVisit: false
        });
        if (signal.aborted || state.currentUrl !== urlAtStart) {
          return;
        }
        topic = mergeTopicPreviewData(topic, {
          posts_count: freshMeta.posts_count,
          post_stream: { stream: freshMeta.post_stream?.stream || [], posts: [] }
        });
      }

      const stream = getTopicStreamIds(topic);
      const parentIndex = stream.indexOf(parentFromTopic.id);
      if (parentIndex === -1) {
        await fallbackSequentialDirectRepliesLoad(parentPostNumber);
        return;
      }

      const loadedIds = new Set(getLoadedTopicPostIds(topic));
      const pending = stream.slice(parentIndex + 1).filter((id) => !loadedIds.has(id));
      let batches = 0;

      while (pending.length > 0 && batches < maxStreamBatches) {
        if (signal.aborted || state.currentUrl !== urlAtStart) {
          return;
        }

        if (getDirectRepliesToPostNumber(topic, parentPostNumber).length >= expected) {
          break;
        }

        const chunk = pending.splice(0, LOAD_MORE_BATCH_SIZE);
        const posts = await fetchTopicPostsBatch(state.currentUrl, chunk, signal, state.currentTopicIdHint);
        if (signal.aborted || state.currentUrl !== urlAtStart || !posts.length) {
          return;
        }

        topic = mergeTopicPreviewData(topic, { post_stream: { posts } });
        batches += 1;
      }

      const directReplies = getDirectRepliesToPostNumber(topic, parentPostNumber);
      if (directReplies.length) {
        state.directReplyCache.set(parentPostNumber, directReplies);
      }

      if (directReplies.length < expected && pending.length > 0) {
        showToast(`已限制直接回复扫描范围（最多 ${maxStreamBatches * LOAD_MORE_BATCH_SIZE} 条），更多内容请打开原帖`, "info", 3200);
      }
    } catch (error) {
      if (!signal.aborted) {
        showToast(`加载直接回复失败：${error?.message || "请求未完成"}`, "error");
      }
    } finally {
      if (state.directRepliesAbortController === controller) {
        state.directRepliesAbortController = null;
      }
    }
  }

  function resolveEmptyDirectRepliesMessage(expected) {
    if (expected <= 0) {
      return "暂无直接回复。";
    }

    if (hasMoreTopicPosts(state.currentTopic)) {
      return "当前扫描范围内未找到直接回复，可打开原帖继续查看。";
    }

    return "未找到可显示的直接回复，相关帖子可能已被删除。";
  }

  function populatePostRepliesPopover(popoverEl, parentPost) {
    popoverEl.replaceChildren();

    const topic = state.currentTopic;
    const parentNum = parentPost?.post_number;
    if (!Number.isFinite(parentNum)) {
      return;
    }

    const replies = getKnownDirectReplies(topic, parentNum);
    const expected = typeof parentPost.reply_count === "number" ? parentPost.reply_count : replies.length;

    if (!replies.length) {
      const empty = document.createElement("div");
      empty.className = "ld-post-replies-popover-empty";
      empty.textContent = resolveEmptyDirectRepliesMessage(expected);
      popoverEl.appendChild(empty);
      return;
    }

    if (replies.length < expected) {
      const hint = document.createElement("div");
      hint.className = "ld-post-replies-popover-hint";
      hint.textContent = `当前找到 ${replies.length} / ${expected} 条直接回复；其余可能超出扫描范围或已被删除。`;
      popoverEl.appendChild(hint);
    }

    for (const replyPost of replies) {
      popoverEl.appendChild(buildPostReplyPreviewRow(replyPost));
    }
  }

  function buildPostReplyStatWrap(parentPost, item) {
    const wrap = document.createElement("div");
    wrap.className = "ld-post-replies-stat-wrap";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "ld-post-info-item ld-post-info-item--replies-trigger";
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-haspopup", "true");
    trigger.setAttribute("aria-label", `第 ${parentPost.post_number ?? "?"} 楼有 ${item.count} 条直接回复，点击查看`);
    trigger.title = `${item.label} ${item.count}：点击查看；将按全串流补齐数据，点击楼层可在预览内跳转或新标签打开`;

    const iconSpan = document.createElement("span");
    iconSpan.className = "ld-post-info-icon";
    iconSpan.setAttribute("aria-hidden", "true");
    iconSpan.innerHTML = item.icon;

    const countSpan = document.createElement("span");
    countSpan.textContent = String(item.count);

    trigger.append(iconSpan, countSpan);

    const popover = document.createElement("div");
    popover.className = "ld-post-replies-popover";
    popover.setAttribute("hidden", "");
    popover.setAttribute("role", "region");
    popover.setAttribute(
      "aria-label",
      Number.isFinite(parentPost.post_number)
        ? `第 ${parentPost.post_number} 楼的直接回复`
        : "直接回复列表"
    );

    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = popover.hasAttribute("hidden");
      closeAllPopovers();
      if (!willOpen) {
        trigger.setAttribute("aria-expanded", "false");
        return;
      }

      const parentNum = parentPost.post_number;
      if (!Number.isFinite(parentNum)) {
        return;
      }

      trigger.disabled = true;

      void (async () => {
        try {
          await ensureDirectRepliesLoadedForPopover(parentNum);
        } catch {
          /* loadMorePosts 内部已处理错误 */
        }

        const card = state.content?.querySelector(`.ld-post-card[data-post-number="${parentNum}"]`);
        const liveWrap = card?.querySelector(".ld-post-replies-stat-wrap");
        const liveTrigger = liveWrap?.querySelector(".ld-post-info-item--replies-trigger");
        const livePopover = liveWrap?.querySelector(".ld-post-replies-popover");

        if (liveTrigger) {
          liveTrigger.disabled = false;
        } else if (trigger.isConnected) {
          trigger.disabled = false;
        }

        if (!livePopover || !liveTrigger) {
          return;
        }

        const topic = state.currentTopic;
        const freshParent = (topic?.post_stream?.posts || []).find((p) => p?.post_number === parentNum) || parentPost;

        populatePostRepliesPopover(livePopover, freshParent);
        livePopover.removeAttribute("hidden");
        liveTrigger.setAttribute("aria-expanded", "true");
      })();
    });

    wrap.append(trigger, popover);
    return wrap;
  }

  function buildPostInfos(post) {
    if (!(post.reply_count > 0)) return null;
    return buildPostReplyStatWrap(post, {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>',
      count: post.reply_count,
      label: "回复"
    });
  }

  function buildPostMeta(post) {
    const parts = [];

    if (post.created_at) {
      parts.push(formatDate(post.created_at));
    }

    return parts.join(" · ");
  }

  function formatDate(value) {
    try {
      return new Intl.DateTimeFormat("zh-CN", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date(value));
    } catch {
      return value;
    }
  }

  function isTypingTarget(target) {
    return target instanceof HTMLElement && (
      target.isContentEditable ||
      target.matches("input, textarea, select") ||
      Boolean(target.closest("input, textarea, select, [contenteditable='true']"))
    );
  }

  function parseStoredSettings(value) {
    if (!value) {
      return null;
    }

    if (typeof value === "object") {
      return value;
    }

    if (typeof value !== "string") {
      return null;
    }

    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  function readPersistedSettings() {
    try {
      return parseStoredSettings(localStorage.getItem(SETTINGS_KEY));
    } catch {
      return null;
    }
  }

  function loadSettings() {
    try {
      const saved = readPersistedSettings();
      const settings = {
        ...DEFAULT_SETTINGS,
        ...(saved && typeof saved === "object" ? saved : {})
      };

      if (!["auto", "smart", "iframe"].includes(settings.previewMode)) {
        settings.previewMode = DEFAULT_SETTINGS.previewMode;
      }

      if (settings.trackPreviewVisit !== "on" && settings.trackPreviewVisit !== "off") {
        settings.trackPreviewVisit = DEFAULT_SETTINGS.trackPreviewVisit;
      }

      if (!(settings.drawerWidth in DRAWER_WIDTHS) && settings.drawerWidth !== "custom") {
        settings.drawerWidth = DEFAULT_SETTINGS.drawerWidth;
      }

      if (settings.drawerMode !== "push" && settings.drawerMode !== "overlay") {
        settings.drawerMode = DEFAULT_SETTINGS.drawerMode;
      }

      if (settings.authorFilter !== "all" && settings.authorFilter !== "topicOwner") {
        settings.authorFilter = DEFAULT_SETTINGS.authorFilter;
      }

      if (settings.floatingReplyButton !== "off" && settings.floatingReplyButton !== "on") {
        settings.floatingReplyButton = DEFAULT_SETTINGS.floatingReplyButton;
      }
      for (const key of ["showTrustStatus", "listAlignLeft"]) {
        if (settings[key] !== "on" && settings[key] !== "off") settings[key] = DEFAULT_SETTINGS[key];
      }

      settings.replyPanelPosition = normalizeReplyPanelPosition(settings.replyPanelPosition);
      settings.postBodyFontSize = clampPostBodyFontSize(settings.postBodyFontSize);
      settings.drawerWidthCustom = clampDrawerWidth(settings.drawerWidthCustom);
      return settings;
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    } catch {
      // Some privacy modes may disable localStorage.
    }
  }

  function resetReplyComposer() {
    state.replyComposerSessionId += 1;
    cancelReplyUploads();

    if (state.replyTextarea) {
      state.replyTextarea.value = "";
      state.replyTextarea.placeholder = buildReplyTextareaPlaceholder();
    }

    if (state.replyStatus) {
      state.replyStatus.textContent = "";
    }

    state.isReplySubmitting = false;
    setReplyPanelOpen(false);
    syncReplyUI();
  }

  function syncReplyUI() {
    syncLatestRepliesRefreshUI();
    const hasTopic = Boolean(state.currentTopic?.id);
    const isTargetedReply = Number.isFinite(state.replyTargetPostNumber);
    const isReplyUploading = state.replyUploadPendingCount > 0;
    const hasCurrentUrl = Boolean(state.currentUrl);
    const isSettingsOpen = !state.settingsPanel?.hidden;

    if (state.topFabButton) {
      state.topFabButton.hidden = !hasCurrentUrl || isSettingsOpen
        || state.root.classList.contains(IFRAME_MODE_CLASS) || !state.replyPanel?.hidden;
    }

    if (state.bottomFabButton) {
      state.bottomFabButton.hidden = !hasTopic || state.settings.postMode === "first" || isSettingsOpen
        || state.root.classList.contains(IFRAME_MODE_CLASS) || !state.replyPanel?.hidden;
    }

    if (state.replyToggleButton) {
      state.replyToggleButton.hidden = !hasCurrentUrl;
      state.replyToggleButton.disabled = !hasTopic || state.isReplySubmitting;
      state.replyToggleButton.classList.toggle("is-disabled", !hasTopic || state.isReplySubmitting);
    }

    if (state.replyFabButton) {
      state.replyFabButton.hidden = !hasCurrentUrl
        || isSettingsOpen
        || state.settings.floatingReplyButton !== "on";
      state.replyFabButton.disabled = !hasTopic || state.isReplySubmitting;
      state.replyFabButton.classList.toggle("is-disabled", !hasTopic || state.isReplySubmitting);
    }

    if (state.replyTextarea) {
      state.replyTextarea.disabled = !hasTopic || state.isReplySubmitting;
      if (hasTopic) {
        state.replyTextarea.placeholder = isTargetedReply
          ? buildReplyTextareaPlaceholder(`回复 ${state.replyTargetLabel}`)
          : buildReplyTextareaPlaceholder(`回复《${state.currentTopic.title || state.currentFallbackTitle || "当前主题"}》`);
      }
    }

    if (state.replyPanelTitle) {
      state.replyPanelTitle.textContent = isTargetedReply
        ? `回复 ${state.replyTargetLabel}`
        : "回复主题";
    }

    if (state.replySubmitButton) {
      state.replySubmitButton.disabled = !hasTopic || state.isReplySubmitting || isReplyUploading;
      state.replySubmitButton.textContent = state.isReplySubmitting
        ? "发送中..."
        : (isReplyUploading
          ? (state.replyUploadPendingCount > 1
            ? `上传 ${state.replyUploadPendingCount} 张图片中...`
            : "图片上传中...")
          : "发送回复");
    }

    if (state.replyCancelButton) {
      state.replyCancelButton.disabled = state.isReplySubmitting;
    }
  }

  function buildReplyTextareaPlaceholder(prefix = "写点什么") {
    return `${prefix}... 支持 Markdown，可直接粘贴图片自动上传。Ctrl+Enter 或 Cmd+Enter 可发送`;
  }

  function syncSettingsUI() {
    if (!state.settingsPanel) {
      return;
    }

    for (const control of state.settingsPanel.querySelectorAll("[data-setting]")) {
      const key = control.dataset.setting;
      if (key && key in state.settings) {
        control.value = String(state.settings[key]);
      }
    }

    syncPostBodyFontSizeValue();
    syncPostBodyFontSizeControlState();
  }

  function syncPostBodyFontSizeValue() {
    if (state.postBodyFontSizeValue) {
      state.postBodyFontSizeValue.textContent = `${clampPostBodyFontSize(state.settings.postBodyFontSize)}px`;
    }
  }

  function syncPostBodyFontSizeControlState() {
    const isSmartPreview = state.settings.previewMode === "smart" || state.settings.previewMode === "auto";

    if (state.postBodyFontSizeField) {
      state.postBodyFontSizeField.classList.toggle("is-disabled", !isSmartPreview);
      state.postBodyFontSizeField.setAttribute("aria-disabled", String(!isSmartPreview));
    }

    if (state.postBodyFontSizeControl) {
      state.postBodyFontSizeControl.disabled = !isSmartPreview;
    }

    if (state.postBodyFontSizeHint) {
      state.postBodyFontSizeHint.textContent = isSmartPreview
        ? "只调整帖子正文和代码字号，不影响标题和按钮"
        : "仅自动/智能预览可用；当前整页模式下不会改变 iframe 里的字号。";
    }
  }

  function toggleSettingsPanel() {
    setSettingsPanelOpen(state.settingsPanel.hidden);
  }

  function handleSettingsPanelClick(event) {
    if (event.target === state.settingsPanel) {
      setSettingsPanelOpen(false);
    }
  }

  function setSettingsPanelOpen(isOpen) {
    if (!state.settingsPanel || !state.settingsToggle) {
      return;
    }

    if (isOpen) {
      setReplyPanelOpen(false);
      syncSettingsUI();
      updateSettingsPopoverPosition();
      queueMicrotask(() => state.settingsCard?.querySelector(".ld-setting-control")?.focus());
    }

    state.settingsPanel.hidden = !isOpen;
    state.settingsToggle.setAttribute("aria-expanded", String(isOpen));
    syncReplyUI();
  }

  function handleSettingsInput(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== "range") {
      return;
    }

    const key = target.dataset.setting;
    if (key !== "postBodyFontSize") {
      return;
    }

    state.settings.postBodyFontSize = clampPostBodyFontSize(target.value);
    target.value = String(state.settings.postBodyFontSize);
    applyPostBodyFontSize();
    saveSettings();
  }

  function handleSettingsChange(event) {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement) && !(target instanceof HTMLInputElement)) {
      return;
    }

    const key = target.dataset.setting;
    if (!key || !(key in state.settings)) {
      return;
    }

    cacheCurrentTopic();
    if (key === "trackPreviewVisit" || key === "previewMode") stopReading();
    state.settings[key] = key === "postBodyFontSize"
      ? clampPostBodyFontSize(target.value)
      : target.value;
    target.value = String(state.settings[key]);
    saveSettings();

    if (key === "postBodyFontSize") {
      applyPostBodyFontSize();
      return;
    }

    if (key === "drawerWidth") {
      applyDrawerWidth();
      syncSettingsUI();
      setSettingsPanelOpen(false);
      return;
    }

    if (key === "drawerMode") {
      applyDrawerMode();
      setSettingsPanelOpen(false);
      return;
    }

    if (key === "floatingReplyButton") {
      syncReplyUI();
      setSettingsPanelOpen(false);
      return;
    }

    if (key === "showTrustStatus" || key === "listAlignLeft") {
      if (key === "showTrustStatus") syncTrustStatusVisibility();
      else applyDrawerMode();
      return;
    }

    refreshCurrentView();
    setSettingsPanelOpen(false);
  }

  function resetSettings() {
    cacheCurrentTopic();
    stopReading();
    state.settings = { ...DEFAULT_SETTINGS };
    syncSettingsUI();
    saveSettings();
    applyPostBodyFontSize();
    applyDrawerWidth();
    applyDrawerMode();
    applyReplyPanelPosition();
    syncTrustStatusVisibility();
    syncReplyUI();
    refreshCurrentView();
    setSettingsPanelOpen(false);
  }

  function applyDrawerWidth() {
    const width = state.settings.drawerWidth === "custom"
      ? `${clampDrawerWidth(state.settings.drawerWidthCustom)}px`
      : (DRAWER_WIDTHS[state.settings.drawerWidth] || DRAWER_WIDTHS.medium);

    document.documentElement.style.setProperty(
      "--ld-drawer-width",
      width
    );

    updateSettingsPopoverPosition();
    scheduleTopicTrackerPositionSync();
  }

  function applyPostBodyFontSize() {
    document.documentElement.style.setProperty(
      "--ld-post-body-font-size",
      `${clampPostBodyFontSize(state.settings.postBodyFontSize)}px`
    );
    syncPostBodyFontSizeValue();
  }

  function applyDrawerMode() {
    const isOverlay = state.settings.drawerMode === "overlay";
    document.body.classList.toggle("ld-drawer-mode-overlay", isOverlay);
    document.body.classList.toggle("ld-list-align-left", state.settings.listAlignLeft === "on");
    scheduleTopicTrackerPositionSync();
  }

  function clampDrawerWidth(value) {
    const numeric = Number(value);
    const maxWidth = Math.min(1400, Math.max(420, window.innerWidth - 40));

    if (!Number.isFinite(numeric)) {
      return Math.min(DEFAULT_SETTINGS.drawerWidthCustom, maxWidth);
    }

    return Math.min(Math.max(Math.round(numeric), 320), maxWidth);
  }

  function clampPostBodyFontSize(value) {
    const numeric = Number(value);

    if (!Number.isFinite(numeric)) {
      return DEFAULT_SETTINGS.postBodyFontSize;
    }

    return Math.min(Math.max(Math.round(numeric), POST_BODY_FONT_SIZE_MIN), POST_BODY_FONT_SIZE_MAX);
  }

  function startDrawerResize(event) {
    if (event.button !== 0 || window.innerWidth <= 720) {
      return;
    }

    event.preventDefault();
    state.isResizing = true;
    document.body.classList.add("ld-drawer-resizing");
    state.settings.drawerWidth = "custom";
    syncSettingsUI();
    updateCustomDrawerWidth(event.clientX);
    state.resizeHandle?.setPointerCapture?.(event.pointerId);
  }

  function handleDrawerResizeMove(event) {
    if (!state.isResizing) {
      return;
    }

    event.preventDefault();
    updateCustomDrawerWidth(event.clientX);
  }

  function stopDrawerResize(event) {
    if (!state.isResizing) {
      return;
    }

    state.isResizing = false;
    document.body.classList.remove("ld-drawer-resizing");
    saveSettings();

    if (event?.pointerId !== undefined && state.resizeHandle?.hasPointerCapture?.(event.pointerId)) {
      state.resizeHandle.releasePointerCapture(event.pointerId);
    }
  }

  function updateCustomDrawerWidth(clientX) {
    state.settings.drawerWidth = "custom";
    state.settings.drawerWidthCustom = clampDrawerWidth(window.innerWidth - clientX);
    applyDrawerWidth();
  }

  function shouldDeferOwnerFilterAutoLoad(viewModel) {
    return Boolean(
      viewModel
      && viewModel.authorFilter === "topicOwner"
      && viewModel.canAutoLoadMore
      && Number(viewModel.filterHiddenCount || 0) > 0
    );
  }

  function shouldLoadMoreFromOwnerFilterWheel() {
    if (!state.deferOwnerFilterAutoLoad || !state.drawerBody || !state.currentTopic || state.isLoadingMorePosts) {
      return false;
    }

    if (!buildTopicViewModel(state.currentTopic, state.currentLatestRepliesTopic, state.currentTargetSpec).canAutoLoadMore || !hasMoreTopicPosts(state.currentTopic)) {
      return false;
    }

    return state.drawerBody.scrollHeight - state.drawerBody.clientHeight <= LOAD_MORE_TRIGGER_OFFSET;
  }

  function updateSettingsPopoverPosition() {
    syncNativeHeaderLayout();
    if (!state.header || !state.settingsPanel) {
      return;
    }

    const offset = `${state.header.offsetHeight + 8}px`;
    state.root.style.setProperty("--ld-reply-panel-top", offset);

    if (!state.isReplyPanelDragging) {
      applyReplyPanelPosition(true);
    }
  }

  function syncNativeHeaderLayout() {
    const header = document.querySelector(".d-header");
    const actions = state.root?.querySelector(".ld-drawer-header-actions");
    const height = header?.getBoundingClientRect().height || 0;
    document.body.classList.toggle("ld-native-header-layout", height > 0);
    if (!height || !actions) return;
    const style = document.documentElement.style;
    style.setProperty("--ld-native-header-height", `${height}px`);
    style.setProperty("--ld-header-actions-width", `${Math.ceil(actions.getBoundingClientRect().width) + 24}px`);
  }

  function scheduleTopicTrackerPositionSync() {
    if (state.topicTrackerSyncQueued) {
      return;
    }

    state.topicTrackerSyncQueued = true;
    requestAnimationFrame(() => {
      state.topicTrackerSyncQueued = false;
      syncTopicTrackerPosition();
    });
  }

  function syncTopicTrackerPosition() {
    const tracker = document.querySelector(TOPIC_TRACKER_SELECTOR);
    const rootStyle = document.documentElement.style;

    if (!tracker) {
      rootStyle.removeProperty("--ld-topic-tracker-left");
      rootStyle.removeProperty("--ld-topic-tracker-top");
      rootStyle.removeProperty("--ld-topic-tracker-max-width");
      return;
    }

    const anchor = tracker.closest("#list-area")
      || document.querySelector("#list-area")
      || tracker.closest(".contents")
      || document.querySelector(MAIN_CONTENT_SELECTOR);
    const alignmentTarget = getTopicTrackerAlignmentTarget() || anchor;

    const anchorRect = anchor?.getBoundingClientRect();
    if (!anchorRect || anchorRect.width <= 0) {
      return;
    }

    const sidePadding = 16;
    const centerX = Math.min(
      window.innerWidth - sidePadding,
      Math.max(sidePadding, Math.round(anchorRect.left + anchorRect.width / 2))
    );
    const header = document.querySelector(".d-header-wrap")
      || document.querySelector(".d-header")
      || document.querySelector("header");
    const headerBottom = header?.getBoundingClientRect()?.bottom;
    const alignmentRect = alignmentTarget?.getBoundingClientRect();
    const alignmentBottom = alignmentRect?.bottom;
    const trackerHeight = Math.round(tracker.getBoundingClientRect().height || 36);
    const topBase = Math.round(
      Math.max(
        (Number.isFinite(headerBottom) ? headerBottom : 64) + 18,
        (Number.isFinite(alignmentBottom) ? alignmentBottom : 0) + 10
      )
    );
    const top = Math.max(
      Math.round((Number.isFinite(headerBottom) ? headerBottom : 64) + 8),
      topBase - trackerHeight - Math.round(trackerHeight * 0.35)
    );
    const maxWidth = Math.max(
      220,
      Math.min(window.innerWidth - sidePadding * 2, anchorRect.width - 24)
    );

    // 让“查看 xx 个新的或更新的话题”固定在中间栏顶部区域，
    // 水平居中、垂直位于滚动区上方的固定控制区域。
    rootStyle.setProperty("--ld-topic-tracker-left", `${centerX}px`);
    rootStyle.setProperty("--ld-topic-tracker-top", `${top}px`);
    rootStyle.setProperty("--ld-topic-tracker-max-width", `${Math.round(maxWidth)}px`);
  }

  function handleWindowResize() {
    if (state.settings.drawerWidth === "custom") {
      state.settings.drawerWidthCustom = clampDrawerWidth(state.settings.drawerWidthCustom);
      applyDrawerWidth();
      saveSettings();
    } else {
      updateSettingsPopoverPosition();
    }

    scheduleTopicTrackerPositionSync();
  }

  function handleWindowScroll() {
    if (!document.querySelector(TOPIC_TRACKER_SELECTOR)) {
      return;
    }

    scheduleTopicTrackerPositionSync();
  }

  function watchLocationChanges() {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
      const result = originalPushState.apply(this, args);
      queueMicrotask(handleLocationChange);
      return result;
    };

    history.replaceState = function (...args) {
      const result = originalReplaceState.apply(this, args);
      queueMicrotask(handleLocationChange);
      return result;
    };

    window.addEventListener("popstate", handleLocationChange, true);

    let navigationSyncTimer = 0;
    const queueNavigationSync = () => {
      if (navigationSyncTimer) {
        clearTimeout(navigationSyncTimer);
      }
      navigationSyncTimer = window.setTimeout(() => {
        navigationSyncTimer = 0;
        syncNavigationState();
      }, 80);
    };

    const observer = new MutationObserver((mutations) => {
      if (mutations.every((mutation) => mutation.target instanceof Element && mutation.target.closest?.(`#${ROOT_ID}, #ld-trust-status, #${IMAGE_PREVIEW_ROOT_ID}`))) {
        return;
      }

      scheduleTopicTrackerPositionSync();
      queuePrefetchScan();
      if (location.href !== state.lastLocation) {
        handleLocationChange();
      } else if (state.currentUrl) {
        queueNavigationSync();
      }
    });

    const observeTarget = document.body;
    observer.observe(observeTarget, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href", "class", "target", "download"]
    });
  }

  function hasPreviewableTopicLinks() {
    return getTopicEntries().length > 0;
  }

  function handleLocationChange() {
    state.lastLocation = location.href;
    clearTopicTrackerRefreshSync();
    scheduleTopicTrackerPositionSync();
    queuePrefetchScan();

    if (!hasPreviewableTopicLinks()) {
      closeDrawer();
      return;
    }

    syncNavigationState();
  }

  init();
})();
