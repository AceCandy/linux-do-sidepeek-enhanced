#!/usr/bin/env bash
set -euo pipefail

BASE_URL="https://linux.do/latest"
CDP_PORT=9222

DEFAULT_CASES=(
  "AGENT-CHROME-001"
  "AGENT-CHROME-002"
  "AGENT-CHROME-003"
  "AGENT-CHROME-004"
  "AGENT-CHROME-005"
  "AGENT-CHROME-006"
  "AGENT-CHROME-008"
  "AGENT-CHROME-009"
  "AGENT-CHROME-010"
)

ALL_CASES=(
  "${DEFAULT_CASES[@]}"
  "AGENT-CHROME-013"
  "AGENT-CHROME-014"
  "AGENT-CHROME-015"
  "AGENT-CHROME-016"
  "AGENT-CHROME-017"
)

CASES=("${DEFAULT_CASES[@]}")
PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

usage() {
  cat <<'EOF'
Usage:
  bash scripts/agent-smoke.sh [--cdp-port 9222] [--cases AGENT-CHROME-001,AGENT-CHROME-006]
  bash scripts/agent-smoke.sh --list-cases

Notes:
  - Requires a running Chrome with --remote-debugging-port and the extension loaded.
  - Uses agent-browser over an existing CDP session.
EOF
}

list_cases() {
  printf '%s\n' "${ALL_CASES[@]}"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --cdp-port)
      CDP_PORT=${2:?missing port}
      shift 2
      ;;
    --cases)
      IFS=',' read -r -a CASES <<< "${2:?missing case list}"
      shift 2
      ;;
    --list-cases)
      list_cases
      exit 0
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

ab() {
  agent-browser --cdp "$CDP_PORT" "$@"
}

ab_eval() {
  local script=$1
  ab eval "$script"
}

record_pass() {
  local case_id=$1
  local detail=$2
  PASS_COUNT=$((PASS_COUNT + 1))
  echo "$case_id PASS - $detail"
}

record_fail() {
  local case_id=$1
  local detail=$2
  FAIL_COUNT=$((FAIL_COUNT + 1))
  echo "$case_id FAIL - $detail"
}

record_skip() {
  local case_id=$1
  local detail=$2
  SKIP_COUNT=$((SKIP_COUNT + 1))
  echo "$case_id SKIP - $detail"
}

ensure_cdp() {
  ab get url >/dev/null
}

navigate_latest() {
  ab open "$BASE_URL" >/dev/null 2>&1 || true
  wait_for_topic_list
}

current_url() {
  ab get url
}

wait_for_topic_list() {
  local attempts=0
  local result

  while [ "$attempts" -lt 12 ]; do
    result=$(ab_eval '(() => document.querySelectorAll("#list-area a.title[data-topic-id]").length)()')
    if [ "$result" -gt 0 ]; then
      return 0
    fi

    ab wait 500 >/dev/null
    attempts=$((attempts + 1))
  done

  return 1
}

drawer_state() {
  local script
  script=$(cat <<'EOF'
(() => {
  const root = document.getElementById("ld-drawer-root");
  const settingsButton = root?.querySelector(".ld-drawer-settings-toggle");
  const settingsPanel = root?.querySelector("#ld-drawer-settings");
  const shortcutsButton = root?.querySelector(".ld-drawer-shortcuts-toggle");
  const link = root?.querySelector(".ld-drawer-link");
  return {
    pageUrl: location.href,
    pageOpen: document.body.classList.contains("ld-drawer-page-open"),
    overlay: document.body.classList.contains("ld-drawer-mode-overlay"),
    title: root?.querySelector(".ld-drawer-title")?.textContent?.trim() || null,
    prevText: root?.querySelector("[data-nav=\"prev\"]")?.getAttribute("aria-label") || null,
    nextText: root?.querySelector("[data-nav=\"next\"]")?.getAttribute("aria-label") || null,
    settingsText: settingsButton?.getAttribute("aria-label") || null,
    settingsExpanded: settingsButton?.getAttribute("aria-expanded") || null,
    settingsHidden: settingsPanel?.hasAttribute("hidden") ?? null,
    shortcutsExists: shortcutsButton instanceof HTMLButtonElement,
    headerReplyExists: Boolean(root?.querySelector(".ld-drawer-reply-toggle")),
    newTabText: link?.getAttribute("aria-label") || null,
    newTabHref: link?.getAttribute("href") || null,
    newTabTarget: link?.getAttribute("target") || null,
    newTabRel: link?.getAttribute("rel") || null
  };
})()
EOF
)
  ab_eval "$script"
}

click_topic_link_by_index() {
  local index=$1
  local mode=${2:-any}
  local script
  script=$(cat <<EOF
(() => {
  const mode = $(printf '%s' "$mode" | jq -Rs .);

  function getTopicMeta(link) {
    try {
      const parsed = new URL(link.href, location.href);
      const segments = parsed.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
      if (segments[0] !== "t") {
        return { targeted: false, targetSegments: [] };
      }

      const first = segments[1] || "";
      const second = segments[2] || "";
      const firstIsNumber = /^\\d+$/.test(first);
      const secondIsNumber = /^\\d+$/.test(second);
      let extraSegments = [];

      if (firstIsNumber) {
        extraSegments = segments.slice(3).filter(Boolean);
      } else if (secondIsNumber) {
        extraSegments = segments.slice(4).filter(Boolean);
      }

      return {
        targeted: extraSegments.length > 0,
        targetSegments: extraSegments
      };
    } catch {
      return { targeted: false, targetSegments: [] };
    }
  }

  const candidates = Array.from(document.querySelectorAll("#list-area a.title[data-topic-id]")).map((link) => {
    const text = link.textContent?.trim();
    if (!text || link.closest("#ld-drawer-root")) {
      return null;
    }

    const meta = getTopicMeta(link);
    return {
      link,
      text,
      href: link.href,
      targeted: meta.targeted,
      targetSegments: meta.targetSegments
    };
  }).filter(Boolean);

  const selectedCandidates = (() => {
    if (mode === "untargeted") {
      return candidates.filter((candidate) => !candidate.targeted);
    }

    if (mode === "refreshable") {
      return candidates.filter((candidate) => !candidate.targeted || (
        candidate.targetSegments.length === 1 && candidate.targetSegments[0] === "last"
      ));
    }

    return candidates;
  })();

  const candidate = selectedCandidates[$index];
  if (!candidate) {
    return {
      ok: false,
      reason: candidates.length > 0 && selectedCandidates.length === 0
        ? "topic-not-found-after-filter"
        : "topic-not-found",
      count: candidates.length,
      filteredCount: selectedCandidates.length,
      mode
    };
  }

  candidate.link.click();
  return {
    ok: true,
    text: candidate.text,
    href: candidate.href,
    count: candidates.length,
    filteredCount: selectedCandidates.length,
    targeted: candidate.targeted,
    targetSegments: candidate.targetSegments,
    mode
  };
})()
EOF
)
  ab_eval "$script"
}

open_topic_by_index() {
  local index=$1
  local mode=${2:-any}
  local result
  navigate_latest
  result=$(click_topic_link_by_index "$index" "$mode")
  if [ "$(echo "$result" | jq -r '.ok')" != "true" ]; then
    echo "$result"
    return 1
  fi

  ab wait 1800 >/dev/null
  echo "$result"
}

ensure_settings_open() {
  local state
  state=$(drawer_state)
  if [ "$(echo "$state" | jq -r '.settingsHidden')" = "true" ]; then
    click_settings_toggle >/dev/null
    ab wait 800 >/dev/null
  fi
}

ensure_settings_closed() {
  local state
  state=$(drawer_state)
  if [ "$(echo "$state" | jq -r '.settingsHidden')" = "false" ]; then
    click_settings_toggle >/dev/null
    ab wait 800 >/dev/null
  fi
}

click_settings_toggle() {
  local script
  script=$(cat <<'EOF'
(() => {
  const button = document.querySelector("#ld-drawer-root .ld-drawer-settings-toggle");
  if (!(button instanceof HTMLButtonElement)) {
    return { ok: false, reason: "settings-toggle-not-found" };
  }

  button.click();
  return { ok: true, text: button.textContent?.trim() || null };
})()
EOF
)
  ab_eval "$script"
}

wait_for_refresh_idle() {
  local attempts=0
  local state='{}'

  while [ "$attempts" -lt 20 ]; do
    state=$(refresh_button_state)
    if [ "$(echo "$state" | jq -r '.exists')" = "true" ] \
      && [ "$(echo "$state" | jq -r '.hidden')" = "false" ] \
      && [ "$(echo "$state" | jq -r '.disabled')" = "false" ] \
      && [ "$(echo "$state" | jq -r '.text // empty')" = "刷新" ]; then
      echo "$state"
      return 0
    fi

    ab wait 300 >/dev/null
    attempts=$((attempts + 1))
  done

  echo "$state"
  return 1
}

set_overlay_mode() {
  local script
  ensure_settings_open
  script=$(cat <<'EOF'
(() => {
  const select = Array.from(document.querySelectorAll("#ld-drawer-settings select")).find((node) =>
    Array.from(node.options).some((option) => option.value === "overlay")
  );

  if (!select) {
    return { ok: false, reason: "drawer-mode-select-not-found" };
  }

  select.value = "overlay";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, value: select.value };
})()
EOF
)
  ab_eval "$script"
}

click_header_logo() {
  local script
  script=$(cat <<'EOF'
(() => {
  const link =
    document.querySelector("header.d-header a.home-logo")
    || document.querySelector("header.d-header a[href='https://linux.do/']")
    || document.querySelector("header.d-header a[href='https://linux.do']")
    || document.querySelector("header.d-header a[href='/']");

  if (!(link instanceof HTMLAnchorElement)) {
    return { ok: false, reason: "header-link-not-found" };
  }

  link.click();
  return { ok: true, text: link.textContent?.trim() || "LINUX DO" };
})()
EOF
)
  ab_eval "$script"
}

click_next_topic() {
  local script
  script=$(cat <<'EOF'
(() => {
  const button = document.querySelector("#ld-drawer-root [data-nav=\"next\"]");
  if (!(button instanceof HTMLButtonElement)) {
    return { ok: false, reason: "next-button-not-found" };
  }

  button.click();
  return { ok: true, text: button.textContent?.trim() || null };
})()
EOF
)
  ab_eval "$script"
}

click_tracker() {
  local script
  script=$(cat <<'EOF'
(() => {
  const tracker = document.querySelector("#list-area .show-more.has-topics .alert.clickable, .contents > .show-more.has-topics .alert.clickable");
  if (!(tracker instanceof Element)) {
    return { ok: false, reason: "tracker-not-found" };
  }

  tracker.click();
  return {
    ok: true,
    text: tracker.textContent?.trim() || null,
    top: Math.round(tracker.getBoundingClientRect().top || 0)
  };
})()
EOF
)
  ab_eval "$script"
}

tracker_state() {
  local script
  script=$(cat <<'EOF'
(() => {
  const tracker = document.querySelector("#list-area .show-more.has-topics .alert.clickable, .contents > .show-more.has-topics .alert.clickable");
  const rect = tracker?.getBoundingClientRect() || null;
  return {
    text: tracker?.textContent?.trim() || null,
    top: rect ? Math.round(rect.top) : null,
    scrollY: Math.round(window.scrollY)
  };
})()
EOF
)
  ab_eval "$script"
}

settings_values() {
  local script
  script=$(cat <<'EOF'
(() => {
  const values = {};
  for (const control of document.querySelectorAll("#ld-drawer-settings [data-setting]")) {
    const key = control.getAttribute("data-setting");
    if (!key) {
      continue;
    }

    values[key] = control.value;
  }

  return values;
})()
EOF
)
  ab_eval "$script"
}

set_setting_value() {
  local key=$1
  local value=$2
  local key_json value_json script
  key_json=$(printf '%s' "$key" | jq -Rs .)
  value_json=$(printf '%s' "$value" | jq -Rs .)
  ensure_settings_open
  script=$(cat <<EOF
(() => {
  const key = $key_json;
  const value = $value_json;
  const control = document.querySelector(\`#ld-drawer-settings [data-setting="\${key}"]\`);
  if (!(control instanceof HTMLSelectElement) && !(control instanceof HTMLInputElement)) {
    return { ok: false, reason: "setting-not-found", key };
  }

  if (control instanceof HTMLSelectElement) {
    const hasOption = Array.from(control.options).some((option) => option.value === value);
    if (!hasOption) {
      return { ok: false, reason: "option-not-found", key, value };
    }

    if (control.value === value) {
      return { ok: true, changed: false, key, value };
    }

    control.value = value;
    control.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, changed: true, key, value };
  }

  if (control.type !== "range") {
    return { ok: false, reason: "unsupported-input-type", key, inputType: control.type || "text" };
  }

  if (control.value === value) {
    return { ok: true, changed: false, key, value };
  }

  control.value = value;
  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, changed: true, key, value };
})()
EOF
)
  ab_eval "$script"
}

restore_settings_subset() {
  local settings_json=$1
  local key value
  for key in previewMode replyOrder; do
    value=$(echo "$settings_json" | jq -r --arg key "$key" '.[$key] // empty')
    if [ -z "$value" ]; then
      continue
    fi

    set_setting_value "$key" "$value" >/dev/null || true
    ab wait 1200 >/dev/null
  done
}

configure_latest_replies_refresh_mode() {
  local result

  result=$(set_setting_value previewMode smart)
  if [ "$(echo "$result" | jq -r '.ok')" != "true" ]; then
    echo "$result"
    return 1
  fi
  ab wait 1200 >/dev/null

  result=$(set_setting_value replyOrder latestFirst)
  if [ "$(echo "$result" | jq -r '.ok')" != "true" ]; then
    echo "$result"
    return 1
  fi
  ab wait 1800 >/dev/null

  echo "$result"
}

refresh_button_state() {
  local script
  script=$(cat <<'EOF'
(() => {
  const button = document.querySelector("#ld-drawer-root .ld-drawer-refresh");
  return {
    exists: button instanceof HTMLButtonElement,
    hidden: button?.hidden ?? null,
    disabled: button?.disabled ?? null,
    text: button?.textContent?.trim() || null,
    title: document.querySelector("#ld-drawer-root .ld-drawer-title")?.textContent?.trim() || null,
    pageUrl: location.href,
    pageOpen: document.body.classList.contains("ld-drawer-page-open")
  };
})()
EOF
)
  ab_eval "$script"
}

reply_entry_state() {
  local script
  script=$(cat <<'EOF'
(() => {
  const root = document.getElementById("ld-drawer-root");
  const headerButton = root?.querySelector(".ld-drawer-reply-toggle");
  const fabButton = root?.querySelector(".ld-drawer-reply-fab.ld-drawer-reply-trigger");
  const panel = root?.querySelector("#ld-drawer-reply-panel");
  const fabRect = fabButton?.getBoundingClientRect?.() || null;
  const fabStyle = fabButton ? getComputedStyle(fabButton) : null;
  return {
    headerExists: headerButton instanceof HTMLButtonElement,
    headerText: headerButton?.textContent?.trim() || null,
    headerHidden: headerButton?.hidden ?? null,
    headerExpanded: headerButton?.getAttribute("aria-expanded") || null,
    fabExists: fabButton instanceof HTMLButtonElement,
    fabText: fabButton?.textContent?.trim() || null,
    fabHidden: fabButton?.hidden ?? null,
    fabDisplay: fabStyle?.display || null,
    fabRendered: Boolean(fabRect && fabRect.width > 0 && fabRect.height > 0),
    fabExpanded: fabButton?.getAttribute("aria-expanded") || null,
    panelHidden: panel?.hasAttribute("hidden") ?? null,
    panelTitle: panel?.querySelector(".ld-reply-panel-title")?.textContent?.trim() || null
  };
})()
EOF
)
  ab_eval "$script"
}

toolbar_layout_state() {
  local script
  script=$(cat <<'EOF'
(() => {
  const toolbar = document.querySelector("#ld-drawer-root .ld-drawer-toolbar");
  const actions = document.querySelector("#ld-drawer-root .ld-drawer-actions");
  const items = Array.from(actions?.querySelectorAll("button, a") || [])
    .filter((node) => !node.hidden)
    .map((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      const text = (node.textContent || "").replace(/\s+/g, " ").trim();
      return {
        text,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        whiteSpace: style.whiteSpace,
        display: style.display
      };
    });

  const toolbarStyle = toolbar ? getComputedStyle(toolbar) : null;
  const visibleTextItems = items.filter((item) => item.text);

  return {
    toolbarExists: Boolean(toolbar),
    actionsExists: Boolean(actions),
    gridTemplateColumns: toolbarStyle?.gridTemplateColumns || null,
    visibleCount: items.length,
    items,
    nowrapOk: visibleTextItems.every((item) => item.whiteSpace === "nowrap"),
    widthOk: visibleTextItems.every((item) => item.width >= 44 && item.width > item.height)
  };
})()
EOF
)
  ab_eval "$script"
}

post_body_font_state() {
  local script
  script=$(cat <<'EOF'
(() => {
  const body = document.querySelector("#ld-drawer-root .ld-post-body");
  const field = document.querySelector('#ld-drawer-settings [data-setting-group="postBodyFontSize"]');
  const control = document.querySelector('#ld-drawer-settings [data-setting="postBodyFontSize"]');
  const value = document.querySelector('#ld-drawer-settings [data-setting-value="postBodyFontSize"]');
  const hint = document.querySelector('#ld-drawer-settings [data-setting-hint="postBodyFontSize"]');
  const code = document.querySelector("#ld-drawer-root .ld-post-body pre, #ld-drawer-root .ld-post-body code");
  return {
    pageOpen: document.body.classList.contains("ld-drawer-page-open"),
    bodyExists: body instanceof HTMLElement,
    bodyFontSize: body ? Math.round(parseFloat(getComputedStyle(body).fontSize) || 0) : null,
    codeExists: code instanceof HTMLElement,
    codeFontSize: code ? Math.round(parseFloat(getComputedStyle(code).fontSize) || 0) : null,
    fieldHidden: field?.hidden ?? false,
    fieldDisabled: field?.classList.contains("is-disabled") || false,
    fieldAriaDisabled: field?.getAttribute("aria-disabled") || null,
    controlDisabled: control?.disabled || false,
    controlValue: control?.value || null,
    valueText: value?.textContent?.trim() || null,
    hintText: hint?.textContent?.trim() || null
  };
})()
EOF
)
  ab_eval "$script"
}

click_reply_trigger() {
  local target=$1
  local selector_json script
  case "$target" in
    fab)
      selector_json='"#ld-drawer-root .ld-drawer-reply-fab.ld-drawer-reply-trigger"'
      ;;
    *)
      echo "{\"ok\":false,\"reason\":\"unknown-target\",\"target\":\"$target\"}"
      return 0
      ;;
  esac

  script=$(cat <<EOF
(() => {
  const target = $(printf '%s' "$target" | jq -Rs .);
  const button = document.querySelector($selector_json);
  if (!(button instanceof HTMLButtonElement)) {
    return { ok: false, reason: "reply-trigger-not-found", target };
  }

  button.click();
  return {
    ok: true,
    target,
    hidden: button.hidden,
    expanded: button.getAttribute("aria-expanded") || null,
    text: button.textContent?.trim() || null
  };
})()
EOF
)
  ab_eval "$script"
}

close_reply_panel_if_open() {
  local script
  script=$(cat <<'EOF'
(() => {
  const panel = document.querySelector("#ld-drawer-root #ld-drawer-reply-panel");
  if (!(panel instanceof HTMLElement)) {
    return { ok: false, reason: "reply-panel-not-found" };
  }

  if (panel.hasAttribute("hidden")) {
    return { ok: true, closed: false };
  }

  const button = panel.querySelector(".ld-reply-panel-close");
  if (!(button instanceof HTMLButtonElement)) {
    return { ok: false, reason: "reply-panel-close-not-found" };
  }

  button.click();
  return { ok: true, closed: true };
})()
EOF
)
  ab_eval "$script"
}

click_refresh_button() {
  local script
  script=$(cat <<'EOF'
(() => {
  const button = document.querySelector("#ld-drawer-root .ld-drawer-refresh");
  if (!(button instanceof HTMLButtonElement)) {
    return { ok: false, reason: "refresh-button-not-found" };
  }

  const title = document.querySelector("#ld-drawer-root .ld-drawer-title")?.textContent?.trim() || null;
  button.click();
  return {
    ok: true,
    hidden: button.hidden,
    disabled: button.disabled,
    text: button.textContent?.trim() || null,
    title,
    pageUrl: location.href
  };
})()
EOF
)
  ab_eval "$script"
}

click_active_topic_link() {
  local script
  script=$(cat <<'EOF'
(() => {
  const link = document.querySelector("#main-outlet .ld-drawer-topic-link-active");
  const refreshButton = document.querySelector("#ld-drawer-root .ld-drawer-refresh");
  if (!(link instanceof HTMLAnchorElement)) {
    return { ok: false, reason: "active-topic-link-not-found" };
  }

  const href = link.href;
  const text = link.textContent?.trim() || null;
  link.click();
  return {
    ok: true,
    href,
    text,
    refreshExists: refreshButton instanceof HTMLButtonElement,
    refreshHidden: refreshButton?.hidden ?? null,
    refreshDisabled: refreshButton?.disabled ?? null,
    refreshText: refreshButton?.textContent?.trim() || null,
    pageUrl: location.href
  };
})()
EOF
)
  ab_eval "$script"
}

run_001() {
  local case_id="AGENT-CHROME-001"
  local click_result state title clicked_text
  click_result=$(open_topic_by_index 0) || {
    record_fail "$case_id" "无法点击列表主题"
    return 0
  }
  state=$(drawer_state)
  title=$(echo "$state" | jq -r '.title // empty')
  clicked_text=$(echo "$click_result" | jq -r '.text // empty')

  if [ "$(echo "$state" | jq -r '.pageOpen')" = "true" ] \
    && [ "$(echo "$state" | jq -r '.pageUrl')" = "$BASE_URL" ] \
    && [ -n "$title" ] \
    && [ "$title" = "$clicked_text" ]; then
    record_pass "$case_id" "title=$title"
  else
    record_fail "$case_id" "pageUrl=$(echo "$state" | jq -r '.pageUrl') title=$title clicked=$clicked_text"
  fi
}

run_002() {
  local case_id="AGENT-CHROME-002"
  local original_settings original_preview preview_result state
  open_topic_by_index 0 >/dev/null || {
    record_fail "$case_id" "无法打开抽屉"
    return 0
  }

  original_settings=$(settings_values)
  original_preview=$(echo "$original_settings" | jq -r '.previewMode // empty')
  if [ -z "$original_preview" ]; then
    record_fail "$case_id" "无法读取当前预览模式"
    return 0
  fi

  preview_result=$(set_setting_value previewMode iframe)
  if [ "$(echo "$preview_result" | jq -r '.ok')" != "true" ]; then
    record_fail "$case_id" "无法切到整页模式: $preview_result"
    return 0
  fi
  ab wait 1200 >/dev/null
  ensure_settings_closed
  state=$(drawer_state)

  set_setting_value previewMode "$original_preview" >/dev/null || true

  if [ "$(echo "$state" | jq -r '.prevText // empty')" = "上一帖" ] \
    && [ "$(echo "$state" | jq -r '.nextText // empty')" = "下一帖" ] \
    && [ "$(echo "$state" | jq -r '.settingsText // empty')" = "选项" ] \
    && [ "$(echo "$state" | jq -r '.shortcutsExists')" = "true" ] \
    && [ "$(echo "$state" | jq -r '.headerReplyExists')" = "false" ] \
    && [ "$(echo "$state" | jq -r '.newTabText // empty')" = "新标签打开" ]; then
    record_pass "$case_id" "toolbar ready in iframe mode"
  else
    record_fail "$case_id" "toolbar incomplete: $(echo "$state" | jq -c '{prevText, nextText, settingsText, shortcutsExists, headerReplyExists, newTabText}')"
  fi
}

run_003() {
  local case_id="AGENT-CHROME-003"
  local opened closed
  open_topic_by_index 0 >/dev/null || {
    record_fail "$case_id" "无法打开抽屉"
    return 0
  }

  ensure_settings_open
  opened=$(drawer_state)
  ensure_settings_closed
  closed=$(drawer_state)

  if [ "$(echo "$opened" | jq -r '.settingsExpanded')" = "true" ] \
    && [ "$(echo "$opened" | jq -r '.settingsHidden')" = "false" ] \
    && [ "$(echo "$closed" | jq -r '.settingsExpanded')" = "false" ] \
    && [ "$(echo "$closed" | jq -r '.settingsHidden')" = "true" ]; then
    record_pass "$case_id" "settings toggle works"
  else
    record_fail "$case_id" "opened=$(echo "$opened" | jq -c '{expanded: .settingsExpanded, hidden: .settingsHidden}') closed=$(echo "$closed" | jq -c '{expanded: .settingsExpanded, hidden: .settingsHidden}')"
  fi
}

run_004() {
  local case_id="AGENT-CHROME-004"
  local before after
  open_topic_by_index 0 >/dev/null || {
    record_fail "$case_id" "无法打开抽屉"
    return 0
  }
  ensure_settings_closed
  before=$(drawer_state)
  click_next_topic >/dev/null || {
    record_fail "$case_id" "无法点击下一帖"
    return 0
  }
  ab wait 1800 >/dev/null
  after=$(drawer_state)

  if [ "$(echo "$after" | jq -r '.pageOpen')" = "true" ] \
    && [ "$(echo "$after" | jq -r '.pageUrl')" = "$BASE_URL" ] \
    && [ "$(echo "$before" | jq -r '.title // empty')" != "$(echo "$after" | jq -r '.title // empty')" ]; then
    record_pass "$case_id" "title=$(echo "$after" | jq -r '.title // empty')"
  else
    record_fail "$case_id" "before=$(echo "$before" | jq -r '.title // empty') after=$(echo "$after" | jq -r '.title // empty')"
  fi
}

run_005() {
  local case_id="AGENT-CHROME-005"
  local overlay_result state
  open_topic_by_index 0 >/dev/null || {
    record_fail "$case_id" "无法打开抽屉"
    return 0
  }

  overlay_result=$(set_overlay_mode)
  if [ "$(echo "$overlay_result" | jq -r '.ok')" != "true" ]; then
    record_fail "$case_id" "无法切到浮层模式"
    return 0
  fi

  ensure_settings_closed
  click_header_logo >/dev/null || {
    record_fail "$case_id" "无法点击页头链接"
    return 0
  }
  ab wait 1200 >/dev/null
  state=$(drawer_state)

  if [ "$(echo "$state" | jq -r '.pageUrl')" = "$BASE_URL" ] \
    && [ "$(echo "$state" | jq -r '.pageOpen')" = "false" ] \
    && [ "$(echo "$state" | jq -r '.overlay')" = "false" ]; then
    record_pass "$case_id" "overlay outside click closed drawer"
  else
    record_fail "$case_id" "state=$(echo "$state" | jq -c '{pageUrl, pageOpen, overlay}')"
  fi
}

run_006() {
  local case_id="AGENT-CHROME-006"
  local first_open before second_click after target_title
  first_open=$(open_topic_by_index 0) || {
    record_fail "$case_id" "无法打开第一个话题"
    return 0
  }
  before=$(drawer_state)

  if [ "$(echo "$before" | jq -r '.title // empty')" != "$(echo "$first_open" | jq -r '.text // empty')" ]; then
    record_fail "$case_id" "初始抽屉标题不匹配"
    return 0
  fi

  if [ "$(echo "$(set_overlay_mode)" | jq -r '.ok')" != "true" ]; then
    record_fail "$case_id" "无法切到浮层模式"
    return 0
  fi

  ensure_settings_closed
  second_click=$(click_topic_link_by_index 1)
  if [ "$(echo "$second_click" | jq -r '.ok')" != "true" ]; then
    record_fail "$case_id" "无法点击第二个话题"
    return 0
  fi

  ab wait 1800 >/dev/null
  after=$(drawer_state)
  target_title=$(echo "$second_click" | jq -r '.text // empty')

  if [ "$(echo "$after" | jq -r '.pageUrl')" = "$BASE_URL" ] \
    && [ "$(echo "$after" | jq -r '.pageOpen')" = "true" ] \
    && [ "$(echo "$after" | jq -r '.overlay')" = "true" ] \
    && [ "$(echo "$after" | jq -r '.title // empty')" = "$target_title" ] \
    && [ "$(echo "$before" | jq -r '.title // empty')" != "$target_title" ]; then
    record_pass "$case_id" "title=$(echo "$after" | jq -r '.title // empty')"
  else
    record_fail "$case_id" "before=$(echo "$before" | jq -r '.title // empty') after=$(echo "$after" | jq -r '.title // empty') target=$target_title"
  fi
}

run_008() {
  local case_id="AGENT-CHROME-008"
  local before click_result after
  navigate_latest
  ab scroll down 1200 >/dev/null
  ab wait 800 >/dev/null
  before=$(tracker_state)

  if [ -z "$(echo "$before" | jq -r '.text // empty')" ]; then
    record_skip "$case_id" "当前页面没有可点击的新话题提示条"
    return 0
  fi

  click_result=$(click_tracker)
  if [ "$(echo "$click_result" | jq -r '.ok')" != "true" ]; then
    record_skip "$case_id" "提示条不可点击"
    return 0
  fi

  ab wait 1500 >/dev/null
  after=$(tracker_state)

  if [ "$(current_url)" = "$BASE_URL" ] && [ "$(echo "$after" | jq -r '.scrollY')" -le 20 ]; then
    record_pass "$case_id" "scrollY=$(echo "$after" | jq -r '.scrollY')"
  else
    record_fail "$case_id" "before=$(echo "$before" | jq -r '.scrollY') after=$(echo "$after" | jq -r '.scrollY')"
  fi
}

run_009() {
  local case_id="AGENT-CHROME-009"
  local state
  open_topic_by_index 0 >/dev/null || {
    record_fail "$case_id" "无法打开抽屉"
    return 0
  }
  state=$(drawer_state)

  if [ "$(echo "$state" | jq -r '.newTabTarget // empty')" = "_blank" ] \
    && [ "$(echo "$state" | jq -r '.newTabRel // empty')" = "noopener noreferrer" ] \
    && [[ "$(echo "$state" | jq -r '.newTabHref // empty')" == https://linux.do/t/* ]]; then
    record_pass "$case_id" "href=$(echo "$state" | jq -r '.newTabHref // empty')"
  else
    record_fail "$case_id" "attrs=$(echo "$state" | jq -c '{newTabHref, newTabTarget, newTabRel}')"
  fi
}

run_010() {
  local case_id="AGENT-CHROME-010"
  local open_result original_settings setup_result before click after repeat_click repeat_after final_state
  local passed=0
  local detail=""

  if ! open_result=$(open_topic_by_index 0 refreshable); then
    if [ "$(echo "$open_result" | jq -r '.reason // empty')" = "topic-not-found-after-filter" ]; then
      record_skip "$case_id" "当前列表页没有可用于刷新断言的普通主题或 /last 主题链接"
    else
      record_fail "$case_id" "无法打开抽屉: $open_result"
    fi
    return 0
  fi

  original_settings=$(settings_values)
  if [ -z "$(echo "$original_settings" | jq -r '.previewMode // empty')" ]; then
    record_fail "$case_id" "无法读取当前设置"
    return 0
  fi

  setup_result=$(configure_latest_replies_refresh_mode) || {
    restore_settings_subset "$original_settings"
    record_fail "$case_id" "无法切到最新回复刷新场景: $setup_result"
    return 0
  }

  if ! before=$(wait_for_refresh_idle); then
    restore_settings_subset "$original_settings"
    record_fail "$case_id" "刷新按钮在切换场景后未进入可点击状态: $(echo "$before" | jq -c '{exists, hidden, disabled, text}')"
    return 0
  fi

  click=$(click_refresh_button)
  if ! after=$(wait_for_refresh_idle); then
    :
  fi
  repeat_click=$(click_active_topic_link)
  if ! repeat_after=$(wait_for_refresh_idle); then
    :
  fi
  final_state=$(drawer_state)
  restore_settings_subset "$original_settings"

  if [ "$(echo "$before" | jq -r '.exists')" = "true" ] \
    && [ "$(echo "$before" | jq -r '.hidden')" = "false" ] \
    && [ "$(echo "$before" | jq -r '.disabled')" = "false" ] \
    && [ "$(echo "$before" | jq -r '.text // empty')" = "刷新" ] \
    && [ "$(echo "$click" | jq -r '.ok')" = "true" ] \
    && [ "$(echo "$click" | jq -r '.disabled')" = "true" ] \
    && [ "$(echo "$click" | jq -r '.text // empty')" = "刷新中..." ] \
    && [ "$(echo "$click" | jq -r '.pageUrl // empty')" = "$BASE_URL" ] \
    && [ "$(echo "$after" | jq -r '.exists')" = "true" ] \
    && [ "$(echo "$after" | jq -r '.hidden')" = "false" ] \
    && [ "$(echo "$after" | jq -r '.disabled')" = "false" ] \
    && [ "$(echo "$after" | jq -r '.text // empty')" = "刷新" ] \
    && [ "$(echo "$repeat_click" | jq -r '.ok')" = "true" ] \
    && [ "$(echo "$repeat_click" | jq -r '.refreshExists')" = "true" ] \
    && [ "$(echo "$repeat_click" | jq -r '.refreshHidden')" = "false" ] \
    && [ "$(echo "$repeat_click" | jq -r '.refreshDisabled')" = "true" ] \
    && [ "$(echo "$repeat_click" | jq -r '.refreshText // empty')" = "刷新中..." ] \
    && [ "$(echo "$repeat_click" | jq -r '.pageUrl // empty')" = "$BASE_URL" ] \
    && [ "$(echo "$repeat_after" | jq -r '.exists')" = "true" ] \
    && [ "$(echo "$repeat_after" | jq -r '.hidden')" = "false" ] \
    && [ "$(echo "$repeat_after" | jq -r '.disabled')" = "false" ] \
    && [ "$(echo "$repeat_after" | jq -r '.text // empty')" = "刷新" ] \
    && [ "$(echo "$final_state" | jq -r '.pageUrl // empty')" = "$BASE_URL" ] \
    && [ "$(echo "$final_state" | jq -r '.pageOpen')" = "true" ]; then
    passed=1
    detail="title=$(echo "$repeat_after" | jq -r '.title // empty')"
  else
    detail="setup=$(echo "$setup_result" | jq -c '.') before=$(echo "$before" | jq -c '{exists, hidden, disabled, text}') click=$(echo "$click" | jq -c '{ok, hidden, disabled, text, pageUrl}') after=$(echo "$after" | jq -c '{exists, hidden, disabled, text}') repeat_click=$(echo "$repeat_click" | jq -c '{ok, reason, refreshExists, refreshHidden, refreshDisabled, refreshText, pageUrl}') repeat_after=$(echo "$repeat_after" | jq -c '{exists, hidden, disabled, text}')"
  fi

  if [ "$passed" -eq 1 ]; then
    record_pass "$case_id" "$detail"
  else
    record_fail "$case_id" "$detail"
  fi
}

drawer_body_state() {
  local script
  script=$(cat <<'EOF'
(() => {
  const body = document.querySelector("#ld-drawer-root .ld-drawer-body");
  if (!(body instanceof HTMLElement)) {
    return { ok: false, reason: "drawer-body-not-found" };
  }

  const rect = body.getBoundingClientRect();
  return {
    ok: true,
    bodyTop: Math.round(body.scrollTop),
    maxScrollTop: Math.round(body.scrollHeight - body.clientHeight),
    clientHeight: Math.round(body.clientHeight),
    centerX: Math.round(rect.left + rect.width / 2),
    centerY: Math.round(rect.top + Math.min(rect.height / 2, 300))
  };
})()
EOF
)
  ab_eval "$script"
}

page_scroll_state() {
  local script
  script=$(cat <<'EOF'
(() => ({
  docTop: Math.round(document.scrollingElement?.scrollTop || 0),
  pageOpen: document.body.classList.contains("ld-drawer-page-open"),
  overlay: document.body.classList.contains("ld-drawer-mode-overlay"),
  title: document.querySelector("#ld-drawer-root .ld-drawer-title")?.textContent?.trim() || null
}))()
EOF
)
  ab_eval "$script"
}

set_page_scroll_top() {
  local top=$1
  local top_json script
  top_json=$(printf '%s' "$top" | jq -Rs 'tonumber')
  script=$(cat <<EOF
(() => {
  const top = $top_json;
  window.scrollTo(0, top);
  return {
    docTop: Math.round(document.scrollingElement?.scrollTop || 0),
    windowY: Math.round(window.scrollY)
  };
})()
EOF
)
  ab_eval "$script"
}

prepare_scrollable_drawer_topic() {
  local index=0
  local open_result body_state

  while [ "$index" -lt 5 ]; do
    open_result=$(open_topic_by_index "$index") || {
      index=$((index + 1))
      continue
    }
    ensure_settings_closed
    body_state=$(drawer_body_state)

    if [ "$(echo "$body_state" | jq -r '.ok')" = "true" ] \
      && [ "$(echo "$body_state" | jq -r '.maxScrollTop')" -ge 1200 ]; then
      echo "$open_result"
      return 0
    fi

    index=$((index + 1))
  done

  return 1
}

run_013() {
  local case_id="AGENT-CHROME-013"
  local open_result overlay_result scroll_result body_state before after
  local center_x center_y before_doc_top after_doc_top

  open_result=$(prepare_scrollable_drawer_topic) || {
    record_fail "$case_id" "前 5 个列表主题里没有足够长、可滚动的抽屉内容"
    return 0
  }

  overlay_result=$(set_overlay_mode)
  if [ "$(echo "$overlay_result" | jq -r '.ok')" != "true" ]; then
    record_fail "$case_id" "无法切到浮层模式"
    return 0
  fi

  ensure_settings_closed
  scroll_result=$(set_page_scroll_top 900)
  body_state=$(ab_eval '(() => {
    const body = document.querySelector("#ld-drawer-root .ld-drawer-body");
    if (!(body instanceof HTMLElement)) {
      return { ok: false, reason: "drawer-body-not-found" };
    }

    body.scrollTop = body.scrollHeight;
    const rect = body.getBoundingClientRect();
    return {
      ok: true,
      bodyTop: Math.round(body.scrollTop),
      maxScrollTop: Math.round(body.scrollHeight - body.clientHeight),
      centerX: Math.round(rect.left + rect.width / 2),
      centerY: Math.round(rect.top + Math.min(rect.height / 2, 300))
    };
  })()')

  if [ "$(echo "$body_state" | jq -r '.ok')" != "true" ]; then
    record_fail "$case_id" "无法读取抽屉滚动容器"
    return 0
  fi

  center_x=$(echo "$body_state" | jq -r '.centerX')
  center_y=$(echo "$body_state" | jq -r '.centerY')
  ab mouse move "$center_x" "$center_y" >/dev/null
  before=$(page_scroll_state)
  ab mouse wheel 1200 >/dev/null
  ab wait 300 >/dev/null
  after=$(page_scroll_state)
  before_doc_top=$(echo "$before" | jq -r '.docTop')
  after_doc_top=$(echo "$after" | jq -r '.docTop')

  if [ "$(echo "$scroll_result" | jq -r '.docTop')" -ge 800 ] \
    && [ "$before_doc_top" -ge 800 ] \
    && [ "$after_doc_top" = "$before_doc_top" ] \
    && [ "$(echo "$after" | jq -r '.pageOpen')" = "true" ] \
    && [ "$(echo "$after" | jq -r '.overlay')" = "true" ]; then
    record_pass "$case_id" "title=$(echo "$after" | jq -r '.title // empty') docTop=$after_doc_top"
  else
    record_fail "$case_id" "scroll=$(echo "$scroll_result" | jq -c '.') body=$(echo "$body_state" | jq -c '{bodyTop, maxScrollTop, centerX, centerY}') before=$(echo "$before" | jq -c '{docTop, pageOpen, overlay, title}') after=$(echo "$after" | jq -c '{docTop, pageOpen, overlay, title}')"
  fi
}

run_014() {
  local case_id="AGENT-CHROME-014"
  local original_preview on_state settings_state click_result panel_state
  open_topic_by_index 0 >/dev/null || { record_fail "$case_id" "无法打开抽屉"; return 0; }
  original_preview=$(settings_values | jq -r '.previewMode // "auto"')
  set_setting_value previewMode smart >/dev/null
  ab wait 1200 >/dev/null
  ensure_settings_closed
  on_state=$(reply_entry_state)
  ensure_settings_open
  settings_state=$(reply_entry_state)
  ensure_settings_closed
  click_result=$(click_reply_trigger fab)
  ab wait 800 >/dev/null
  panel_state=$(reply_entry_state)
  close_reply_panel_if_open >/dev/null || true
  set_setting_value previewMode "$original_preview" >/dev/null || true
  ensure_settings_closed
  if [ "$(echo "$on_state" | jq -r '.headerExists')" = "false" ] \
    && [ "$(echo "$on_state" | jq -r '.fabRendered')" = "true" ] \
    && [ "$(echo "$settings_state" | jq -r '.fabHidden')" = "true" ] \
    && [ "$(echo "$click_result" | jq -r '.ok')" = "true" ] \
    && [ "$(echo "$panel_state" | jq -r '.panelHidden')" = "false" ] \
    && [ "$(echo "$panel_state" | jq -r '.panelTitle')" = "回复主题" ]; then
    record_pass "$case_id" "底部入口默认可见，设置层遮挡时隐藏，可打开主题回复"
  else
    record_fail "$case_id" "visible=$on_state settings=$settings_state click=$click_result panel=$panel_state"
  fi
}

run_015() {
  local case_id="AGENT-CHROME-015"
  local state

  open_topic_by_index 0 >/dev/null || {
    record_fail "$case_id" "无法打开抽屉"
    return 0
  }

  state=$(toolbar_layout_state)

  if [ "$(echo "$state" | jq -r '.toolbarExists')" = "true" ] \
    && [ "$(echo "$state" | jq -r '.actionsExists')" = "true" ] \
    && [ "$(echo "$state" | jq -r '.nowrapOk')" = "true" ] \
    && [ "$(echo "$state" | jq -r '.widthOk')" = "true" ] \
    && [ "$(echo "$state" | jq -r '.visibleCount')" -ge 5 ]; then
    record_pass "$case_id" "items=$(echo "$state" | jq -c '.items | map({text, width, height, whiteSpace})')"
  else
    record_fail "$case_id" "state=$(echo "$state" | jq -c '{gridTemplateColumns, visibleCount, nowrapOk, widthOk, items}')"
  fi
}

run_016() {
  local case_id="AGENT-CHROME-016"
  local original_settings original_value original_preview preview_result target_value
  local before set_result after

  open_topic_by_index 0 >/dev/null || {
    record_fail "$case_id" "无法打开抽屉"
    return 0
  }

  original_settings=$(settings_values)
  original_value=$(echo "$original_settings" | jq -r '.postBodyFontSize // empty')
  original_preview=$(echo "$original_settings" | jq -r '.previewMode // empty')
  if [ -z "$original_value" ] || [ -z "$original_preview" ]; then
    record_fail "$case_id" "无法读取当前设置"
    return 0
  fi

  preview_result=$(set_setting_value previewMode smart)
  if [ "$(echo "$preview_result" | jq -r '.ok')" != "true" ]; then
    record_fail "$case_id" "无法切到智能预览: $preview_result"
    return 0
  fi
  ab wait 1200 >/dev/null
  ensure_settings_open
  before=$(post_body_font_state)
  target_value=18
  if [ "$original_value" = "18" ]; then
    target_value=13
  fi

  set_result=$(set_setting_value postBodyFontSize "$target_value")
  if [ "$(echo "$set_result" | jq -r '.ok')" != "true" ]; then
    ensure_settings_closed
    record_fail "$case_id" "无法设置正文字号: $set_result"
    return 0
  fi

  ab wait 200 >/dev/null
  after=$(post_body_font_state)

  set_setting_value postBodyFontSize "$original_value" >/dev/null || true
  set_setting_value previewMode "$original_preview" >/dev/null || true
  ab wait 200 >/dev/null
  ensure_settings_closed

  if [ "$(echo "$before" | jq -r '.pageOpen')" = "true" ] \
    && [ "$(echo "$before" | jq -r '.bodyExists')" = "true" ] \
    && [ "$(echo "$after" | jq -r '.bodyExists')" = "true" ] \
    && [ "$(echo "$after" | jq -r '.controlValue // empty')" = "$target_value" ] \
    && [ "$(echo "$after" | jq -r '.valueText // empty')" = "${target_value}px" ] \
    && [ "$(echo "$after" | jq -r '.bodyFontSize')" = "$target_value" ] \
    && { [ "$(echo "$after" | jq -r '.codeExists')" != "true" ] || [ "$(echo "$after" | jq -r '.codeFontSize')" = "$((target_value - 1))" ]; } \
    && [ "$(echo "$before" | jq -r '.bodyFontSize')" != "$(echo "$after" | jq -r '.bodyFontSize')" ]; then
    record_pass "$case_id" "before=$(echo "$before" | jq -c '{bodyFontSize, codeExists, codeFontSize, controlValue, valueText}') after=$(echo "$after" | jq -c '{bodyFontSize, codeExists, codeFontSize, controlValue, valueText}')"
  else
    record_fail "$case_id" "before=$(echo "$before" | jq -c '{pageOpen, bodyExists, bodyFontSize, codeExists, codeFontSize, controlValue, valueText}') after=$(echo "$after" | jq -c '{pageOpen, bodyExists, bodyFontSize, codeExists, codeFontSize, controlValue, valueText}') target=$target_value"
  fi
}

run_017() {
  local case_id="AGENT-CHROME-017"
  local original_settings original_preview preview_result state

  open_topic_by_index 0 >/dev/null || {
    record_fail "$case_id" "无法打开抽屉"
    return 0
  }

  original_settings=$(settings_values)
  original_preview=$(echo "$original_settings" | jq -r '.previewMode // empty')
  if [ -z "$original_preview" ]; then
    record_fail "$case_id" "无法读取当前预览模式"
    return 0
  fi

  preview_result=$(set_setting_value previewMode iframe)
  if [ "$(echo "$preview_result" | jq -r '.ok')" != "true" ]; then
    record_fail "$case_id" "无法切到整页模式: $preview_result"
    return 0
  fi

  ab wait 1200 >/dev/null
  ensure_settings_open
  state=$(post_body_font_state)

  set_setting_value previewMode "$original_preview" >/dev/null || true
  ab wait 200 >/dev/null
  ensure_settings_closed

  if [ "$(echo "$state" | jq -r '.pageOpen')" = "true" ] \
    && [ "$(echo "$state" | jq -r '.fieldDisabled')" = "true" ] \
    && [ "$(echo "$state" | jq -r '.fieldAriaDisabled // empty')" = "true" ] \
    && [ "$(echo "$state" | jq -r '.controlDisabled')" = "true" ] \
    && [ "$(echo "$state" | jq -r '.fieldHidden')" = "true" ]; then
    record_pass "$case_id" "state=$(echo "$state" | jq -c '{fieldDisabled, fieldAriaDisabled, controlDisabled, valueText, hintText}')"
  else
    record_fail "$case_id" "state=$(echo "$state" | jq -c '{pageOpen, fieldDisabled, fieldAriaDisabled, controlDisabled, controlValue, valueText, hintText}')"
  fi
}

run_case() {
  local case_id=$1
  case "$case_id" in
    AGENT-CHROME-001) run_001 ;;
    AGENT-CHROME-002) run_002 ;;
    AGENT-CHROME-003) run_003 ;;
    AGENT-CHROME-004) run_004 ;;
    AGENT-CHROME-005) run_005 ;;
    AGENT-CHROME-006) run_006 ;;
    AGENT-CHROME-008) run_008 ;;
    AGENT-CHROME-009) run_009 ;;
    AGENT-CHROME-010) run_010 ;;
    AGENT-CHROME-013) run_013 ;;
    AGENT-CHROME-014) run_014 ;;
    AGENT-CHROME-015) run_015 ;;
    AGENT-CHROME-016) run_016 ;;
    AGENT-CHROME-017) run_017 ;;
    *)
      record_fail "$case_id" "未知用例 ID"
      ;;
  esac
}

require_cmd agent-browser
require_cmd jq
ensure_cdp

echo "Running agent smoke against CDP port $CDP_PORT"

for case_id in "${CASES[@]}"; do
  if ! run_case "$case_id"; then
    record_fail "$case_id" "脚本执行异常"
  fi
done

echo "Summary: PASS=$PASS_COUNT FAIL=$FAIL_COUNT SKIP=$SKIP_COUNT"

if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
