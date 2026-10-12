const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const session = `sidepeek-replies-check-${process.pid}`;
const run = (args, input) => {
  const result = spawnSync("agent-browser", ["--session", session, ...args], { input, encoding: "utf8", maxBuffer: 2_000_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
};
const evaluate = (code) => run(["eval", "--stdin"], code);
const source = fs.readFileSync(path.join(__dirname, "../src/content.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "../src/content.css"), "utf8");
const html = '<!doctype html><meta charset="utf-8"><meta name="csrf-token" content="test-csrf"><title>楼中楼固定页面</title><div id="current-user"></div>' +
  '<main id="main-outlet"><a class="title" href="/t/test/1">楼中楼测试主题</a><a class="title" href="/t/test/2">另一个主题</a></main>';

try {
  run(["open", "about:blank"]);
  run(["network", "route", "https://linux.do/latest", "--body", html]);
  run(["open", "https://linux.do/latest"]);
  run(["set", "viewport", "1280", "800"]);
  evaluate(`(() => {
    localStorage.clear();
    Object.defineProperty(document, 'hasFocus', {value:() => true});
    localStorage.setItem('ld-drawer-settings-v1', JSON.stringify({showTrustStatus:'off', enhancedBookmarks:'off'}));
    window.replyRequests = [];
    window.replyFail = false;
    window.replyPending = false;
    window.makePost = (number, parent = null, count = 0) => ({
      id: 100 + number, topic_id: 1, post_number: number, username: 'user' + number, name: '用户 ' + number,
      created_at: '2026-01-01T00:00:00Z', reply_to_post_number: parent, reply_to_user: parent ? {username:'user' + parent} : null,
      reply_count: count, cooked: '<p>第 ' + number + ' 楼正文：在这里直接阅读回复，无需离开当前楼层。</p><p><a href="https://linux.do/latest">正文链接</a></p>',
      actions_summary: []
    });
    window.replyTopic = { id:1, title:'楼中楼测试主题', posts_count:3,
      post_stream:{posts:[makePost(1, null, 3), makePost(4, 2), makePost(8, null, 1)],stream:[101,104,108]} };
    window.fetch = async (input, options = {}) => {
      const url = new URL(input, location.href);
      const request = {path:url.pathname, after:url.searchParams.get('after'), options};
      replyRequests.push(request);
      const json = data => new Response(JSON.stringify(data), {headers:{'content-type':'application/json'}});
      if (url.pathname === '/topics/timings') return json({});
      if (url.pathname.startsWith('/posts/')) {
        if (replyPending) return new Promise(resolve => { request.resolve = resolve; });
        if (replyFail) return new Response('{}', {status:503, headers:{'content-type':'application/json'}});
        if (url.pathname === '/posts/by_number/1/2') return json(makePost(2,1,1));
        if (url.pathname === '/posts/101/replies') return json(request.after === '1' ? [makePost(2,1,1)] : request.after === '2' ? [makePost(2,1,1),makePost(5,1)] : [makePost(5,1),makePost(6,1)]);
        if (url.pathname === '/posts/102/replies') return json([makePost(3,2)]);
        return json([]);
      }
      return json(replyTopic);
    };
    const style = document.createElement('style'); style.textContent = ${JSON.stringify(css)}; document.head.append(style);
    ${source.replace(/^  init\(\);$/m, "  init(); globalThis.replyTest = { state, getVisibleReadingPosts, appendLoadedPostsIncrementally, tickReading, flushReading, loadSettings, resetSettings }; ")}
  })()`);
  run(["click", '#main-outlet a[href="/t/test/1"]']);
  run(["wait", "--fn", "!!document.querySelector('.ld-post-card[data-post-number=\"1\"]')"]);
  console.log(evaluate(`(async () => {
    const {state:s, getVisibleReadingPosts, appendLoadedPostsIncrementally} = replyTest;
    const check = (value, message) => { if (!value) throw Error(message); };
    const settle = async () => {
      for (let i = 0; s.inlineReplyControllers.size && i < 200; i++) await new Promise(resolve => setTimeout(resolve,10));
      check(!s.inlineReplyControllers.size, '回复请求未结束');
    };
    const root = s.content.querySelector('.ld-post-card[data-post-number="1"]');
    const trigger = root.querySelector('.ld-post-info-item--replies-trigger');
    const region = root.querySelector(':scope > .ld-inline-thread');
    check(region.hidden && !replyRequests.some(r => r.path.startsWith('/posts/')), '展开前请求了回复');
    trigger.click(); trigger.click();
    check(region.hidden, '加载中无法收起');
    await settle();
    trigger.click(); await settle();
    check(!region.hidden && region.querySelectorAll(':scope > .ld-inline-post').length === 1, '直接回复未内联展开');
    const child = region.querySelector('.ld-inline-post');
    check(child.querySelector('.ld-post-body').textContent.includes('第 2 楼正文'), '只展示了摘要');
    const link = child.querySelector('.ld-post-body a');
    check(link.target === '_blank' && link.rel === 'noopener noreferrer', '正文链接属性丢失');
    child.querySelector('.ld-post-info-item--replies-trigger').click(); await settle();
    check(child.querySelector(':scope > .ld-inline-thread .ld-post-body').textContent.includes('第 3 楼正文'), '子回复不能展开');
    child.querySelector('.ld-post-body').click();
    check(!region.hidden && trigger.getAttribute('aria-expanded') === 'true', '正文被浮层关闭逻辑收起');
    region.querySelector(':scope > .ld-inline-more').click(); await settle();
    check(region.querySelectorAll(':scope > .ld-inline-post').length === 2 && region.querySelector(':scope > .ld-inline-more'), '分页重复或没有停止');
    check(replyRequests.some(r => r.path === '/posts/101/replies' && r.after === '2'), '分页游标错误');
    region.querySelector(':scope > .ld-inline-more').click(); await settle();
    check(region.querySelectorAll(':scope > .ld-inline-post').length === 3 && !region.querySelector(':scope > .ld-inline-more'), '第三页重复或没有停止');
    check(s.content.querySelectorAll('.ld-post-card').length === 3, '内嵌副本使用了主楼标识');
    s.directReplyCache.delete(2);
    replyPending = true;
    region.querySelector('.ld-post-info-item--replies-trigger').click();
    const pendingChild = replyRequests.at(-1);
    region.querySelector(':scope > .ld-inline-collapse').click();
    check(pendingChild.options.signal.aborted, '收起父区域未取消子回复请求');
    pendingChild.resolve(new Response(JSON.stringify([makePost(3,2)]), {headers:{'content-type':'application/json'}}));
    await settle();
    check(!s.directReplyCache.has(2), '收起后子回复旧响应写回缓存');
    replyPending = false;
    trigger.click(); await settle();
    const before = replyRequests.filter(r => r.path.startsWith('/posts/')).length;
    region.querySelector(':scope > .ld-inline-collapse').click();
    check(!region.children.length && document.activeElement === trigger, '收起未移除正文或未归还焦点');
    trigger.click(); await settle();
    check(replyRequests.filter(r => r.path.startsWith('/posts/')).length === before, '重开重复加载');
    const parentTab = s.content.querySelector('.ld-post-card[data-post-number="4"] .ld-reply-to-tab');
    parentTab.click(); await settle();
    const parentRegion = parentTab.parentElement.querySelector('.ld-parent-preview');
    check(parentRegion.querySelector('.ld-post-body').textContent.includes('第 2 楼正文'), '父帖没有就地展开');
    check(!parentRegion.querySelector('.ld-post-info-item--replies-trigger'), '父帖预览递归进入当前回复');
    const newPost = makePost(2,1,1);
    const next = {...s.currentTopic, post_stream:{...s.currentTopic.post_stream, posts:[...s.currentTopic.post_stream.posts,newPost]}};
    appendLoadedPostsIncrementally(next,[newPost],s.drawerBody.scrollTop);
    const original = s.content.querySelector('.ld-post-card[data-post-number="2"]');
    check(original, '内嵌回复阻止主楼追加');
    let located = false; original.scrollIntoView = () => {located = true;};
    region.querySelector('.ld-inline-locate').click(); check(located, '定位落到了内嵌副本');
    const childBody = region.querySelector('.ld-post-body');
    childBody.innerHTML = '<p style="height:700px">只读子楼层</p>';
    childBody.scrollIntoView({block:'start'});
    check(getVisibleReadingPosts().has(2) && !getVisibleReadingPosts().has(1), '阅读子楼误记父楼或漏记子楼');
    s.reading.timings.clear(); s.reading.totals.clear(); s.reading.onscreen = new Set([2]);
    s.reading.lastTick = performance.now() - 1000;
    s.reading.lastFlush = s.reading.lastActivity = performance.now();
    replyTest.tickReading(); replyTest.flushReading(s.reading);
    await new Promise(resolve => setTimeout(resolve,20));
    const report = new URLSearchParams(replyRequests.filter(r => r.path === '/topics/timings').at(-1)?.options.body);
    check(report.has('timings[2]') && !report.has('timings[1]'), '实际阅读上报误记父楼或漏记子楼');
    childBody.innerHTML = makePost(2).cooked;
    parentTab.click();
    s.replyParentCache.clear();
    s.currentTopic = {...s.currentTopic, post_stream:{...s.currentTopic.post_stream, posts:s.currentTopic.post_stream.posts.filter(p => p.post_number !== 2)}};
    parentTab.click(); await settle();
    check(replyRequests.some(r => r.path === '/posts/by_number/1/2'), '未按需补取缺失父帖');
    const other = s.content.querySelector('.ld-post-card[data-post-number="8"]');
    const otherTrigger = other.querySelector('.ld-post-info-item--replies-trigger');
    const otherRegion = other.querySelector(':scope > .ld-inline-thread');
    replyFail = true; otherTrigger.click(); await settle();
    check(otherRegion.textContent.includes('加载失败'), '失败没有提示');
    replyFail = false;
    Array.from(otherRegion.querySelectorAll('button')).find(b => b.textContent === '重试').click(); await settle();
    check(otherRegion.textContent.includes('暂无可显示'), '失败无法重试或空回复提示缺失');
    otherTrigger.click(); s.directReplyCache.delete(8);
    replyPending = true; otherTrigger.click();
    const pending = replyRequests.at(-1);
    document.querySelector('.ld-drawer-close').click();
    check(pending.options.signal.aborted && !s.inlineReplyControllers.size, '关闭未取消请求');
    pending.resolve(new Response(JSON.stringify([makePost(9,8)]), {headers:{'content-type':'application/json'}}));
    await new Promise(resolve => setTimeout(resolve,30));
    check(!s.directReplyCache.size, '关闭后旧响应写回缓存');
    replyPending = false;
    return '直接正文、子回复、分页去重、收起缓存、父帖补取、主楼追加/定位、阅读可见性、失败重试及关闭竞态：通过';
  })()`).trim());
  run(["click", '#main-outlet a[href="/t/test/1"]']);
  run(["wait", "--fn", "!!replyTest.state.currentTopic"]);
  console.log(evaluate(`(async () => {
    const s = replyTest.state;
    replyPending = true;
    s.content.querySelector('.ld-post-card[data-post-number="8"] .ld-post-info-item--replies-trigger').click();
    const pending = replyRequests.at(-1);
    document.querySelector('#main-outlet a[href="/t/test/2"]').click();
    if (!pending.options.signal.aborted) throw Error('切帖未取消请求');
    pending.resolve(new Response(JSON.stringify([makePost(9,8)]), {headers:{'content-type':'application/json'}}));
    await new Promise(resolve => setTimeout(resolve,30));
    if (s.directReplyCache.size) throw Error('切帖后旧响应写回缓存');
    replyPending = false;
    document.querySelector('#main-outlet a[href="/t/test/1"]').click();
    return '切帖取消请求及旧响应隔离：通过';
  })()`).trim());
  run(["wait", "--fn", "!!replyTest.state.currentTopic && replyTest.state.currentUrl.endsWith('/1')"]);
  evaluate(`replyTest.state.toastStack.querySelectorAll('.ld-toast-close').forEach(button => button.click()); replyTest.state.content.querySelector('.ld-post-info-item--replies-trigger').click()`);
  run(["wait", "--fn", "!replyTest.state.inlineReplyControllers.size && !document.querySelector('.ld-toast')"]);
  console.log(evaluate(`(async () => {
    const {state:s, loadSettings, resetSettings} = replyTest;
    const check = (value, message) => {if (!value) throw Error(message);};
    const settle = async () => {for (let i=0;s.inlineReplyControllers.size && i<200;i++) await new Promise(r => setTimeout(r,10));};
    const changeMode = value => {
      s.settingsToggle.click();
      const control = s.settingsPanel.querySelector('[data-setting="replyDisplay"]');
      control.value = value; control.dispatchEvent(new Event('change',{bubbles:true}));
    };
    s.directReplyCache.delete(8);
    replyPending = true;
    s.content.querySelector('.ld-post-card[data-post-number="8"] .ld-post-info-item--replies-trigger').click();
    const switching = replyRequests.at(-1);
    changeMode('legacy');
    check(switching.options.signal.aborted, '切换模式未取消旧请求');
    switching.resolve(new Response(JSON.stringify([makePost(9,8)]), {headers:{'content-type':'application/json'}}));
    await settle();
    check(!s.directReplyCache.has(8), '模式切换后旧响应写回缓存');
    replyPending = false;
    check(s.settings.replyDisplay === 'legacy' && loadSettings().replyDisplay === 'legacy', '旧模式没有保存');
    check(!s.content.querySelector('.ld-inline-thread'), '旧模式仍保留楼中楼节点');
    const root = s.content.querySelector('.ld-post-card[data-post-number="1"]');
    const trigger = root.querySelector('.ld-post-info-item--replies-trigger');
    const popover = root.querySelector('.ld-post-replies-popover');
    trigger.click(); await settle();
    check(!popover.hidden && popover.querySelector('.ld-post-reply-preview-jump') && !popover.querySelector('.ld-post-body'), '旧模式没有摘要浮层');
    const rowsBefore = popover.querySelectorAll('.ld-post-reply-preview-row').length;
    if (popover.querySelector('.ld-inline-more')) {
      popover.querySelector('.ld-inline-more').click(); await settle();
      check(popover.querySelectorAll('.ld-post-reply-preview-row').length > rowsBefore && !popover.querySelector('.ld-post-body'), '旧模式分页没有新增摘要');
    }
    check(!popover.hidden, '摘要浮层加载更多被意外收起');
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    check(popover.hidden && s.root.getAttribute('aria-hidden') === 'false', 'Esc没有只关闭摘要浮层');
    trigger.click(); await settle(); root.querySelector('.ld-post-body').click();
    check(popover.hidden && trigger.getAttribute('aria-expanded') === 'false', '点击正文未关闭摘要浮层');
    let located = false;
    const target = s.content.querySelector('.ld-post-card[data-post-number="2"]');
    if (target) target.scrollIntoView = () => {located = true;};
    const parent = s.content.querySelector('.ld-post-card[data-post-number="4"] .ld-reply-to-tab');
    // 缓存恢复的主题可能没有主楼 2，补上固定主楼供定位断言使用。
    if (!target) {
      const post = makePost(2,1,1);
      const next = {...s.currentTopic,post_stream:{...s.currentTopic.post_stream,posts:[...s.currentTopic.post_stream.posts,post]}};
      replyTest.appendLoadedPostsIncrementally(next,[post],s.drawerBody.scrollTop);
      s.content.querySelector('.ld-post-card[data-post-number="2"]').scrollIntoView = () => {located = true;};
    }
    parent.click();
    check(located && !s.content.querySelector('.ld-parent-preview'), '旧模式父帖没有直接跳转');
    trigger.click(); await settle();
    located = false;
    popover.querySelector('.ld-post-reply-preview-jump').click();
    check(located && popover.hidden, '摘要点击没有定位和收起');
    changeMode('inline');
    check(s.settings.replyDisplay === 'inline' && loadSettings().replyDisplay === 'inline' && s.content.querySelector('.ld-inline-thread'), '切回楼中楼失败');
    s.content.querySelector('.ld-post-info-item--replies-trigger').click(); await settle();
    check(s.content.querySelector('.ld-inline-thread .ld-inline-post .ld-post-body') && !s.content.querySelector('.ld-post-replies-popover'), '切回后没有实际展开正文');
    changeMode('legacy');
    resetSettings();
    check(s.settings.replyDisplay === 'inline' && loadSettings().replyDisplay === 'inline', '恢复默认没有重置回复模式');
    const saved = localStorage.getItem('ld-drawer-settings-v1');
    localStorage.setItem('ld-drawer-settings-v1',JSON.stringify({replyDisplay:'bad'}));
    check(loadSettings().replyDisplay === 'inline', '非法设置没有回退');
    localStorage.setItem('ld-drawer-settings-v1','{}');
    check(loadSettings().replyDisplay === 'inline', '旧设置没有默认楼中楼');
    localStorage.setItem('ld-drawer-settings-v1',saved);
    s.content.querySelector('.ld-post-info-item--replies-trigger').click(); await settle();
    return '回复展示设置、保存/旧值回退、双向切换、恢复默认及旧模式浮层/父楼跳转：通过';
  })()`).trim());
  for (const [width, height] of [[1280, 800], [390, 844]]) {
    run(["set", "viewport", String(width), String(height)]);
    console.log(evaluate(`(() => {
      const s = replyTest.state;
      s.drawerBody.scrollTop = 0;
      const root = s.root.getBoundingClientRect();
      for (const node of s.content.querySelectorAll('.ld-inline-post, .ld-inline-locate, .ld-post-info-item--replies-trigger')) {
        if (!node.getClientRects().length) continue;
        const rect = node.getBoundingClientRect();
        if (rect.left < root.left || rect.right > root.right + 1) throw Error('楼中楼或操作按钮超出抽屉');
      }
      return '楼中楼正文和操作边界：通过（${width}px）';
    })()`).trim());
    if (process.env.SIDEPEEK_SCREENSHOT_DIR) run(["screenshot", path.join(process.env.SIDEPEEK_SCREENSHOT_DIR, `replies-${width}.png`)]);
  }
  evaluate(`replyTest.state.content.querySelector('.ld-inline-post .ld-post-info-item--replies-trigger').click()`);
  run(["wait", "--fn", "!replyTest.state.inlineReplyControllers.size"]);
  console.log(evaluate(`(() => {
    const parent = replyTest.state.content.querySelector('.ld-inline-post');
    const nested = parent.querySelector(':scope > .ld-inline-thread > .ld-inline-post');
    if (parent.getBoundingClientRect().width - nested.getBoundingClientRect().width > 4) throw Error('深层回复累计缩进');
    nested.scrollIntoView({block:'center'});
    return '手机深层回复保持宽度：通过';
  })()`).trim());
  if (process.env.SIDEPEEK_SCREENSHOT_DIR) run(["screenshot", path.join(process.env.SIDEPEEK_SCREENSHOT_DIR, "replies-nested-mobile.png")]);
  evaluate(`const tab = replyTest.state.content.querySelector('.ld-post-card[data-post-number="4"] .ld-reply-to-tab'); tab.click(); tab.scrollIntoView({block:'start'});`);
  run(["wait", "--fn", "!replyTest.state.inlineReplyControllers.size"]);
  if (process.env.SIDEPEEK_SCREENSHOT_DIR) run(["screenshot", path.join(process.env.SIDEPEEK_SCREENSHOT_DIR, "replies-parent-mobile.png")]);
  for (const [width, height] of [[1280,800],[390,844]]) {
    run(["set","viewport",String(width),String(height)]);
    evaluate("replyTest.state.settingsToggle.click(); replyTest.state.settingsPanel.querySelector('[data-setting=replyDisplay]').scrollIntoView({block:'center'})");
    if (process.env.SIDEPEEK_SCREENSHOT_DIR) run(["screenshot",path.join(process.env.SIDEPEEK_SCREENSHOT_DIR, `reply-settings-${width}.png`)]);
    run(["select",'[data-setting="replyDisplay"]',"legacy"]);
    evaluate("replyTest.state.drawerBody.scrollTop=0; replyTest.state.content.querySelector('.ld-post-info-item--replies-trigger').click()");
    run(["wait","--fn","!replyTest.state.inlineReplyControllers.size"]);
    if (process.env.SIDEPEEK_SCREENSHOT_DIR) run(["screenshot",path.join(process.env.SIDEPEEK_SCREENSHOT_DIR, `reply-legacy-${width}.png`)]);
    evaluate("replyTest.state.settingsToggle.click()");
    run(["select",'[data-setting="replyDisplay"]',"inline"]);
  }
  evaluate("document.documentElement.style.cssText = '--primary:#e2e8f0;--secondary:#17212b;--primary-low:#334155;--primary-medium:#94a3b8;--tertiary:#60a5fa'; document.body.style.background='#17212b'");
  run(["wait", "--fn", "getComputedStyle(document.querySelector('.ld-reply-to-tab')).color === 'rgb(148, 163, 184)'"]);
  if (process.env.SIDEPEEK_SCREENSHOT_DIR) run(["screenshot", path.join(process.env.SIDEPEEK_SCREENSHOT_DIR, "replies-dark.png")]);
  assert.equal(run(["errors"]).trim(), "");
} finally {
  run(["close"]);
}
