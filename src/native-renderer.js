(function () {
  "use strict";

  const pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
  const mounted = new Map();
  let observer = null;

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element
      ? event.target.closest("#ld-drawer-root a[data-user-card]")
      : null;
    const username = target?.dataset.userCard?.trim();
    if (!username || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    try {
      const owner = pageWindow.require("discourse/lib/get-owner").getOwnerWithFallback();
      owner.lookup("service:app-events").trigger("topic-header:trigger-user-card", username, target, event);
      event.preventDefault();
      event.stopPropagation();
    } catch {}
  });

  document.addEventListener("ld-get-reactions", (event) => {
    const button = event.target;
    if (!(button instanceof HTMLElement) || !button.matches("#ld-drawer-root .ld-post-react-btn")) return;
    try {
      const load = pageWindow.require;
      const settings = load("discourse/lib/get-owner").getOwnerWithFallback().lookup("service:site-settings");
      const { buildEmojiUrl } = load("pretty-text/emoji");
      const ids = [settings.discourse_reactions_reaction_for_like, ...settings.discourse_reactions_enabled_reactions.split("|")];
      const reactions = [...new Set(ids.filter(Boolean))].map((id) => ({
        id, type: "emoji", url: buildEmojiUrl(id, { emojiSet: settings.emoji_set, getURL: (url) => url })
      }));
      button.setAttribute("data-ld-reactions", JSON.stringify(reactions));
    } catch {}
  });

  function release(body, entry) {
    mounted.delete(body);
    try {
      if (entry.wrapper) entry.run(() => entry.wrapper.destroy());
    } catch {}
    try {
      entry.post.destroy();
    } catch {}
    entry.stage.remove();
    if (!entry.isBoosts) {
      body.classList.remove("ld-native-body");
      body.classList.add("cooked");
    }
    body.replaceChildren(...entry.fallback);
  }

  function cleanDetached() {
    for (const [body, entry] of mounted) {
      if (entry.isBoosts) {
        const serialized = JSON.stringify({ boosts: entry.post.boosts || [], can_boost: Boolean(entry.post.can_boost) });
        if (body.getAttribute("data-ld-native-boosts") !== serialized) {
          body.setAttribute("data-ld-native-boosts", serialized);
          body.dispatchEvent(new Event("ld-native-boosts-change"));
        }
      }
      if (!body.isConnected || body.closest("#ld-drawer-root")?.getAttribute("aria-hidden") === "true") {
        release(body, entry);
      }
    }
    if (!mounted.size) {
      observer?.disconnect();
      observer = null;
    }
  }

  // 仅挂载固定的正文和 Boost 组件；操作请求由原站组件在用户交互后处理。
  document.addEventListener("ld-render-native-post", (event) => {
    const body = event.target;
    if (!(body instanceof HTMLElement) || !body.matches("#ld-drawer-root .ld-post-body, #ld-drawer-root .ld-post-boosts") || mounted.has(body)) {
      return;
    }
    const serialized = body.getAttribute("data-ld-native-post");
    body.removeAttribute("data-ld-native-post");
    if (body.closest("#ld-drawer-root").getAttribute("aria-hidden") === "true") return;
    let entry;
    try {
      const data = JSON.parse(serialized);
      if (!Number.isSafeInteger(data?.id) || typeof data.cooked !== "string") {
        return;
      }
      const load = pageWindow.require;
      const container = load("discourse/lib/get-owner").getOwnerWithFallback();
      const store = container.lookup("service:store");
      const { getOwner, setOwner } = load("@ember/application");
      const owner = getOwner(store);
      const { default: Component, getComponentTemplate } = load("@ember/component");
      const { run } = load("@ember/runloop");
      const curry = load("ember-curry-component").default;
      const cooked = load("discourse/components/post/cooked-html").default;
      // 复用原站已有的 in-element 模板，不注入模板编译器或更改原站 outlet。
      const layout = getComponentTemplate(load("discourse/components/render-glimmer-container").default);
      if (!owner || !layout) {
        return;
      }
      const stage = document.createElement("div");
      const target = document.createElement("div");
      stage.hidden = true;
      stage.append(target);
      const post = store.createRecord("post", data);
      const isBoosts = body.classList.contains("ld-post-boosts");
      entry = { stage, post, run, isBoosts, fallback: [...body.childNodes], wrapper: null };
      const registrations = [];
      if (isBoosts) {
        const BoostButton = load("discourse/plugins/discourse-boosts/discourse/components/boost-action-button").default;
        const BoostList = load("discourse/plugins/discourse-boosts/discourse/components/boosts-list").default;
        registrations.push(
          { element: target, component: curry(BoostButton, { post, get shouldRender() { return BoostButton.shouldRender({ post }); } }, owner) },
          { element: target, component: curry(BoostList, { post }, owner) }
        );
      } else {
        registrations.push({ element: target, component: curry(cooked, {
          post, selectionBarrier: false, className: "cooked"
        }, owner) });
      }
      const properties = {
        renderGlimmer: { _registrations: registrations }
      };
      setOwner(properties, owner);
      entry.wrapper = Component.extend({ layout }).create(properties);
      body.append(stage);
      run(() => entry.wrapper.appendTo(stage));
      if (!isBoosts && !target.querySelector(".cooked")) {
        throw new Error("原站正文未挂载");
      }
      for (const link of target.querySelectorAll('a[target="_blank"]')) {
        link.rel = "noopener noreferrer";
      }
      entry.fallback.forEach((node) => node.remove());
      if (!isBoosts) {
        body.classList.remove("cooked");
        body.classList.add("ld-native-body");
      }
      stage.hidden = false;
      mounted.set(body, entry);
      if (!observer) {
        observer = new MutationObserver(cleanDetached);
        observer.observe(document.getElementById("ld-drawer-root"), {
          childList: true, subtree: true, attributes: true, attributeFilter: ["aria-hidden"]
        });
      }
    } catch {
      // 原站升级、模块缺失或初始化失败时，保留现有智能预览。
      if (entry) {
        release(body, entry);
      }
    }
  });

  window.addEventListener("pagehide", () => {
    for (const [body, entry] of mounted) release(body, entry);
    cleanDetached();
  });
})();
