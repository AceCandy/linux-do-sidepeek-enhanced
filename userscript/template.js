// ==UserScript==
// @name         Linux.do SidePeek Enhanced（二次开发版）
// @namespace    https://github.com/AceCandy/linux-do-sidepeek-enhanced
// @version      {{VERSION}}
// @description  基于 BobDLA/Linux.do SidePeek 的二次开发版：抽屉预览、可见帖子预取、阅读进度同步、信任等级与原站正文组件。
// @author       BobDLA and contributors; AceCandy (fork maintainer)
// @match        https://linux.do/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      connect.linux.do
// @connect      api.github.com
// @grant        unsafeWindow
// @license      MIT
// @homepageURL  https://github.com/AceCandy/linux-do-sidepeek-enhanced
// @supportURL   https://github.com/AceCandy/linux-do-sidepeek-enhanced/issues
// ==/UserScript==

// 此文件由 scripts/build-userscript.cjs 生成，请修改源码或模板后重新生成。

/* @native */

(function () {
    "use strict";

    const PAGE_WINDOW = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    const styleEl = document.createElement("style");
    styleEl.textContent = `
/* @css */
  `;
    document.head.appendChild(styleEl);

    function readPersistedSettings() {
      let gmSettings = null;
      let localSettings = null;

      try {
        if (typeof GM_getValue === "function") {
          gmSettings = parseStoredSettings(GM_getValue(SETTINGS_KEY, null));
        }
      } catch {
        // Ignore userscript-storage failures and fall back to site storage.
      }

      try {
        localSettings = parseStoredSettings(localStorage.getItem(SETTINGS_KEY));
      } catch {
        // Some privacy modes may disable localStorage.
      }

      const settings = gmSettings || localSettings;

      // One-time migration from the old localStorage-only version.
      if (!gmSettings && localSettings) {
        try {
          if (typeof GM_setValue === "function") {
            GM_setValue(SETTINGS_KEY, JSON.stringify(localSettings));
          }
        } catch {
          // Migration failure is non-fatal; localStorage remains the fallback.
        }
      }

      return settings;
    }

    function saveSettings() {
      const payload = JSON.stringify(state.settings);

      try {
        if (typeof GM_setValue === "function") {
          GM_setValue(SETTINGS_KEY, payload);
        }
      } catch {
        // Keep localStorage as a compatibility fallback.
      }

      try {
        localStorage.setItem(SETTINGS_KEY, payload);
      } catch {
        // Dedicated userscript storage above is the primary persistence layer.
      }
    }

    async function readBookmarkData(key) {
      if (typeof GM_getValue !== "function") throw new Error("脚本管理器存储不可用");
      return await GM_getValue(key, null);
    }

    async function writeBookmarkData(key, value) {
      if (typeof GM_setValue !== "function") throw new Error("脚本管理器存储不可用");
      await GM_setValue(key, value);
    }

/* @content */
  })();
