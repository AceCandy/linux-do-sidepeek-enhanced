const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const session = `sidepeek-preview-check-${process.pid}`;
const run = (args, input) => {
  const result = spawnSync("agent-browser", ["--session", session, ...args], { input, encoding: "utf8", maxBuffer: 2_000_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
};
const evaluate = (code) => run(["eval", "--stdin"], code);
const source = fs.readFileSync(path.join(__dirname, "../src/content.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "../src/content.css"), "utf8");
const reactionImages = {};
if (process.env.SIDEPEEK_SCREENSHOT_DIR) {
  for (const id of ["heart", "+1", "laughing", "open_mouth", "clap", "confetti_ball", "hugs", "roll_eyes", "sob", "cat"]) {
    const file = path.join(process.env.SIDEPEEK_SCREENSHOT_DIR, `${id}.png`);
    if (fs.existsSync(file)) reactionImages[id] = `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;
  }
}
const nativeSource = fs.readFileSync(path.join(__dirname, "../src/native-renderer.js"), "utf8");
const html = '<!doctype html><meta charset="utf-8"><meta name="csrf-token" content="test-csrf"><title>预取与阅读固定页面</title><div id="current-user"></div>' +
  '<main id="main-outlet" style="margin:60px 300px">' + [1, 2, 3, 4, 5, 6].map(id =>
    `<div class="topic-list-item" style="height:48px"><a class="title" href="/t/test/${id}">主题 ${id}</a></div>`).join("") +
  '<div class="topic-list-item" style="margin-top:1500px"><a class="title" href="/t/test/99">屏幕外主题</a></div></main>';

try {
  run(["open", "about:blank"]);
  run(["network", "route", "https://linux.do/latest", "--body", html]);
  run(["open", "https://linux.do/latest"]);
  evaluate(`(() => {
    localStorage.clear();
    window.requests = [];
    window.testFocus = true;
    Object.defineProperty(document, "hasFocus", { value: () => window.testFocus });
    window.GM_xmlhttpRequest = options => options.onerror();
    window.fetch = async (input, options = {}) => {
      const url = new URL(input, location.href);
      window.requests.push({ path: url.pathname, tracked: url.searchParams.has("track_visit"), time: performance.now(),
        method: options.method || "GET", body: options.body?.toString(), credentials: options.credentials });
      if (url.pathname === "/topics/timings") return new Response("{}", {headers:{"content-type":"application/json"}});
      const id = Number(url.pathname.match(/\\/(\\d+)(?:\\/[^/]+)?\\.json$/)?.[1]);
      if (!id) throw Error("固定页面禁止访问其他接口");
      const posts = [1, 2, 3].map(number => ({ id: id * 100 + number, post_number: number, username: "test-user",
        created_at: "2026-01-01T00:00:00Z", cooked: '<p style="height:700px">固定正文 ' + number + '</p>', actions_summary: [] }));
      return new Response(JSON.stringify({ id, title: "主题 " + id, posts_count: 3, tags: ['纯水', {name:'ChatGPT'}, 'OpenAI'],
        post_stream: {posts, stream: posts.map(post => post.id)} }), {headers:{"content-type":"application/json"}});
    };
    const style = document.createElement("style");
    style.textContent = ${JSON.stringify(css)};
    document.head.append(style);
    ${source.replace(/^  init\(\);$/m, "  init(); globalThis.previewTest = { state, getVisibleReadingPosts, buildPostCard, initializePostCarousels, loadTopic, fetchPreviewResponse, runTopicPrefetch, loadVisibleInlineReplies, syncEditedPost, renderIframeFallback, REACTION_URL_CACHE };")}
  })()`);
  run(["wait", "--fn", "window.previewTest.state.topicCache.size === 6"]);
  console.log(evaluate(`(() => {
    const requests = window.requests;
    if (requests.some(r => r.method === "POST" || r.tracked || r.path.includes("/99"))) throw Error("预取范围或计数错误");
    for (let i = 2; i < requests.length; i++) {
      if (requests[i].time - requests[i - 2].time < 990) throw Error("预取超过每秒两个");
    }
    return "真实可见标题发现、限速、屏幕外排除和预取不计数：通过";
  })()`).trim());
  run(["snapshot", "-i"]);
  evaluate('document.querySelector(\'#main-outlet a[href="/t/test/6"]\').href = "/t/test/7"');
  run(["wait", "--fn", "window.previewTest.state.topicCache.size === 7"]);
  run(["click", '#main-outlet a[href="/t/test/1"]']);
  console.log(evaluate(`(() => {
    const s = window.previewTest.state;
    if (s.meta.querySelectorAll('.ld-tag').length !== 3 || s.content.querySelector('.ld-tag-list')) throw Error('标签未移动到主题信息区');
    if (s.content.textContent.includes('抽屉预览是便捷阅读视图') || !s.toastStack.querySelector('.ld-toast-close')) throw Error('说明仍占正文空间或不可关闭');
    if (s.content.querySelector('.ld-reading-mode') || s.content.querySelector('.ld-post-card').getBoundingClientRect().top - s.drawerBody.getBoundingClientRect().top > 12) throw Error('正文多余切换栏或首帖与标题间仍有空白');
    s.toastStack.querySelector('.ld-toast-close').click();
    return '标签并入标题信息、首帖紧凑布局和一次性可关闭悬浮说明：通过';
  })()`).trim());
  run(['wait','--fn','!document.querySelector(".ld-toast-dismissible")']);
  for(const shortcut of ["Control+f","Meta+f"]) {
    run(["press",shortcut]);
    console.log(evaluate(`(() => {
      const s=previewTest.state;
      if(s.topicSearchPanel.hidden || document.activeElement!==s.topicSearchInput) throw Error('实际键盘快捷键未打开帖内搜索');
      return '帖内搜索实际键盘 ${shortcut}：通过';
    })()`).trim());
    run(["press","Escape"]);
    evaluate(`if(!previewTest.state.topicSearchPanel.hidden) throw Error('Esc 未关闭快捷搜索')`);
  }
  for (const width of [1280, 390]) {
    run(['set','viewport',String(width),'800']);
    console.log(evaluate(`(() => {
      const s = window.previewTest.state;
      const reply = s.replyFabButton.getBoundingClientRect(), top = s.topFabButton.getBoundingClientRect(), bottom = s.bottomFabButton.getBoundingClientRect(), root = s.root.getBoundingClientRect();
      const refresh = s.latestRepliesRefreshButton.getBoundingClientRect(), search = s.topicSearchButton.getBoundingClientRect();
      const tools=s.root.querySelector('.ld-reading-tools').getBoundingClientRect(), body=s.drawerBody.getBoundingClientRect();
      const buttons=[refresh,search,top,bottom,reply];
      if(buttons.some(r=>r.width===0 || r.left<tools.left || r.right>tools.right || r.top<tools.top || r.bottom>tools.bottom) || body.bottom>tools.top+1) throw Error('底部工具栏超界或遮挡正文');
      if(buttons.some(r=>Math.abs(r.top-top.top)>4) || refresh.right>search.left || search.right>top.left || top.right>bottom.left || bottom.right>reply.left) throw Error('底部工具未保持单排顺序');
      if (s.header.querySelector('.ld-drawer-refresh, .ld-drawer-back-top')) throw Error('顶部仍有重复按钮');
      s.drawerBody.scrollTop = 500; s.topFabButton.click();
      if (s.drawerBody.scrollTop !== 0) throw Error('悬浮回到顶部失效');
      s.replyFabButton.click();
      if (s.replyPanel.hidden || !s.topFabButton.hidden || !s.bottomFabButton.hidden || !s.latestRepliesRefreshButton.hidden || !s.topicSearchButton.hidden) throw Error('回复面板与悬浮按钮冲突');
      s.replyCancelButton.click();
      if (s.topFabButton.hidden) throw Error('关闭回复后未恢复悬浮回顶');
      s.topicSearchButton.click();
      const panel = s.topicSearchPanel.getBoundingClientRect();
      if (s.topicSearchPanel.hidden || document.activeElement !== s.topicSearchInput || panel.left < root.left || panel.right > root.right || s.topicSearchPanel.scrollWidth > panel.width) throw Error('帖内搜索未聚焦或窄屏溢出');
      if (s.topicSearchInput.placeholder !== '搜索当前话题内容') throw Error('帖内搜索提示文案不正确');
      document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true}));
      if (!s.topicSearchPanel.hidden || !document.body.classList.contains('ld-drawer-page-open') || document.activeElement !== s.topicSearchButton) throw Error('Esc 未关闭搜索并恢复焦点');
      return '底部工具栏位置、回顶及回复开关：通过（${width}px）';
    })()`).trim());
  }
  if (process.env.SIDEPEEK_SCREENSHOT_DIR) {
    evaluate('previewTest.state.topicSearchButton.click()');
    for (const width of [1280, 390]) {
      run(['set', 'viewport', String(width), '800']);
      run(['screenshot', path.join(process.env.SIDEPEEK_SCREENSHOT_DIR, `topic-search-${width}.png`)]);
    }
    evaluate('previewTest.state.topicSearchPanel.querySelector(".ld-topic-search-close").click()');
  }
  run(['set','viewport','1280','720']);
  run(["wait", "--fn", "window.requests.some(r => r.method === 'POST')"]);
  console.log(evaluate(`(() => {
    const records = window.requests;
    if (records.filter(r => r.path === "/t/test/1.json" && !r.tracked).length !== 1) throw Error("点击重复获取缓存正文");
    if (records.filter(r => r.tracked).length !== 1) throw Error("访问跟踪次数错误");
    const report = new URLSearchParams(records.find(r => r.method === "POST").body);
    if (report.get("topic_id") !== "1" || !report.has("timings[1]") || report.has("timings[2]") || report.has("timings[3]")) throw Error("上报了未见楼层");
    return "缓存点击、访问跟踪、实际楼层可见性和阅读上报：通过";
  })()`).trim());
  console.log(evaluate(`(async () => {
    const s = window.previewTest.state;
    const before = window.requests.filter(r => r.path === '/t/test/1.json').length;
    s.latestRepliesRefreshButton.click();
    if (!s.latestRepliesRefreshButton.disabled) throw Error('刷新期间未禁用按钮');
    while (s.isRefreshingLatestReplies) await new Promise(resolve => setTimeout(resolve, 10));
    if (window.requests.filter(r => r.path === '/t/test/1.json').length !== before + 1 || s.latestRepliesRefreshButton.disabled) throw Error('刷新未重新获取当前主题或未恢复按钮');
    return '普通智能预览刷新及防重复点击：通过';
  })()`).trim());
  run(["click", ".ld-drawer-settings-toggle"]);
  assert.equal(evaluate('window.previewTest.state.latestRepliesRefreshButton.hidden').trim(), 'true');
  for (const [width, height] of [[1280, 800], [390, 640]]) {
    run(['set', 'viewport', String(width), String(height)]);
    console.log(evaluate(`(() => {
      const s = window.previewTest.state, card = s.settingsCard.getBoundingClientRect(), panel = s.settingsPanel.getBoundingClientRect();
      if (card.top - panel.top < 30 || panel.bottom - card.bottom < 30 || Math.abs((card.top + card.bottom) - (panel.top + panel.bottom)) > 2) throw Error('设置弹窗未居中留白');
      if (s.settingsCard.scrollHeight <= s.settingsCard.clientHeight) throw Error('设置项应在卡片内部滚动');
      return '设置弹窗居中、留白和内部滚动：通过（${width}px）';
    })()`));
  }
  run(['select', '[data-setting="showTrustStatus"]', 'off']);
  assert.equal(evaluate('previewTest.state.trustPanel.hidden').trim(), 'true');
  run(['select', '[data-setting="showTrustStatus"]', 'on']);
  console.log(evaluate(`(() => {
    const panel = previewTest.state.trustPanel;
    if (panel.hidden || panel.getBoundingClientRect().width > 90) throw Error('等级收起标签未缩小或未恢复');
    return '等级显示开关与紧凑标签：通过';
  })()`));
  run(['set', 'viewport', '1600', '900']);
  evaluate(`(() => {
    const main = document.querySelector('#main-outlet'); window.originalListStyle = main.style.cssText;
    const wrapper = document.createElement('div'); wrapper.id = 'main-outlet-wrapper';
    main.before(wrapper); const sidebar = document.createElement('aside'); sidebar.className = 'sidebar-wrapper';
    wrapper.append(sidebar, main); main.style.margin = '60px 0';
    const style = document.createElement('style'); style.id = 'test-list-layout';
    style.textContent = '#main-outlet-wrapper { display:grid; grid-template-columns:220px minmax(0,1fr); grid-template-areas:"sidebar content"; max-width:1100px; margin:0 auto; } #main-outlet {grid-area:content;} .sidebar-wrapper{grid-area:sidebar;}';
    document.head.append(style); document.body.classList.add('navigation-topics');
  })()`);
  run(['select', '[data-setting="listAlignLeft"]', 'on']);
  run(['wait', '--fn', 'parseFloat(getComputedStyle(document.body).paddingRight) === 0']);
  console.log(evaluate(`(() => {
    const wrapper = document.querySelector('#main-outlet-wrapper'), sidebar = wrapper.querySelector('.sidebar-wrapper');
    if (wrapper.getBoundingClientRect().left > 30 || getComputedStyle(sidebar).display === 'none') throw Error('容器未靠左或原站边栏被隐藏');
    if (document.querySelector('#main-outlet').getBoundingClientRect().left < sidebar.getBoundingClientRect().right) throw Error('原站边栏网格被覆盖');
    sidebar.hidden = true;
    wrapper.style.gridTemplateColumns = 'minmax(0, 1fr)'; wrapper.style.gridTemplateAreas = '"content"';
    if (getComputedStyle(sidebar).display !== 'none' || document.querySelector('#main-outlet').getBoundingClientRect().left > 30) throw Error('原站收起边栏后列表未靠左');
    sidebar.hidden = false; wrapper.style.gridTemplateColumns = ''; wrapper.style.gridTemplateAreas = '';
    if (getComputedStyle(sidebar).display === 'none' || document.querySelector('#main-outlet').getBoundingClientRect().left < sidebar.getBoundingClientRect().right) throw Error('原站边栏未恢复布局');
    const saved = JSON.parse(localStorage.getItem('ld-drawer-settings-v1'));
    if (saved.listAlignLeft !== 'on' || saved.showTrustStatus !== 'on') throw Error('新设置未保存');
    const list = document.querySelector('#main-outlet');
    const opened = list.getBoundingClientRect();
    if (opened.right <= previewTest.state.root.getBoundingClientRect().left) throw Error('悬浮模式不应为抽屉压缩列表');
    document.body.classList.remove('ld-drawer-page-open');
    const closed = list.getBoundingClientRect();
    if (Math.abs(opened.left - closed.left) > 1 || Math.abs(opened.width - closed.width) > 1 || getComputedStyle(sidebar).display === 'none') throw Error('关闭抽屉改变了列表或边栏布局');
    document.body.classList.add('ld-drawer-page-open');
    const reopened = list.getBoundingClientRect();
    if (Math.abs(reopened.left - closed.left) > 1 || Math.abs(reopened.width - closed.width) > 1) throw Error('重新打开悬浮抽屉改变列表布局');
    document.body.classList.remove('ld-list-align-left');
    if (getComputedStyle(document.querySelector('.sidebar-wrapper')).display === 'none') throw Error('关闭靠左设置未恢复原站导航');
    document.body.classList.add('ld-list-align-left');
    document.body.classList.replace('navigation-topics', 'search-page');
    const search = list.getBoundingClientRect();
    if (Math.abs(search.left - reopened.left) > 1 || Math.abs(search.width - reopened.width) > 1) throw Error('独立搜索页未复用靠左布局');
    const searchContent = document.createElement('section'); searchContent.className = 'search-container';
    searchContent.innerHTML = '<div class="search-header"><input></div><div class="search-advanced"><div class="search-info">筛选</div><div class="result-count">结果数</div><div class="search-results"><div class="fps-result">帖子</div></div></div>';
    list.append(searchContent);
    const searchStyle = document.createElement('style');
    searchStyle.textContent = '.search-header, .search-advanced > .search-results {padding-inline:10%} .search-info, .result-count {margin-inline:10%}';
    document.head.append(searchStyle);
    const contentEdges = () => [...searchContent.querySelectorAll('input, .search-info, .result-count, .fps-result')].map(e => e.getBoundingClientRect().left);
    if (contentEdges().some(left => Math.abs(left - search.left) > 1)) throw Error('搜索内容内层仍有额外缩进');
    document.body.classList.remove('ld-drawer-page-open');
    if (Math.abs(list.getBoundingClientRect().left - search.left) > 1 || Math.abs(list.getBoundingClientRect().width - search.width) > 1) throw Error('搜索页随抽屉收放改变布局');
    document.body.classList.add('ld-drawer-page-open');
    document.body.classList.remove('ld-list-align-left');
    if (wrapper.getBoundingClientRect().left <= 30) throw Error('关闭设置后搜索页未恢复居中');
    if (contentEdges().some(left => left <= list.getBoundingClientRect().left + 20)) throw Error('关闭设置未恢复搜索内层间距');
    searchContent.remove(); searchStyle.remove();
    document.body.classList.add('ld-list-align-left');
    document.body.classList.replace('search-page', 'navigation-topics');
    return '原站边栏展开收起、宽屏持续靠左、悬浮开关不改变列表尺寸：通过';
  })()`));
  run(['set', 'viewport', '390', '640']);
  assert.equal(evaluate('getComputedStyle(document.querySelector(".sidebar-wrapper")).display !== "none"').trim(), 'true');
  run(['select', '[data-setting="listAlignLeft"]', 'off']);
  evaluate(`(() => {
    const main = document.querySelector('#main-outlet'), wrapper = main.parentElement;
    wrapper.before(main); wrapper.remove(); main.style.cssText = window.originalListStyle;
    document.querySelector('#test-list-layout').remove(); document.body.classList.remove('navigation-topics');
  })()`);
  run(['set', 'viewport', '1280', '720']);
  run(['select', '[data-setting="showTrustStatus"]', 'off']);
  run(['select', '[data-setting="listAlignLeft"]', 'on']);
  run(['click', '.ld-settings-reset']);
  console.log(evaluate(`(() => {
    const s = previewTest.state, saved = JSON.parse(localStorage.getItem('ld-drawer-settings-v1'));
    if (s.trustPanel.hidden || document.body.classList.contains('ld-list-align-left') || saved.showTrustStatus !== 'on' || saved.listAlignLeft !== 'off') throw Error('恢复默认未重置等级和列表布局');
    return '恢复默认同步设置、等级可见性和列表布局：通过';
  })()`));
  console.log(evaluate(`(() => {
    const s=previewTest.state;
    if (!s.reading || s.settingsPanel.querySelector('[data-setting="trackPreviewVisit"]')) throw Error('阅读未默认同步或遗留开关');
    return "阅读进度始终启用：通过";
  })()`).trim());
  run(["click", ".ld-drawer-close"]);
  evaluate(`(() => {
    const row = document.createElement("div"); row.className = "topic-list-item";
    const link = document.createElement("a"); link.className = "title"; link.href = "/t/test/1/3"; link.textContent = "第三楼";
    row.append(link); document.querySelector("#main-outlet").prepend(row);
  })()`);
  run(["snapshot", "-i"]);
  run(["click", '#main-outlet a[href="/t/test/1/3"]']);
  run(["wait", "--fn", "window.previewTest.state.drawerBody.scrollTop > 0"]);
  console.log(evaluate(`(() => {
    const state = window.previewTest.state;
    if (state.currentResolvedTargetPostNumber !== 3 || !state.openInTab.href.endsWith("/1/3")) throw Error("目标楼层丢失");
    if (state.topicCache.size !== 7) throw Error("同一主题的楼层没有合并缓存");
    if (state.toastStack.querySelector('.ld-toast-dismissible')) throw Error('预览说明重复出现');
    if (!window.previewTest.getVisibleReadingPosts().has(3)) throw Error("目标楼层未实际显示");
    return "动态列表、统一主题缓存和深链接定位：通过";
  })()`).trim());
  console.log(evaluate(`(() => {
    const state = window.previewTest.state;
    state.root.querySelector('.ld-drawer-back-top').click();
    if (state.drawerBody.scrollTop !== 0) throw Error('返回顶部没有滚动智能正文');
    state.root.classList.add('ld-drawer-iframe-mode');
    if (getComputedStyle(state.root.querySelector('.ld-drawer-back-top')).display !== 'none') throw Error('整页模式仍显示智能返回顶部');
    if (getComputedStyle(state.root.querySelector('.ld-drawer-go-bottom')).display !== 'none') throw Error('整页模式仍显示最新回复按钮');
    state.root.classList.remove('ld-drawer-iframe-mode');
    return '智能返回顶部及整页模式隐藏：通过';
  })()`).trim());
  console.log(evaluate(`(() => {
    const state = window.previewTest.state;
    const foreground = new AbortController();
    const prefetch = new AbortController();
    state.abortController = foreground;
    state.prefetchRequests.set("test-pending", { controller: prefetch });
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    if (!foreground.signal.aborted || !prefetch.signal.aborted || !state.previewPageHidden) throw Error("页面离开未取消请求");
    state.prefetchRequests.delete("test-pending");
    window.dispatchEvent(new PageTransitionEvent("pageshow"));
    if (state.previewPageHidden) throw Error("页面恢复仍暂停");
    return "页面挂起与恢复：通过";
  })()`).trim());
  console.log(evaluate(`(() => {
    const { state, buildPostCard, initializePostCarousels } = window.previewTest;
    const img = '<img width="160" height="90" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="测试图片">';
    const images = '<p><span class="lightbox-wrapper"><a class="lightbox" href="https://linux.do/test-image.png">' + img + '</a></span><a href="https://linux.do/test-image.png">' + img + '</a></p>' + img;
    const card = buildPostCard({ post_number: 1, cooked: '<div class="d-image-grid" data-mode="carousel">' + images + '</div><div class="d-image-grid" data-mode="carousel">' + img + '</div><div class="d-image-grid" data-mode="grid">' + images + '</div><div class="d-image-grid" data-mode="carousel"></div>' });
    state.drawerBody.replaceChildren(card);
    const grids = card.querySelectorAll('.d-image-grid');
    const grid = grids[0];
    const check = index => {
      const slides = [...grid.querySelectorAll('.ld-carousel-slide')];
      if (slides.length !== 3 || slides.some((slide, i) => (getComputedStyle(slide).display !== 'none') !== (i === index))) throw Error('轮播图片显隐错误');
      if (grid.querySelectorAll('[aria-pressed="true"]').length !== 1 || grid.querySelectorAll('[aria-pressed]')[index].getAttribute('aria-pressed') !== 'true') throw Error('圆点状态错误');
    };
    check(0);
    grid.querySelector('[aria-label="上一张图片"]').click(); check(2);
    grid.querySelector('[aria-label="下一张图片"]').click(); check(0);
    grid.querySelectorAll('[aria-pressed]')[1].click(); check(1);
    grid.querySelector('button').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })); check(2);
    initializePostCarousels(card); check(2);
    if (!grids[1].querySelector('.ld-carousel-controls').hidden || grids[2].querySelector('.ld-carousel-controls') || grids[3].children.length) throw Error('单图、普通网格或空轮播错误');
    grid.querySelector('.ld-carousel-slide:not([hidden]) img').click();
    if (state.imagePreview.hidden) throw Error('轮播图片放大失效');
    state.imagePreview.click();
    if (!state.imagePreview.hidden) throw Error('图片预览不能关闭');
    if (grid.querySelector('a').rel !== 'noopener noreferrer') throw Error('图片链接安全属性丢失');
    return '轮播显隐、循环、圆点、键盘、多轮播隔离、重复初始化和图片放大：通过';
  })()`).trim());
  console.log(evaluate(`(async () => {
    const { state, buildPostCard } = window.previewTest;
    state.availableReactions = ['heart', '+1', 'clap'].map(id => ({ id }));
    const post = { id: 987, post_number: 2, reads: 54321, reply_count: 5,
      reactions: [{id:'heart',count:2},{id:'+1',count:1},{id:'clap',count:1}], reaction_users_count: 4,
      current_user_reaction: { id:'heart', can_undo:true }, actions_summary:[{id:2,acted:true,count:2}],
      cooked:'<pre><code>' + 'long_code_'.repeat(500) + '</code></pre>' };
    const replyDisplayBefore = state.settings.replyDisplay;
    state.settings.replyDisplay = 'legacy';
    const card = buildPostCard(post);
    state.settings.replyDisplay = replyDisplayBefore;
    const view = document.createElement('div'); view.className = 'ld-topic-view'; view.append(card);
    state.drawerBody.replaceChildren(view);
    const reaction = card.querySelector('.ld-post-react-btn');
    const settleReaction = async () => {
      for (let i = 0; reaction.disabled && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10));
    };
    const actions = card.querySelector('.ld-post-actions');
    if (card.querySelector('.ld-post-infos') || actions.textContent.includes('54321') || card.querySelectorAll('.ld-post-react-btn').length !== 1 || reaction.querySelectorAll('img').length !== 3) throw Error('统计行没有合并或点赞图标重复');
    if (!actions.querySelector('.ld-post-replies-stat-wrap') || actions.querySelector('.ld-post-actions-divider').textContent !== '|') throw Error('回复数或分隔符丢失');
    const fetchBefore = window.fetch;
    const calls = [];
    let fail = false;
    let legacy = false;
    window.fetch = async (url, options) => {
      calls.push({url,options});
      if (fail) return new Response(JSON.stringify({errors:['测试拒绝']}), {status:403});
      if (legacy) return new Response('{}', {status:String(url).includes('/discourse-reactions/') ? 404 : 200});
      const undo = String(url).includes('/clap/') && post.current_user_reaction?.id === 'clap';
      return new Response(JSON.stringify({ reactions: undo ? [{id:'heart',count:1},{id:'+1',count:1},{id:'clap',count:1}] : [{id:'heart',count:1},{id:'+1',count:1},{id:'clap',count:2}],
        reaction_users_count: undo ? 3 : 4, current_user_reaction: undo ? null : {id:'clap',can_undo:true} }));
    };
    try {
      reaction.click(); await new Promise(resolve => setTimeout(resolve, 0));
      if (calls.length || reaction.getAttribute('aria-expanded') !== 'true') throw Error('打开选择器就提交了反应');
      const dormantDialog = document.createElement('div'); dormantDialog.className = 'dialog-container'; dormantDialog.hidden = true;
      document.body.append(dormantDialog);
      document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true,cancelable:true}));
      if (reaction.getAttribute('aria-expanded') !== 'false') throw Error('隐藏原站弹层阻止 Escape');
      dormantDialog.remove();
      reaction.click(); await new Promise(resolve => setTimeout(resolve, 0));
      if (card.querySelector('.ld-reaction-btn[title="heart"]').getAttribute('aria-pressed') !== 'true') throw Error('未识别原站已选反应');
      card.querySelector('.ld-reaction-btn[title="clap"]').click(); await settleReaction();
      if (calls.length !== 1 || post.current_user_reaction.id !== 'clap' || reaction.textContent !== '4' || calls[0].options.method !== 'PUT') throw Error('切换反应未同步服务器状态：' + JSON.stringify({calls:calls.map(c=>c.url),current:post.current_user_reaction,text:reaction.textContent,toast:state.toastStack.textContent}));
      reaction.click(); await new Promise(resolve => setTimeout(resolve, 0));
      card.querySelector('.ld-reaction-btn[title="clap"]').click(); await settleReaction();
      if (post.current_user_reaction || reaction.textContent !== '3' || reaction.classList.contains('ld-post-react-btn--reacted')) throw Error('取消反应错误');
      fail = true;
      reaction.click(); await new Promise(resolve => setTimeout(resolve, 0));
      card.querySelector('.ld-reaction-btn[title="heart"]').click(); await settleReaction();
      if (calls.length !== 3 || reaction.textContent !== '3' || reaction.disabled) throw Error('权限失败后重试其他写接口或状态未恢复');
      fail = false; legacy = true;
      post.reactions = []; post.current_user_reaction = null; post.like_count = 3;
      post.actions_summary[0].acted = false; post.actions_summary[0].count = 3;
      for (const method of ['POST', 'DELETE']) {
        reaction.click(); await new Promise(resolve => setTimeout(resolve, 0));
        card.querySelector('.ld-reaction-btn[title="heart"]').click(); await settleReaction();
        if (calls.at(-1).options.method !== method || reaction.textContent !== (method === 'POST' ? '4' : '3')) throw Error('旧点赞接口增减方向或计数错误');
      }
    } finally { window.fetch = fetchBefore; }
    const originalWidth = state.root.style.width;
    state.root.style.width = '320px';
    for (const native of [false, true]) {
      card.querySelector('.ld-post-body').classList.toggle('ld-native-body', native);
      const pre = card.querySelector('pre'); pre.scrollLeft = 100;
      if (pre.scrollLeft !== 100 || card.scrollWidth > card.clientWidth + 1) throw Error('长代码撑宽楼层或不能横滚');
      const button = card.querySelector('.ld-post-reply-button').getBoundingClientRect();
      if (button.right > state.root.getBoundingClientRect().right) throw Error('回复按钮超出抽屉');
      const groups = [...actions.children].map(n => n.getBoundingClientRect());
      if (Math.max(...groups.map(r => r.top)) - Math.min(...groups.map(r => r.top)) > 10) throw Error('320px 操作栏未保持一排');
    }
    state.root.style.width = originalWidth;
    return '单排操作、表情展示/选择/切换/取消/失败恢复、320px 原生与回退代码横滚：通过';
  })()`).trim());
  evaluate(`(async () => {
    const {state, buildPostCard, REACTION_URL_CACHE} = previewTest;
    const ids = ['heart','+1','laughing','open_mouth','clap','confetti_ball','hugs','roll_eyes','sob','cat'];
    const emoji = ['❤️','👍','😆','😮','👏','🎊','🤗','🙄','😭','😺'];
    const images = ${JSON.stringify(reactionImages)};
    ids.forEach((id,i) => {
      REACTION_URL_CACHE[id] = images[id] || 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><text x="16" y="26" text-anchor="middle" font-size="28">' + emoji[i] + '</text></svg>');
    });
    state.availableReactions = ids.map(id => ({id}));
    const post = {id:987, post_number:1, username:'reaction-user', name:'表情选择布局',
      cooked:'<p style="height:180px">点击楼层下方表情汇总，选择想要的回应。</p>',
      reactions:[{id:'heart',count:3},{id:'open_mouth',count:1},{id:'roll_eyes',count:3}],
      current_user_reaction:{id:'cat',can_undo:true},actions_summary:[]};
    const card = buildPostCard(post);
    const view = document.createElement('div'); view.className='ld-topic-view'; view.append(card);
    state.drawerBody.replaceChildren(view); state.drawerBody.scrollTop=0;
    card.querySelector('.ld-post-react-btn').click();
    await new Promise(resolve => setTimeout(resolve,0));
    const siteStyle=document.createElement('style');
    siteStyle.textContent='button {width:280px;min-width:150px;margin:10px;font-size:20px}';
    document.head.prepend(siteStyle);
    window.reactionLayoutTest={card,siteStyle};
    state.toastStack.replaceChildren();
  })()`);
  for (const width of [1280,390,320]) {
    run(['set','viewport',String(width),'800']);
    evaluate('document.head.prepend(reactionLayoutTest.siteStyle)');
    console.log(evaluate(`(() => {
      const card=reactionLayoutTest.card;
      const panel=card.querySelector('.ld-reactions-popover');
      const buttons=[...panel.querySelectorAll('.ld-reaction-btn')];
      const rect=panel.getBoundingClientRect();
      const root=previewTest.state.root.getBoundingClientRect();
      if (buttons.length!==10 || buttons.some(button => !button.getClientRects().length)) throw Error('表情选项缺失');
      const rows=new Map();
      for (const button of buttons) {
        const box=button.getBoundingClientRect();
        const top=Math.round(box.top);
        rows.set(top,(rows.get(top)||0)+1);
        if (box.width<40 || box.height<44) throw Error('表情触控区域过小');
      }
      if (rows.size!==2 || [...rows.values()].some(count=>count!==5)) throw Error('表情没有排成五列两行');
      if (rect.left<root.left || rect.right>root.right+1 || panel.scrollWidth>panel.clientWidth) throw Error('表情面板超出抽屉');
      if (!card.querySelector('.ld-reaction-btn[title="cat"][aria-pressed="true"]') || card.querySelector('.ld-reaction-btn[title="heart"] .ld-reaction-btn-count').textContent!=='3') throw Error('已选状态或数量丢失');
      return '表情五列两行、触控区域、原站按钮样式隔离与抽屉边界：通过（${width}px）';
    })()`).trim());
    evaluate('reactionLayoutTest.siteStyle.remove()');
    if (process.env.SIDEPEEK_SCREENSHOT_DIR) run(['screenshot',path.join(process.env.SIDEPEEK_SCREENSHOT_DIR,`reactions-${width}.png`)]);
  }
  evaluate("document.documentElement.style.cssText='--primary:#e2e8f0;--secondary:#17212b;--primary-low:#334155;--primary-medium:#94a3b8;--tertiary:#60a5fa;--love:#ef7187'; document.body.style.background='#17212b'");
  run(['wait','--fn',"getComputedStyle(document.querySelector('.ld-reaction-btn-count')).color==='rgb(148, 163, 184)'"]);
  if (process.env.SIDEPEEK_SCREENSHOT_DIR) run(['screenshot',path.join(process.env.SIDEPEEK_SCREENSHOT_DIR,'reactions-dark.png')]);
  evaluate("reactionLayoutTest.siteStyle.remove(); document.documentElement.style.cssText=''; document.body.style.background=''");
  run(['set','viewport','1280','720']);
  console.log(evaluate(`(async () => {
    const s = previewTest.state, makeCard = previewTest.buildPostCard;
    const before = { fetch: window.fetch, confirm: window.confirm, topic:s.currentTopic, content:s.content,
      children:[...s.drawerBody.childNodes], url:s.currentUrl, direct:s.directReplyCache, parents:s.replyParentCache };
    const post = {id:101, post_number:1, username:'me', yours:true, can_edit:true, cooked:'<p>旧正文</p>'};
    const child = {...post,id:102,post_number:2,reply_to_post_number:1};
    const calls = [], json = (data,status=200) => new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
    let fail = false, denied = false, malformed = false, pending = null, delay = false;
    const settle = () => new Promise(resolve => setTimeout(resolve,20));
    const wait = async () => {for(let i=0;s.isReplySubmitting && i<100;i++) await settle();if(s.isReplySubmitting) throw Error('编辑请求未结束');};
    try {
      s.currentTopic={id:1, title:'编辑固定主题',posts_count:2,post_stream:{posts:[post],stream:[101,102]}};
      s.currentUrl='/t/test/1';s.root.setAttribute('aria-hidden','false');
      s.content=document.createElement('div');s.content.className='ld-drawer-content';s.drawerBody.replaceChildren(s.content);
      const card=makeCard(post), childCard=makeCard(child,null,{ancestors:[1]});
      const thread=document.createElement('div');thread.className='ld-inline-thread';thread.append(childCard);card.append(thread);s.content.append(card);
      s.directReplyCache=new Map([[1,{posts:[child],pendingPosts:[]}]]);s.replyParentCache=new Map([[2,child]]);
      const cachedChild={...child};s.topicCache.set('edit-regression',{fetchedAt:Date.now(),cachedAt:Date.now(),topic:{post_stream:{posts:[cachedChild]}}});
      s.replyTextarea.value='未发送的回复草稿';s.replyTargetPostNumber=3;s.replyTargetLabel='#3 @other';
      window.fetch=async (input,options={})=>{
        const id=Number(new URL(input,location.href).pathname.match(/posts\\/(\\d+)\\.json/)?.[1]);
        if(!id) return before.fetch(input,options);
        calls.push({id,method:options.method,body:options.body?.toString(),signal:options.signal,credentials:options.credentials});
        if(delay) return new Promise(resolve=>pending={resolve,options});
        if(fail) return json({errors:['模拟保存失败']},403);
        const item=id===101?post:child;
        if(options.method==='PUT') return json(malformed?{}:{post:{...item,raw:new URLSearchParams(options.body).get('post[raw]'),cooked:'<p>已编辑 '+id+'</p>'}});
        return json({...item,raw:'  原文 Markdown  ',can_edit:!denied});
      };
      if(makeCard({...post,yours:false}).querySelector('.ld-post-edit-btn') || makeCard({...post,can_edit:false}).querySelector('.ld-post-edit-btn')) throw Error('越权显示编辑入口');
      card.querySelector('.ld-post-edit-btn').click();await wait();
      if(s.replyTextarea.value!=='  原文 Markdown  ' || s.replySubmitButton.textContent!=='保存修改' || s.replyPanelTitle.textContent!=='编辑第 1 楼') throw Error('未加载原文或仍使用发送回复入口');
      s.replyTextarea.value='  新正文  ';previewTest.renderIframeFallback(s.currentUrl,'',new Error('后台刷新失败'));
      if(!s.replyEdit || s.replyTextarea.value!=='  新正文  ' || s.root.classList.contains('ld-drawer-iframe-mode')) throw Error('后台刷新失败丢失修改或切入整页');
      fail=true;s.replySubmitButton.click();await wait();
      if(s.replyTextarea.value!=='  新正文  ' || !s.replyStatus.textContent.includes('模拟保存失败') || !s.replyEdit) throw Error('编辑失败丢失修改');
      const token=document.querySelector('meta[name="csrf-token"]');token.content='changed-session';const count=calls.length;
      s.replySubmitButton.click();await wait();
      if(calls.length!==count || !s.replyStatus.textContent.includes('登录状态已变化') || s.replyTextarea.value!=='  新正文  ') throw Error('账号变化后仍保存或丢失修改');
      token.content='test-csrf';fail=false;malformed=true;s.replySubmitButton.click();await wait();
      if(!s.replyEdit || !s.replyStatus.textContent.includes('无法确认是否保存成功')) throw Error('异常成功响应误报已保存');
      malformed=false;s.replySubmitButton.click();await wait();
      if(!s.replyPanel.hidden || s.replyEdit || s.replyTextarea.value!=='未发送的回复草稿' || s.replyTargetPostNumber!==3 || post.cooked!=='<p>已编辑 101</p>' || !card.textContent.includes('已编辑 101') || !thread.isConnected) throw Error('首帖更新、子树保留或草稿恢复失败');
      const writes=calls.filter(x=>x.method==='PUT');
      if(writes.length!==3 || writes.some(x=>new URLSearchParams(x.body).get('post[raw]')!=='  新正文  ' || x.credentials!=='include') || calls.some(x=>x.method==='POST') || s.currentTopic.posts_count!==2) throw Error('编辑请求内容错误或误发新回复');
      childCard.querySelector('.ld-post-edit-btn').click();await wait();s.replyTextarea.value='子楼修改';s.replySubmitButton.click();await wait();
      if(child.cooked!=='<p>已编辑 102</p>' || cachedChild.cooked!==child.cooked || !childCard.textContent.includes('已编辑 102')) throw Error('子楼或缓存未同步修改：'+JSON.stringify({child:child.cooked,cached:cachedChild.cooked,text:childCard.textContent,status:s.replyStatus.textContent,editing:s.replyEdit?.post.id,calls:calls.map(x=>[x.id,x.method])}));
      childCard.querySelector('.ld-post-edit-btn').click();await wait();s.replyTextarea.value='不能丢的修改';window.confirm=()=>false;
      s.replyCancelButton.click();document.querySelector('.ld-drawer-close').click();document.querySelector('#main-outlet a[href="/t/test/2"]').click();
      if(!s.replyEdit || s.replyPanel.hidden || s.root.getAttribute('aria-hidden')==='true' || s.currentUrl!=='/t/test/1') throw Error('拒绝放弃后仍关闭编辑、抽屉或切帖');
      window.confirm=()=>true;s.replyCancelButton.click();
      if(s.replyEdit || s.replyTextarea.value!=='未发送的回复草稿') throw Error('取消编辑未恢复回复草稿');
      denied=true;card.querySelector('.ld-post-edit-btn').click();await wait();
      if(!s.replySubmitButton.disabled || !s.replyStatus.textContent.includes('不可编辑')) throw Error('未复核最新编辑权限');
      s.replyCancelButton.click();denied=false;delay=true;
      card.querySelector('.ld-post-edit-btn').click();await settle();s.replyCancelButton.click();
      if(!pending.options.signal.aborted) throw Error('取消原文读取未取消请求');
      pending.resolve(json({...post,raw:'迟到的原文'}));await settle();
      if(s.replyEdit || s.replyTextarea.value!=='未发送的回复草稿') throw Error('迟到原文覆盖回复草稿');
      delay=false;
      const siteForm=document.createElement('style');siteForm.textContent='textarea {width:600px;min-width:500px;box-sizing:content-box} .ld-drawer-reply-panel button {width:240px;min-width:100px}';document.head.append(siteForm);
      window.showPostEditor=async()=>{s.toastStack.replaceChildren();s.replyTextarea.value='';childCard.querySelector('.ld-post-edit-btn').click();await wait();};
      window.finishPostEditor=()=>{window.confirm=()=>true;s.replyCancelButton.click();};
      window.restorePostEditorTest=()=>{
        siteForm.remove();window.fetch=before.fetch;window.confirm=before.confirm;s.currentTopic=before.topic;s.content=before.content;s.currentUrl=before.url;
        s.drawerBody.replaceChildren(...before.children);s.directReplyCache=before.direct;s.replyParentCache=before.parents;s.topicCache.delete('edit-regression');s.replyTextarea.value='';
      };
      return '编辑本人首帖/子楼：原文、权限、PUT 保存、错误保留、缓存同步、草稿保护及取消竞态：通过';
    } catch(error) {window.fetch=before.fetch;window.confirm=before.confirm;throw error;}
  })()`).trim());
  for(const width of [1280,390,320]) {
    run(['set','viewport',String(width),'720']);
    evaluate('showPostEditor()');
    console.log(evaluate(`(() => {
      const s=previewTest.state,p=s.replyPanel.getBoundingClientRect(),button=s.replySubmitButton.getBoundingClientRect(),input=s.replyTextarea.getBoundingClientRect();
      if(p.left<0 || p.right>innerWidth+1 || input.left<p.left || input.right>p.right-8 || button.bottom>innerHeight || button.width<40 || s.replySubmitButton.textContent!=='保存修改') throw Error('编辑面板关键操作不可见');
      return '编辑面板及保存入口可见：通过（${width}px）';
    })()`).trim());
    if(process.env.SIDEPEEK_SCREENSHOT_DIR) run(['screenshot',path.join(process.env.SIDEPEEK_SCREENSHOT_DIR,`post-editor-${width}.png`)]);
    evaluate('finishPostEditor()');
  }
  if(process.env.SIDEPEEK_SCREENSHOT_DIR) {
    evaluate('document.documentElement.style.cssText="--primary:#e5e7eb;--secondary:#1f2937;--primary-low:#374151;--primary-medium:#9ca3af;--tertiary:#60a5fa";showPostEditor()');
    run(['screenshot',path.join(process.env.SIDEPEEK_SCREENSHOT_DIR,'post-editor-dark.png')]);
    evaluate('finishPostEditor();document.documentElement.style.cssText=""');
  }
  evaluate('restorePostEditorTest()');
  run(['set','viewport','1280','720']);
  console.log(evaluate(`(async () => {
    ${nativeSource}
    const { state, buildPostCard } = window.previewTest;
    let destroyed = 0;
    let destroyedPosts = 0;
    let fail = false;
    let boostRecord;
    let userCardTrigger = null;
    const appEvents = { trigger: (...args) => { userCardTrigger = args; } };
    const store = { createRecord: () => { throw Error('原生桥不得复用共享缓存模型'); } };
    const nativeRecords=[];
    const createPost = data => {
      const record = { ...data, set(key,value){this[key]=value;}, destroy: () => {record.isDestroyed=true;destroyedPosts++;} };
      if (data.can_boost) boostRecord = record;
      nativeRecords.push(record);
      return record;
    };
    const modules = {
      "discourse/lib/get-owner": { getOwnerWithFallback: () => ({ lookup: name => name === "service:app-events" ? appEvents : store }) },
      "@ember/application": { getOwner: () => ({}), setOwner: () => {} },
      "@ember/component": { getComponentTemplate: () => ({}), default: { extend: () => ({ create: props => ({
        appendTo: () => {
          if (fail) throw Error('模拟原站初始化失败');
          for (const registration of props.renderGlimmer._registrations) {
            const node = document.createElement('div');
            node.className = registration.component.component.kind || 'cooked';
            node.textContent = '原站正文';
            registration.element.append(node);
          }
        }, destroy: () => destroyed++
      }) }) } },
      "@ember/runloop": { run: fn => fn() },
      "ember-curry-component": { default: (component, args) => ({component,args}) },
      "discourse/models/post": {default:{create:createPost}},
      "discourse/components/post/cooked-html": { default: {} },
      "discourse/components/render-glimmer-container": { default: {} }
    };
    const create = async () => {
      const card = buildPostCard({ id: 123, post_number: 1, cooked: '<p>回退正文</p>' });
      state.drawerBody.replaceChildren(card);
      await new Promise(resolve => setTimeout(resolve, 0));
      return card.querySelector('.ld-post-body');
    };
    const fallback = await create();
    if (fallback.classList.contains('ld-native-body') || !fallback.textContent.includes('回退正文')) throw Error('模块缺失没有回退');
    window.require = name => modules[name];
    const userCard = buildPostCard({ id: 122, post_number: 1, username: 'test-user', cooked: '<p>用户卡片</p>' });
    state.drawerBody.replaceChildren(userCard);
    const avatarLink = userCard.querySelector('.ld-post-avatar-link');
    if (avatarLink.dataset.userCard !== 'test-user' || !avatarLink.href.endsWith('/u/test-user')) throw Error('头像缺少原生用户卡片标记或资料链接');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    if (avatarLink.dispatchEvent(click) || userCardTrigger?.[0] !== 'topic-header:trigger-user-card' || userCardTrigger?.[1] !== 'test-user' || userCardTrigger?.[2] !== avatarLink) throw Error('头像点击未交给原站用户卡片');
    userCardTrigger = null;
    avatarLink.addEventListener('click', event => event.preventDefault());
    avatarLink.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true }));
    if (userCardTrigger) throw Error('修饰点击错误触发原站用户卡片');
    const cardOverlay = document.createElement('div'); cardOverlay.className = 'fk-d-menu'; document.body.append(cardOverlay);
    document.body.classList.add('ld-drawer-page-open');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    if (!document.body.classList.contains('ld-drawer-page-open')) throw Error('用户卡片显示时 Escape 错误关闭抽屉');
    cardOverlay.remove();
    const body = await create();
    if (!body.classList.contains('ld-native-body') || body.textContent !== '原站正文' || body.hasAttribute('data-ld-native-post')) throw Error('原站正文挂载失败');
    await create();
    if (destroyed !== 1 || destroyedPosts !== 1) throw Error('切帖未销毁组件和模型');
    state.root.setAttribute('aria-hidden', 'true');
    await new Promise(resolve => setTimeout(resolve, 0));
    if (destroyed !== 2 || destroyedPosts !== 2) throw Error('关闭未销毁组件和模型');
    state.root.setAttribute('aria-hidden', 'false');
    const reopened = await create();
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    if (reopened.classList.contains('ld-native-body') || destroyed !== 3 || destroyedPosts !== 3) throw Error('页面挂起未清理原站组件');
    window.dispatchEvent(new PageTransitionEvent('pageshow'));
    fail = true;
    const failed = await create();
    if (failed.classList.contains('ld-native-body') || failed.textContent !== '回退正文' || destroyed !== 4 || destroyedPosts !== 4) throw Error('初始化失败未回退或释放');
    fail = false;
    modules['discourse/plugins/discourse-boosts/discourse/components/boost-action-button'] = { default: { kind:'boost', shouldRender: ({post}) => post.can_boost && !post.boosts?.length } };
    modules['discourse/plugins/discourse-boosts/discourse/components/boosts-list'] = { default: { kind:'discourse-boosts' } };
    const boostPost = { id:456, post_number:2, cooked:'<p>正文</p>', can_boost:true, boosts:[] };
    const boostCard = buildPostCard(boostPost);
    state.drawerBody.replaceChildren(boostCard);
    await new Promise(resolve => setTimeout(resolve, 0));
    const boostTarget = boostCard.querySelector('.ld-post-boosts');
    if (!boostTarget.querySelector('.boost') || !boostTarget.querySelector('.discourse-boosts') || !boostCard.querySelector('.ld-native-body')) throw Error('Boost 与正文未独立挂载');
    boostRecord.boosts = [{id:1,cooked:'<p>支持</p>'}]; boostRecord.can_boost = false;
    boostTarget.append(document.createElement('span'));
    await new Promise(resolve => setTimeout(resolve, 0));
    if (boostPost.can_boost || boostPost.boosts.length !== 1) throw Error('原站 Boost 状态未同步到内存帖子');
    const childPost={id:457,post_number:3,cooked:'<p>子回复</p>',can_boost:true,boosts:[]};
    const childCard=buildPostCard(childPost,null,{ancestors:[2]});
    const thread=document.createElement('div');thread.className='ld-inline-thread';thread.append(childCard);boostCard.append(thread);
    await new Promise(resolve=>setTimeout(resolve,0));
    const childBoost=childCard.querySelector(':scope > .ld-post-boosts');
    if (!childBoost.querySelector('.boost') || !childBoost.querySelector('.discourse-boosts') || boostRecord.id!==457) throw Error('子回复 Boost 未挂载或使用父楼数据');
    if (!(boostTarget.compareDocumentPosition(thread) & Node.DOCUMENT_POSITION_FOLLOWING)) throw Error('父楼 Boost 位于子树之后');
    const beforeClose = destroyed;
    state.root.setAttribute('aria-hidden', 'true');
    await new Promise(resolve => setTimeout(resolve, 0));
    if (destroyed !== beforeClose + 4 || boostTarget.children.length || childBoost.children.length || boostCard.querySelector('.ld-native-body')) throw Error('关闭未释放 Boost 和正文');
    state.root.setAttribute('aria-hidden','false');
    const editedPost={id:778,post_number:2,cooked:'<p>编辑前</p>'};
    const editedCard=buildPostCard(editedPost);state.drawerBody.replaceChildren(editedCard);await new Promise(resolve=>setTimeout(resolve,0));
    const oldRecord=nativeRecords.at(-1);state.replyEdit={post:editedPost};
    previewTest.syncEditedPost({id:778,cooked:'<p>编辑后</p>'});await new Promise(resolve=>setTimeout(resolve,0));state.replyEdit=null;
    if(!oldRecord.isDestroyed || nativeRecords.at(-1)===oldRecord || nativeRecords.at(-1).isDestroyed || nativeRecords.at(-1).cooked!=='<p>编辑后</p>' || !editedCard.querySelector('.ld-native-body')) throw Error('编辑后正文模型被旧组件销毁或未重新挂载');
    const FlagModal={}, PostFlag=class {}, wait=()=>new Promise(resolve=>setTimeout(resolve,0));
    let shown=0,closed=0,rejectModal=false,delayModal=false;
    const modal={opts:null,resolve:null,show:async function(component,options) {
      if(rejectModal) throw Error('模拟弹窗初始化失败');
      if(delayModal) await new Promise(resolve=>this.start=resolve);
      this.opts=options;this.component=component;shown++;
      const node=document.createElement('div');node.className='d-modal';document.body.append(node);this.node=node;
      return new Promise(resolve=>this.resolve=resolve);
    },close:function(){closed++;this.node?.remove();this.opts=null;this.resolve?.();}};
    modules['discourse/components/modal/flag']={default:FlagModal};
    modules['discourse/lib/flag-targets/post-flag']={default:PostFlag};
    modules['discourse/lib/get-owner']={getOwnerWithFallback:()=>({lookup:name=>({'service:current-user':{id:1},'service:modal':modal,'service:store':store})[name]})};
    const flagCard=buildPostCard({id:789,post_number:2,username:'other',cooked:'<p>举报对象</p>',actions_summary:[{id:3,can_act:true},{id:4,can_act:true},{id:8,can_act:true}]});
    state.drawerBody.replaceChildren(flagCard);await wait();
    const flagButton=flagCard.querySelector('.ld-post-icon-btn--flag');
    const showModal=modal.show;modal.show=()=>undefined;state.toastStack.replaceChildren();flagButton.click();await wait();
    if(!state.toastStack.textContent.includes('原站举报弹窗暂不可用')) throw Error('不兼容的弹窗接口没有回退提示');modal.show=showModal;
    const fetchBefore=window.fetch;let flagWrites=0;window.fetch=async(...args)=>{flagWrites++;return fetchBefore(...args);};
    flagButton.click();flagButton.click();await wait();
    if(shown!==1 || modal.component!==FlagModal || !(modal.opts.model.flagTarget instanceof PostFlag) || modal.opts.model.flagModel.id!==789 || modal.opts.model.flagModel.actions_summary.length!==3 || flagCard.querySelector('.ld-flag-popover') || flagButton.hasAttribute('data-ld-native-post') || flagWrites) throw Error('未使用完整原站弹窗、重复打开或擅自提交举报');
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    if(state.root.getAttribute('aria-hidden')==='true') throw Error('举报弹窗内 Esc 误关抽屉');
    modal.close();await wait();
    flagButton.click();await wait();const count=closed;flagCard.remove();await wait();
    if(closed!==count+1 || modal.opts) throw Error('切帖未关闭旧举报弹窗');
    state.drawerBody.append(flagCard);flagButton.click();await wait();state.root.setAttribute('aria-hidden','true');await wait();
    if(modal.opts) throw Error('关闭抽屉未清理举报弹窗');
    state.root.setAttribute('aria-hidden','false');await wait();rejectModal=true;flagButton.click();await wait();
    if(!state.toastStack.textContent.includes('原站举报弹窗暂不可用')) throw Error('原站弹窗失败无回退提示');
    rejectModal=false;delayModal=true;flagButton.click();await wait();flagCard.remove();modal.start();await wait();await wait();
    if(modal.opts) throw Error('切帖后异步挂载出旧举报弹窗');
    delayModal=false;state.drawerBody.append(flagCard);flagButton.click();await wait();
    const otherModal={model:{other:true}},beforeOther=closed;modal.opts=otherModal;flagCard.remove();await wait();
    if(closed!==beforeOther || modal.opts!==otherModal) throw Error('切帖误关了原站其它弹窗');
    modal.node.remove();modal.resolve();modal.opts=null;await wait();
    state.drawerBody.append(flagCard);flagButton.click();await wait();window.dispatchEvent(new PageTransitionEvent('pagehide'));await wait();
    if(modal.opts) throw Error('pagehide 未关闭原站举报弹窗');
    window.dispatchEvent(new PageTransitionEvent('pageshow'));window.fetch=fetchBefore;
    const foreign=document.createElement('button');foreign.className='ld-post-icon-btn--flag';foreign.setAttribute('data-ld-native-post','{"id":789}');document.body.append(foreign);
    if(!foreign.dispatchEvent(new Event('ld-open-native-flag',{bubbles:true,cancelable:true}))) throw Error('接管了抽屉外举报请求');foreign.remove();
    delete window.require;
    return '原站用户卡片、正文/Boost 与举报桥：挂载、原生弹窗、重复/异步窗口、回退和销毁：通过';
  })()`).trim());
  evaluate(`(() => {
    const wrap = document.createElement('div');
    wrap.className = 'd-header-wrap';
    wrap.style.cssText = 'position:fixed;top:0;left:0;right:0;height:52px';
    wrap.innerHTML = '<header class="d-header" style="height:52px;background:white"><div class="wrap" style="height:100%;display:flex;align-items:center"><button class="btn-sidebar-toggle">边栏</button><span>LINUX DO</span><div class="panel" style="margin-left:auto"><button class="header-menu-trigger">原站菜单</button><div class="menu-panel" hidden style="position:absolute;top:52px;right:12px;width:260px;height:160px;background:white">菜单</div></div></div></header>';
    document.body.prepend(wrap);
    document.querySelector('.header-menu-trigger').onclick = () => { document.querySelector('.menu-panel').hidden = false; };
    window.previewTest.state.settings.drawerMode = 'overlay';
    document.body.classList.add('ld-drawer-page-open', 'ld-drawer-mode-overlay');
    window.previewTest.state.root.setAttribute('aria-hidden', 'false');
  })()`);
  for (const width of [1280, 800, 390]) {
    run(['set', 'viewport', String(width), '800']);
    run(['wait', '--fn', 'document.body.classList.contains("ld-native-header-layout")']);
    console.log(evaluate(`(() => {
      const top = document.querySelector('.ld-drawer-header-top').getBoundingClientRect();
      const shell = document.querySelector('.ld-drawer-shell').getBoundingClientRect();
      const panel = document.querySelector('.d-header .panel').getBoundingClientRect();
      if (document.querySelector('.ld-drawer-eyebrow') || Math.abs(shell.top - top.bottom) > 1) throw Error('多余标题或正文未紧接工具栏');
      if (${width} > 720) {
        if (panel.right > top.left || top.left <= shell.left) throw Error('原站入口与工具栏重叠或缺口消失');
        const hit = document.elementFromPoint(panel.left + 5, panel.top + 5);
        if (!hit.closest('.panel')) throw Error('缺口被遮罩拦截');
        document.querySelector('.header-menu-trigger').click();
        const menu = document.querySelector('.menu-panel'), r = menu.getBoundingClientRect();
        if (menu.hidden || !menu.contains(document.elementFromPoint(r.left + 10, r.top + 10)) || !document.body.classList.contains('ld-drawer-page-open')) throw Error('原站菜单被遮挡或点击关闭抽屉');
        menu.hidden = true;
      } else if (top.width > innerWidth || shell.width > innerWidth) throw Error('窄屏溢出');
      return '顶栏缺口、原站菜单命中与响应式：通过（${width}px）';
    })()`).trim());
  }
  run(['set', 'viewport', '1280', '800']);
  run(['click', '.ld-drawer-close']);
  console.log(evaluate(`(() => {
    const r = document.querySelector('.d-header .panel').getBoundingClientRect();
    if (document.body.classList.contains('ld-drawer-page-open') || Math.abs(document.documentElement.clientWidth - r.right - 12) > 1) throw Error('收起后原站入口未回右侧');
    return '关闭抽屉后原站顶栏恢复：通过';
  })()`).trim());
  console.log(evaluate(`(() => {
    const menu = document.querySelector('.menu-panel');
    menu.classList.add('user-menu');
    const trigger = document.querySelector('.header-menu-trigger');
    trigger.parentElement.classList.add('current-user');
    trigger.onclick = () => { menu.hidden = !menu.hidden; };
    const s = window.previewTest.state;
    for (const [index, label] of ['通知', '回复', '点赞'].entries()) {
      menu.hidden = false;
      const link = document.createElement('a');
      link.href = '/t/test/' + (index + 1) + '/2';
      link.innerHTML = '<span>' + label + '</span>';
      menu.replaceChildren(link);
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
      link.firstChild.dispatchEvent(event);
      if (!event.defaultPrevented || !menu.hidden || !document.body.classList.contains('ld-drawer-page-open') || s.currentUrl !== link.href) throw Error(label + '未进入抽屉或丢失楼层路径');
    }
    for (const [href, attrs, options] of [
      ['/u/test/notifications', {}, {}], ['/u/test', {}, {}], ['https://example.com/t/1', {}, {}],
      ['/t/test/1', {target:'_blank'}, {}], ['/t/test/1', {download:''}, {}],
      ['/t/test/1', {}, {ctrlKey:true}], ['/t/test/1', {}, {metaKey:true}], ['/t/test/1', {}, {button:1}]
    ]) {
      menu.hidden = false;
      const link = document.createElement('a'); link.href = href;
      for (const [key, value] of Object.entries(attrs)) link.setAttribute(key, value);
      menu.replaceChildren(link);
      let reached = false;
      link.addEventListener('click', event => { reached = !event.defaultPrevented; event.preventDefault(); });
      link.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, button:0, ...options}));
      if (!reached || menu.hidden) throw Error('非帖子链接或原生新标签操作被接管');
    }
    menu.hidden = true;
    return '头像菜单通知/回复/点赞预览、楼层路径、自动收起与非帖子链接放行：通过';
  })()`).trim());
  console.log(evaluate(`(() => {
    const container = document.createElement('div');
    document.body.append(container);
    for (const className of ['search-menu welcome-banner__search-menu', 'search-menu', 'search-results']) {
      container.className = className;
      container.innerHTML = '<div class="' + (className === 'search-results' ? 'fps-result' : 'menu-panel search-menu-panel') + '"><a class="search-link" href="/t/test/2/3"><span>搜索帖子</span></a></div>';
      const link = container.querySelector('a');
      const panel = container.firstChild;
      const input = document.createElement('input'); input.className = 'search-term__input'; input.value = '搜索词';
      if (className !== 'search-results') {
        container.append(input);
        input.onkeydown = event => { if (event.key === 'Escape') { panel.hidden = true; event.preventDefault(); } };
        input.onfocus = () => { panel.hidden = false; };
      }
      const event = new MouseEvent('click', {bubbles:true, cancelable:true, button:0});
      link.firstChild.dispatchEvent(event);
      if (!event.defaultPrevented || window.previewTest.state.currentUrl !== link.href || !document.body.classList.contains('ld-drawer-page-open')) throw Error(className + '搜索结果未进入抽屉');
      if (className !== 'search-results') {
        if (!panel.hidden || input.value !== '搜索词') throw Error('搜索下拉框未收起或搜索词丢失');
        input.focus();
        if (panel.hidden) throw Error('搜索下拉框无法重新展开');
      } else if (panel.hidden) throw Error('独立搜索页列表不应收起');
      // 完整搜索页仍遵循悬浮遮罩的点击关闭行为；收起后检查原生链接放行。
      document.querySelector('.ld-drawer-close').click();
      for (const [href, attrs, options] of [
        ['/u/test', {}, {}], ['/tag/test', {}, {}], ['/search?q=test', {}, {}], ['https://example.com/t/2', {}, {}],
        ['/t/test/2', {target:'_blank'}, {}], ['/t/test/2', {download:''}, {}],
        ['/t/test/2', {}, {ctrlKey:true}], ['/t/test/2', {}, {metaKey:true}], ['/t/test/2', {}, {button:1}]
      ]) {
        const other = document.createElement('a'); other.className = 'search-link'; other.href = href;
        for (const [key, value] of Object.entries(attrs)) other.setAttribute(key, value);
        container.firstChild.replaceChildren(other);
        let reached = false;
        other.addEventListener('click', event => { reached = !event.defaultPrevented; event.preventDefault(); });
        other.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, button:0, ...options}));
        if (!reached) throw Error(className + '非帖子或新标签操作被接管');
      }
    }
    container.remove();
    return '首页/顶栏搜索下拉框、完整搜索页的帖子预览及非帖子操作放行：通过';
  })()`).trim());
  console.log(evaluate(`(async () => {
    const s = window.previewTest.state;
    s.drawerBody.replaceChildren(s.content);
    s.root.setAttribute('aria-hidden','false');document.body.classList.add('ld-drawer-page-open');
    s.settings.replyOrder = 'default'; s.authorFilter = 'all';
    s.currentUrl = 'https://linux.do/t/test/100/25'; s.currentTopicIdHint = 100;
    s.currentViewTracked = true;
    let total = 41;
    let emptyBatch = true;
    let delayBatch = false;
    let releaseBatch = null;
    let batchRequests = 0;
    const post = n => ({id:10000+n, post_number:n, username:'test-user', created_at:'2026-01-01T00:00:00Z',
      cooked:'<p style="height:100px">刷新回归正文 ' + n + '</p>', actions_summary:[]});
    window.fetch = async (input, options = {}) => {
      const url = new URL(input, location.href);
      const batch = url.pathname.endsWith('/posts.json');
      if (batch) batchRequests += 1;
      if (!batch && options.cache !== 'no-store') throw Error('刷新主题请求复用了 HTTP 缓存');
      if (batch && delayBatch) await new Promise(resolve => { releaseBatch = resolve; });
      const numbers = batch ? (emptyBatch ? [] : url.searchParams.getAll('post_ids[]').map(id => Number(id)-10000))
        : url.pathname.endsWith('/last.json') ? Array.from({length:20}, (_,i) => total-19+i)
        : url.pathname.endsWith('/25.json') ? Array.from({length:20}, (_,i) => i+16)
        : Array.from({length:20}, (_,i) => i+1);
      return new Response(JSON.stringify({id:100, title:'刷新回归', posts_count:total,
        post_stream:{posts:numbers.map(post), stream:Array.from({length:total}, (_,i) => i+10001)}}),
        {headers:{'content-type':'application/json'}});
    };
    await window.previewTest.loadTopic(s.currentUrl, '刷新回归', 100);
    if (s.currentResolvedTargetPostNumber !== 25 || s.content.querySelectorAll('.ld-post-card').length !== 35) throw Error('楼层定位窗口错误');
    if (s.content.textContent.includes('当前抽屉预览了')) throw Error('多余底部提示仍存在');
    total = 43;
    s.latestRepliesRefreshButton.click();
    while (s.isRefreshingLatestReplies) await new Promise(resolve => setTimeout(resolve, 10));
    if (s.currentTopic.posts_count !== 43 || s.currentResolvedTargetPostNumber !== 25) throw Error('刷新未更新帖子流或丢失定位');
    s.drawerBody.scrollTop = s.drawerBody.scrollHeight;
    s.drawerBody.dispatchEvent(new Event('scroll'));
    const errorDeadline = Date.now() + 5000;
    while (!s.loadMoreError && Date.now() < errorDeadline) await new Promise(resolve => setTimeout(resolve, 20));
    if (!s.loadMoreError || s.isLoadingMorePosts) throw Error('空分页响应导致加载状态卡死');
    emptyBatch = false;
    s.drawerBody.dispatchEvent(new Event('scroll'));
    const deadline = Date.now() + 5000;
    while (!s.content.querySelector('.ld-post-card[data-post-number="43"]') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    const numbers = Array.from(s.content.querySelectorAll('.ld-post-card'), node => Number(node.dataset.postNumber));
    if (numbers.length !== 43 || numbers.some((n,i) => n !== i+1)) throw Error('定位后分页未补齐新增回复或出现重复乱序');
    if (location.pathname !== '/latest' || s.currentUrl !== 'https://linux.do/t/test/100/25') throw Error('刷新分页改变页面或定位链接');
    total = 80;
    s.currentUrl = 'https://linux.do/t/test/100';
    await window.previewTest.loadTopic(s.currentUrl, '超长帖滚动回归', 100);
    delayBatch = true;
    s.drawerBody.scrollTop = s.drawerBody.scrollHeight - s.drawerBody.clientHeight - 100;
    s.drawerBody.dispatchEvent(new Event('scroll'));
    while (!releaseBatch) await new Promise(resolve => setTimeout(resolve, 10));
    s.drawerBody.scrollTop += 80;
    const continuedScrollTop = s.drawerBody.scrollTop;
    delayBatch = false;
    releaseBatch();
    while (s.isLoadingMorePosts) await new Promise(resolve => setTimeout(resolve, 10));
    if (s.drawerBody.scrollTop !== continuedScrollTop) throw Error('分页完成后回到了请求发出时的旧位置');
    const batchRequestsBeforeJump = batchRequests;
    s.bottomFabButton.click();
    const latestDeadline = Date.now() + 5000;
    while (s.currentResolvedTargetPostNumber !== 80 && Date.now() < latestDeadline) await new Promise(resolve => setTimeout(resolve, 20));
    if (!s.content.querySelector('.ld-post-card[data-post-number="80"]') || !s.currentUrl.endsWith('/100/last')) throw Error('向下按钮未定位到最新回复');
    if (batchRequests !== batchRequestsBeforeJump || s.isLoadingMorePosts) throw Error('最新回复定位错误加载全部中间楼层');
    return '定位刷新、空分页重试、超长帖滚动不回跳及最新回复定位：通过';
  })()`).trim());
  for (const width of [1280, 390]) {
    run(['set', 'viewport', String(width), '800']);
    console.log(evaluate(`(async () => {
      const s = window.previewTest.state;
      const previousFetch = window.fetch;
      const list = document.createElement('div');
      list.innerHTML = [201, 202].map(id => '<div class="topic-list-item"><a class="title" href="/t/overflow/' + id + '/1">溢出回归 ' + id + '</a></div>').join('');
      document.querySelector('#main-outlet').append(list);
      const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      window.fetch = async input => {
        const id = Number.parseInt(new URL(input, location.href).pathname.split('/')[3], 10);
        const posts = [1, 2].map(n => ({id:id * 100 + n, post_number:n, username:'test-user',
          cooked:'<p style="height:' + (id === 201 ? 80 : 1400) + 'px">高低正文</p>' +
            '<span style="position:absolute;top:6000px;height:100px;width:10px">定位内容</span>', actions_summary:[]}));
        return new Response(JSON.stringify({id, title:'溢出回归 ' + id, posts_count:2,
          post_stream:{posts, stream:posts.map(post => post.id)}}), {headers:{'content-type':'application/json'}});
      };
      try {
        s.drawerBody.replaceChildren(s.content);
        s.topicCache.clear();
        list.querySelector('a').click();
        for (let i = 0; i < 12; i++) {
          await frame();
          const expectedId = i % 2 ? 202 : 201;
          if (s.currentTopic?.id !== expectedId) throw Error('Alt 切帖未到达预期主题');
          if (s.replyPanelMain.scrollTop !== 0) throw Error('楼层定位滚动了正文外层');
          if (expectedId === 202) {
            s.bottomFabButton.click();
            if (s.drawerBody.scrollTop <= 0) throw Error('禁止外层滚动后正文无法定位末楼');
          }
          s.topFabButton.click();
          const first = s.content.querySelector('.ld-post-card');
          if (s.drawerBody.scrollTop !== 0 || s.replyPanelMain.scrollTop !== 0 ||
              first.getBoundingClientRect().top < s.header.getBoundingClientRect().bottom - 1) {
            throw Error('回顶后首帖仍被标题栏裁切');
          }
          if (i < 11) document.dispatchEvent(new KeyboardEvent('keydown', {
            key:i % 2 ? 'ArrowUp' : 'ArrowDown', altKey:true, bubbles:true, cancelable:true
          }));
        }
      } finally {
        window.fetch = previousFetch;
        list.remove();
      }
      return '正文定位元素溢出、长短帖 Alt 连续切换、末楼定位和回顶：通过（${width}px）';
    })()`).trim());
  }
  console.log(evaluate(`(async () => {
    const s = window.previewTest.state;
    const previousFetch = window.fetch, previousOpen = window.open;
    const requests = [];
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));
    const waitFor = async predicate => {
      const deadline = Date.now() + 5000;
      while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
      if (!predicate()) throw Error('帖内搜索检查等待超时');
    };
    let results = {posts:[
      {id:102, topic_id:1, post_number:2, username:'用户', blurb:'<b>匹配</b><img src="x" onerror="window.searchUnsafe=true">'},
      {id:199, topic_id:1, post_number:99, username:'用户', blurb:'尚未加载的回复'},
      {topic_id:2, post_number:3, blurb:'其他主题'}, {topic_id:1, post_number:-1}
    ], grouped_search_result:{more_full_page_results:true}};
    let failure = false, delayed = false, bodyMode = "";
    const bodyRequests = [];
    window.fetch = async (input, options = {}) => {
      const url = new URL(input, location.href);
      if (url.pathname === '/t/1/posts.json') {
        const request={options};bodyRequests.push(request);
        if(bodyMode==='delay') return new Promise(resolve=>{request.resolve=resolve;});
        if(bodyMode==='failure') return new Response('{}',{status:503,headers:{'content-type':'application/json'}});
        if(bodyMode==='missing') return new Response('{"post_stream":{"posts":[]}}',{headers:{'content-type':'application/json'}});
        const ids=url.searchParams.getAll('post_ids[]').map(Number);
        if (ids.length>20 || options.credentials!=='include' || !options.signal) throw Error('正文核对未分批或缺少凭据/取消信号');
        const posts=results.posts.filter(post=>ids.includes(post.id)).map(post=>({...post,
          cooked:post.cooked ?? '<p>匹配 &amp; 测试 a+b TEST 大量结果 '+post.blurb+'</p>'}));
        return new Response(JSON.stringify({post_stream:{posts}}),{headers:{'content-type':'application/json'}});
      }
      if (url.pathname !== '/search.json') {
        const id = Number(url.pathname.match(/\\/(?:test|topic)\\/(\\d+)/)?.[1]);
        if (!id) return previousFetch(input, options);
        const target = Number(url.pathname.match(/\\/(\\d+)\\.json$/)?.[1]);
        const posts = (target === 99 ? [99] : [1, 2, 3]).map(n => ({id:id * 100 + n, post_number:n, username:n === 99 ? 'other-user' : 'test-user',
          cooked:'<p style="height:700px">搜索定位正文 匹配 a+b TEST</p>', actions_summary:[]}));
        return new Response(JSON.stringify({id, title:'主题 ' + id, created_by:{username:'test-user'}, posts_count:4,
          post_stream:{posts, stream:[1,2,3,99].map(n => id * 100 + n)}}), {headers:{'content-type':'application/json'}});
      }
      const request = {url, options}; requests.push(request);
      if (delayed) return new Promise(resolve => { request.resolve = resolve; });
      return new Response(JSON.stringify(results), {status:failure ? 429 : 200});
    };
    const searchFetch = window.fetch;
    const submit = async query => {
      s.topicSearchInput.value = query;
      s.topicSearchPanel.querySelector('form').requestSubmit();
      if (!delayed) await waitFor(() => !s.topicSearchAbortController);
    };
    let opened;
    window.open = (...args) => { opened = args; };
    try {
      s.settings.previewMode = 'smart'; s.authorFilter = 'all';
      document.querySelector('#main-outlet a[href="/t/test/1"]').click();
      await window.previewTest.loadTopic(s.currentUrl, '搜索回归', 1);
      await waitFor(() => s.currentTopic?.id === 1 && !s.abortController);
      const findKey=(target,options={})=>{
        const event=new KeyboardEvent('keydown',{key:'f',ctrlKey:true,bubbles:true,cancelable:true,...options});
        target.dispatchEvent(event);return event;
      };
      const firstFind=findKey(document);
      if (!firstFind.defaultPrevented || s.topicSearchPanel.hidden || document.activeElement!==s.topicSearchInput) throw Error('Ctrl+F 未接管并聚焦帖内搜索');
      s.topicSearchInput.value='待替换关键词';
      const repeatFind=findKey(s.topicSearchInput,{ctrlKey:false,metaKey:true});
      if (!repeatFind.defaultPrevented || s.topicSearchPanel.hidden || s.topicSearchInput.value!=='待替换关键词' || s.topicSearchInput.selectionStart!==0 || s.topicSearchInput.selectionEnd!==s.topicSearchInput.value.length) throw Error('Cmd+F 或重复查找未保留并选中关键词');
      for(const options of [{altKey:true},{shiftKey:true},{ctrlKey:false},{isComposing:true}]) {
        if(findKey(document,options).defaultPrevented) throw Error('非查找组合键被拦截');
      }
      s.settingsToggle.click();
      if(findKey(document).defaultPrevented) throw Error('设置层中抢占查找');s.settingsPanel.querySelector(".ld-settings-close").click();
      if (!s.settingsPanel.hidden) throw Error("设置关闭按钮未生效");
      s.replyFabButton.click();
      if(findKey(s.replyTextarea).defaultPrevented) throw Error('回复输入中抢占查找');s.replyCancelButton.click();
      const overlay=document.createElement('div');overlay.className='d-modal';overlay.textContent='原站浮层';document.body.append(overlay);
      if(findKey(document).defaultPrevented) throw Error('原站浮层中抢占查找');overlay.remove();
      await submit('匹配 & 测试');
      const request = requests.at(-1);
      if (request.url.searchParams.get('q') !== '匹配 & 测试 topic:1' || request.url.searchParams.get('search_context[type]') !== 'topic' || request.url.searchParams.get('search_context[id]') !== '1' || request.options.credentials !== 'include') throw Error('搜索关键词、主题范围或凭据错误');
      if (s.topicSearchResults.children.length !== 2 || s.topicSearchResults.querySelector('b,img') || window.searchUnsafe) throw Error('搜索结果未限制主题/楼层或未安全输出：' + JSON.stringify({count:s.topicSearchResults.children.length, status:s.topicSearchStatus.textContent, unsafe:window.searchUnsafe}));
      s.topicSearchInput.value = '尚未提交的词';
      s.topicSearchPanel.querySelector('[data-search-page="next"]').click(); await waitFor(() => !s.topicSearchAbortController);
      if (requests.at(-1).url.searchParams.get('page') !== '2' || requests.at(-1).url.searchParams.get('q') !== '匹配 & 测试 topic:1') throw Error('分页未保持已提交关键词');
      s.topicSearchPanel.querySelector('[data-search-page="prev"]').click(); await waitFor(() => !s.topicSearchAbortController);
      if (s.topicSearchPage !== 1) throw Error('搜索上一页失效');
      s.authorFilter = 'topicOwner';
      const panelTop = s.topicSearchPanel.getBoundingClientRect().top;
      s.topicSearchResults.lastChild.click();
      await waitFor(() => !s.abortController && s.content.querySelector('[data-post-number="99"]'));
      await new Promise(requestAnimationFrame);
      if (s.topicSearchPanel.hidden || opened || s.topicSearchQuery !== '匹配 & 测试' || s.topicSearchInput.value !== '尚未提交的词' || s.topicSearchResults.children.length !== 2) throw Error('未加载楼层未在侧栏定位并保留搜索');
      if (Math.abs(s.topicSearchPanel.getBoundingClientRect().top - panelTop) > 1 || Math.abs(s.content.querySelector('[data-post-number="99"]').getBoundingClientRect().top - s.drawerBody.getBoundingClientRect().top) > 2) throw Error('搜索栏未固定或目标楼层未滚入视口');
      s.authorFilter = 'all';
      await submit('匹配');
      const highlights = () => [...CSS.highlights.get('ld-topic-search') || []];
      if (!highlights().some(r => s.topicSearchResults.contains(r.startContainer) && r.toString() === '匹配') || !highlights().some(r => s.content.contains(r.startContainer) && r.toString() === '匹配')) throw Error('摘要或正文关键词未高亮');
      let scrolled = false;
      s.content.querySelector('[data-post-number="2"]').scrollIntoView = () => { scrolled = true; };
      s.topicSearchResults.firstChild.click();
      if (!scrolled || s.topicSearchPanel.hidden) throw Error('已加载搜索结果未定位或搜索被关闭');
      await submit('a+b test');
      if (!highlights().some(r => r.toString() === 'a+b') || !highlights().some(r => r.toString() === 'TEST') || highlights().some(r => r.toString() === '匹配')) throw Error('特殊字符、大小写或旧高亮清理错误');
      const body = s.content.querySelector('.ld-post-body');
      body.replaceChildren(document.createTextNode('原站重绘 a+b'));
      await settle();
      if (!highlights().some(r => body.contains(r.startContainer) && r.toString() === 'a+b')) throw Error('原站重绘后高亮丢失');
      s.topicSearchPanel.querySelector('.ld-topic-search-close').click();
      if (!s.topicSearchPanel.hidden || CSS.highlights.has('ld-topic-search') || s.topicSearchHighlightObserver) throw Error('手动关闭未清理搜索高亮');
      s.topicSearchButton.click();
      results = {posts:Array.from({length:50}, (_,i) => ({id:100+i, topic_id:1, post_number:i+1, blurb:'较长的搜索结果摘要 '.repeat(30)})), grouped_search_result:{}};
      await submit('大量结果');
      const panel = s.topicSearchPanel.getBoundingClientRect(), main = s.replyPanelMain.getBoundingClientRect();
      const rows = s.topicSearchResults, pages = s.topicSearchPanel.querySelector('.ld-topic-search-pages').getBoundingClientRect();
      rows.scrollTop = rows.scrollHeight;
      if (panel.height > main.height * 0.4 + 1 || rows.scrollTop === 0 || pages.bottom > panel.bottom || s.drawerBody.clientHeight < 100) throw Error('大量搜索结果未限制高度或不能内部滚动：' + JSON.stringify({panel:panel.height,main:main.height,scroll:rows.scrollTop,pagesBottom:pages.bottom,panelBottom:panel.bottom,body:s.drawerBody.clientHeight}));
      results = {posts:[
        {id:123,topic_id:1,post_number:23,username:'user19',blurb:'图片回复',cooked:'<p>图片回复<img src="/690x419.png" alt="19" width="690" height="419"></p><div class="lightbox-wrapper"><div class="meta">690×419</div></div>'},
        {id:125,topic_id:1,post_number:25,blurb:'另一张图片',cooked:'<p><a href="/19">另一张图片</a><img height="195"><span hidden>19</span><script>19</script></p>'},
        {id:126,topic_id:1,post_number:26,blurb:'摘要被截断',cooked:'<p>'+ '前文'.repeat(200)+'正文包含 <strong>19</strong> 天</p>'},
        {id:127,topic_id:1,post_number:27,blurb:'代码与引用',cooked:'<blockquote>引用 19</blockquote><pre>const count = 19;</pre>'}
      ],grouped_search_result:{more_full_page_results:true}};
      const contentResults={...results,posts:[...results.posts]};
      await submit('19');
      if(s.topicSearchResults.children.length!==2 || !s.topicSearchResults.firstChild.textContent.startsWith('#26') || !s.topicSearchResults.textContent.includes('正文包含 19 天')) throw Error('图片尺寸/地址/隐藏文字误命中，或截断摘要漏掉真实正文');
      if(!highlights().some(r=>s.topicSearchResults.contains(r.startContainer) && r.toString()==='19')) throw Error('正文命中摘要未高亮');
      results.posts=results.posts.slice(0,2);await submit('19');
      if(s.topicSearchResults.children.length || !s.topicSearchStatus.textContent.includes('可继续下一页') || s.topicSearchPanel.querySelector('[data-search-page="next"]').hidden) throw Error('过滤空页误报全话题无结果或隐藏下一页');
      for(const mode of ['failure','missing']) {
        bodyMode=mode;await submit('19');
        if(!s.topicSearchStatus.textContent.includes('搜索失败') || s.topicSearchResults.children.length) throw Error('正文核对失败被当作无结果或仍展示未经核实的结果');
      }
      bodyMode='delay';s.topicSearchInput.value='19';s.topicSearchPanel.querySelector('form').requestSubmit();
      await waitFor(()=>bodyRequests.at(-1)?.resolve);
      const staleBody=bodyRequests.at(-1);bodyMode='';
      results={posts:[],grouped_search_result:{}};await submit('新查询');
      if(!staleBody.options.signal.aborted) throw Error('新搜索未取消正文核对请求');
      staleBody.resolve(new Response(JSON.stringify({post_stream:{posts:[]}}),{headers:{'content-type':'application/json'}}));await settle();
      if(s.topicSearchQuery!=='新查询' || s.topicSearchResults.children.length) throw Error('旧正文响应覆盖新搜索');
      results = {posts:[], grouped_search_result:{}}; await submit('空结果');
      if (!s.topicSearchStatus.textContent.includes('没有匹配')) throw Error('无结果提示错误');
      failure = true; await submit('请求失败');
      if (!s.topicSearchStatus.textContent.includes('搜索失败')) throw Error('搜索异常无提示');
      failure = false; delayed = true;
      await submit('旧搜索'); const stale = requests.at(-1);
      await submit('新搜索'); const latest = requests.at(-1);
      if (!stale.options.signal.aborted) throw Error('新搜索未取消旧请求');
      latest.resolve(new Response(JSON.stringify({posts:[], grouped_search_result:{}}))); await waitFor(() => !s.topicSearchAbortController);
      stale.resolve(new Response(JSON.stringify({posts:[{topic_id:1,post_number:1,blurb:'过期结果'}]}))); await settle();
      if (s.topicSearchResults.children.length || s.topicSearchQuery !== '新搜索') throw Error('旧响应覆盖新搜索');
      await submit('切帖中'); const switching = requests.at(-1);
      document.querySelector('#main-outlet a[href="/t/test/2"]').click(); await settle();
      if (!switching.options.signal.aborted || !s.topicSearchPanel.hidden || s.topicSearchInput.value) throw Error('切帖未清理搜索');
      switching.resolve(new Response(JSON.stringify(results))); await settle();
      s.topicSearchButton.click(); s.settingsToggle.click();
      if (s.topicSearchPanel.hidden || !s.topicSearchButton.hidden) throw Error('打开设置意外关闭搜索');
      s.settingsPanel.querySelector(".ld-settings-close").click();
      if (!s.settingsPanel.hidden) throw Error("设置关闭按钮未生效"); s.replyFabButton.click();
      if (s.topicSearchPanel.hidden || !s.topicSearchButton.hidden) throw Error('打开回复意外关闭搜索');
      s.replyCancelButton.click();
      await submit('关闭中'); const closing = requests.at(-1);
      document.querySelector('.ld-drawer-close').click();
      if (!closing.options.signal.aborted || !s.topicSearchPanel.hidden) throw Error('关闭抽屉未取消搜索');
      if(findKey(document).defaultPrevented) throw Error('抽屉关闭后仍抢占浏览器查找');
      closing.resolve(new Response(JSON.stringify(results))); await settle();
      window.showContentSearch=async()=>{
        const before=window.fetch;window.fetch=searchFetch;
        try {
          results=contentResults;failure=delayed=false;bodyMode='';s.authorFilter='all';
          document.querySelector('#main-outlet a[href="/t/test/1"]').click();
          await window.previewTest.loadTopic(s.currentUrl,'正文搜索',1);
          if(s.topicSearchPanel.hidden) s.topicSearchButton.click();
          await submit('19');
        } finally {window.fetch=before;}
      };
      return '帖内搜索常驻、分页、文本安全、高亮及重绘、侧栏楼层定位、空结果、失败及切帖/关闭竞态：通过';
    } finally {
      window.fetch = previousFetch; window.open = previousOpen;
    }
  })()`).trim());
  if (process.env.SIDEPEEK_SCREENSHOT_DIR) {
    evaluate('showContentSearch()');
    for(const width of [1280,390]) {
      run(['set','viewport',String(width),'800']);
      run(['screenshot',path.join(process.env.SIDEPEEK_SCREENSHOT_DIR,`content-search-${width}.png`)]);
    }
    evaluate('document.querySelector(".ld-drawer-close").click();delete window.showContentSearch');
  }
  console.log(evaluate(`(async () => {
    const s = previewTest.state;
    s.prefetchObserver.disconnect(); s.prefetchVisible.clear(); s.topicCache.clear();
    window.testFocus = false;
    window.cfFixture = { mode: 'challenge', requests: [], previousFetch: window.fetch };
    window.fetch = async (input, options = {}) => {
      const f = cfFixture;
      f.requests.push({ url: String(input), method: options.method || 'GET', signal: options.signal });
      if (options.method && options.method !== 'GET') throw Error('CF 恢复不应发送写入请求');
      if (f.mode === 'delay') return new Promise(resolve => { f.resolve = resolve; });
      if (f.mode === 'network') throw Error('固定网络失败');
      if (f.mode === 'challenge') return new Response('验证', {status:403,headers:{'cf-mitigated':'challenge','content-type':'text/html'}});
      if (f.mode === 'permission') return new Response('{"errors":["无权访问"]}', {status:403,headers:{'content-type':'application/json'}});
      return new Response(JSON.stringify(f.topic), {headers:{'content-type':'application/json'}});
    };
    const entry = document.querySelector('#main-outlet a');
    entry.href = '/t/test/4242'; entry.textContent = '网站验证恢复测试';
    cfFixture.topic = {id:4242,title:'验证后的主题',posts_count:1,post_stream:{posts:[{id:424201,post_number:1,username:'test-user',cooked:'<p>验证成功后恢复的正文</p>',actions_summary:[]}],stream:[424201]}};
    entry.click();
    await new Promise(resolve => setTimeout(resolve, 50));
    const notice = s.root.querySelector('.ld-cf-notice');
    if (!s.cfChallenge || notice.hidden || s.content.querySelector('iframe') || s.content.querySelector('.ld-loading-state')) throw Error('遇盾没有提示或仍在加载 iframe/骨架');
    const link = notice.querySelector('a');
    if(link.href !== 'https://linux.do/t/test/4242' || link.target !== '_blank' || link.rel !== 'noopener noreferrer') throw Error('验证外链错误');
    const count = cfFixture.requests.length;
    previewTest.runTopicPrefetch(); previewTest.loadVisibleInlineReplies();
    await previewTest.fetchPreviewResponse('/posts/424201/replies', {}).catch(() => {});
    if (cfFixture.requests.length !== count || s.root.querySelectorAll('.ld-cf-notice').length !== 1) throw Error('暂停后仍请求或提示重复');
    cfFixture.mode = 'permission';
    notice.querySelector('button').click(); notice.querySelector('button').click();
    await new Promise(resolve => setTimeout(resolve, 50));
    if (!s.cfChallenge || !notice.textContent.includes('暂未恢复访问') || cfFixture.requests.length !== count + 1) throw Error('失败恢复错误或重复点击未去重');
    for (const mode of ['challenge', 'network']) {
      cfFixture.mode = mode;
      const before = cfFixture.requests.length;
      notice.querySelector('button').click();
      await new Promise(resolve => setTimeout(resolve, 50));
      if (!s.cfChallenge || notice.querySelector('button').disabled || cfFixture.requests.length !== before + 1) throw Error('挑战/网络失败未保持暂停或无限重试');
    }
    const modeControl = s.root.querySelector('[data-setting="previewMode"]');
    for (const mode of ['iframe', 'auto']) {
      modeControl.value = mode; modeControl.dispatchEvent(new Event('change', {bubbles:true}));
      if (s.content.querySelector('iframe')) throw Error('模式切换绕过验证暂停');
    }
    const style = document.createElement('style');
    style.id = 'cf-form-interference';
    style.textContent = ':where(.ld-cf-notice) button {width:600px}'; document.head.append(style);
    return 'CF 挑战提示、停止额外读取、安全外链、失败保持暂停与点击去重：通过';
  })()`).trim());
  for (const [width, dark] of [[1280, false], [390, false], [320, true]]) {
    run(['set', 'viewport', String(width), '800']);
    evaluate(`(() => {
      document.documentElement.style.cssText = ${JSON.stringify(dark ? '--primary:#ddd;--secondary:#222;--primary-low:#444;--primary-medium:#bbb;--tertiary:#8ab4f8;background:#222;color:#ddd' : '')};
      const n = previewTest.state.root.querySelector('.ld-cf-notice'), box = n.getBoundingClientRect();
      const range=document.createRange(); range.selectNodeContents(n.querySelector('.ld-cf-status'));
      const text=range.getClientRects()[0];
      if(!n.contains(document.elementFromPoint(text.left+2,text.top+2))) throw Error('验证说明被悬浮入口遮挡');
      for(const b of n.querySelectorAll('a,button')) {
        const r = b.getBoundingClientRect();
        if(r.width <= 0 || r.left < box.left || r.right > box.right || r.top < 0 || r.bottom > 800) throw Error('验证操作不可见或受原站表单宽度干扰');
      }
    })()`);
    if (process.env.SIDEPEEK_SCREENSHOT_DIR) run(['screenshot', path.join(process.env.SIDEPEEK_SCREENSHOT_DIR, `cf-${width}${dark ? '-dark' : ''}.png`)]);
  }
  console.log(evaluate(`(async () => {
    const s=previewTest.state, f=cfFixture, notice=s.root.querySelector('.ld-cf-notice');
    const settle=()=>new Promise(resolve=>setTimeout(resolve,50));
    document.querySelector('#cf-form-interference').remove(); document.documentElement.style.cssText='';
    f.mode='ok'; notice.querySelector('button').click(); await settle();
    if(s.cfChallenge || !notice.hidden || !s.content.textContent.includes('验证成功后恢复的正文')) throw Error('成功验证未恢复预览');
    if(f.requests.some(r=>r.method!=='GET')) throw Error('验证重放了写入');
    if(!f.requests.some(r=>!r.url.includes('track_visit'))) throw Error('缺少不计访问的验证读取');
    const before=s.content.textContent;
    f.mode='challenge';
    await previewTest.fetchPreviewResponse('/posts/424201/replies', {}).catch(()=>{});
    if(!s.cfChallenge || notice.hidden || s.content.textContent!==before) throw Error('子楼遇盾未提示或丢失已加载正文');
    for (const action of ['switch', 'pagehide']) {
      f.mode='delay'; notice.querySelector('button').click();
      const resolve=f.resolve, pending=f.requests.at(-1);
      if(action==='switch') document.querySelector('#main-outlet a[href="/t/test/2"]').click();
      else window.dispatchEvent(new Event('pagehide'));
      resolve(new Response(JSON.stringify(f.topic), {headers:{'content-type':'application/json'}})); await settle();
      if(!pending.signal.aborted || !s.cfChallenge) throw Error('切帖/挂起后旧验证解除暂停');
      if(action==='pagehide') window.dispatchEvent(new Event('pageshow'));
      document.querySelector('#main-outlet a').click(); await settle();
      if(notice.querySelector('button').disabled) throw Error('取消验证后按钮未恢复');
    }
    f.mode='delay'; notice.querySelector('button').click();
    const stale=f.resolve, request=f.requests.at(-1);
    document.querySelector('.ld-drawer-close').click();
    stale(new Response(JSON.stringify(f.topic), {headers:{'content-type':'application/json'}})); await settle();
    if(!request.signal.aborted || !s.cfChallenge || document.body.classList.contains('ld-drawer-page-open')) throw Error('关闭后旧验证响应恢复或重开抽屉');
    document.querySelector('#main-outlet a').click(); await settle();
    if(notice.hidden || notice.querySelector('button').disabled) throw Error('重开丢失暂停状态或不能重试');
    f.mode='ok'; notice.querySelector('button').click(); await settle();
    if(s.cfChallenge || !notice.hidden) throw Error('重开后无法恢复');
    window.fetch=f.previousFetch; delete window.cfFixture;
    return '恢复正文、仅 GET 探测、子楼遇盾保留内容、关闭期间旧响应与重开恢复：通过';
  })()`).trim());
  const errors = run(["errors"]).trim();
  assert.equal(errors, "", errors);
} finally {
  run(["close"]);
}
