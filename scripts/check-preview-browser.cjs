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
    ${source.replace(/^  init\(\);$/m, "  init(); globalThis.previewTest = { state, getVisibleReadingPosts, buildPostCard, initializePostCarousels, loadTopic };")}
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
    if (s.content.querySelector('.ld-post-card').getBoundingClientRect().top - s.drawerBody.getBoundingClientRect().top > 12) throw Error('首帖与标题间仍有多余空白');
    s.toastStack.querySelector('.ld-toast-close').click();
    return '标签并入标题信息、首帖紧凑布局和一次性可关闭悬浮说明：通过';
  })()`).trim());
  run(['wait','--fn','!document.querySelector(".ld-toast-dismissible")']);
  for (const width of [1280, 390]) {
    run(['set','viewport',String(width),'800']);
    console.log(evaluate(`(() => {
      const s = window.previewTest.state;
      const reply = s.replyFabButton.getBoundingClientRect(), top = s.topFabButton.getBoundingClientRect(), root = s.root.getBoundingClientRect();
      const refresh = s.latestRepliesRefreshButton.getBoundingClientRect();
      if (reply.width === 0 || top.width === 0 || root.bottom - reply.bottom < 27 || root.bottom - reply.bottom > 32 || top.bottom > reply.top || root.right - reply.right < 25 || root.right - reply.right > 28) throw Error('悬浮按钮未向左上移动');
      if (refresh.width === 0 || refresh.right >= top.left || refresh.top !== top.top) throw Error('刷新未排列在回顶左侧');
      if (s.header.querySelector('.ld-drawer-refresh, .ld-drawer-back-top')) throw Error('顶部仍有重复按钮');
      s.drawerBody.scrollTop = 500; s.topFabButton.click();
      if (s.drawerBody.scrollTop !== 0) throw Error('悬浮回到顶部失效');
      s.replyFabButton.click();
      if (s.replyPanel.hidden || !s.topFabButton.hidden || !s.latestRepliesRefreshButton.hidden) throw Error('回复面板与悬浮按钮冲突');
      s.replyCancelButton.click();
      if (s.topFabButton.hidden) throw Error('关闭回复后未恢复悬浮回顶');
      return '悬浮按钮位置、回顶及回复开关：通过（${width}px）';
    })()`).trim());
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
  run(['click', '.ld-drawer-settings-toggle']);
  run(["select", '[data-setting="trackPreviewVisit"]', "off"]);
  evaluate("window.readsAfterOff = window.requests.filter(r => r.method === 'POST').length");
  // 等待超过一轮阅读批次，确认关闭设置后不再发送。
  run(["wait", "6000"]);
  console.log(evaluate(`(() => {
    if (window.previewTest.state.reading || window.requests.filter(r => r.method === "POST").length !== window.readsAfterOff) throw Error("关闭设置后仍上报");
    return "阅读设置关闭后停止上报：通过";
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
    const post = { id: 987, post_number: 1, reads: 54321, reply_count: 5,
      reactions: [{id:'heart',count:2},{id:'+1',count:1},{id:'clap',count:1}], reaction_users_count: 4,
      current_user_reaction: { id:'heart', can_undo:true }, actions_summary:[{id:2,acted:true,count:2}],
      cooked:'<pre><code>' + 'long_code_'.repeat(500) + '</code></pre>' };
    const card = buildPostCard(post);
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
  console.log(evaluate(`(async () => {
    ${nativeSource}
    const { state, buildPostCard } = window.previewTest;
    let destroyed = 0;
    let destroyedPosts = 0;
    let fail = false;
    let boostRecord;
    const modules = {
      "discourse/lib/get-owner": { getOwnerWithFallback: () => ({ lookup: () => ({ createRecord: (kind, data) => {
        const record = { ...data, destroy: () => destroyedPosts++ };
        if (data.can_boost) boostRecord = record;
        return record;
      } }) }) },
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
    const beforeClose = destroyed;
    state.root.setAttribute('aria-hidden', 'true');
    await new Promise(resolve => setTimeout(resolve, 0));
    if (destroyed !== beforeClose + 2 || boostTarget.children.length || boostCard.querySelector('.ld-native-body')) throw Error('关闭未释放 Boost 和正文');
    delete window.require;
    return '原站正文/Boost 桥：挂载、状态同步、模块缺失回退、切帖/关闭销毁和异常清理：通过';
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
    s.settings.postMode = 'all'; s.settings.replyOrder = 'default'; s.settings.authorFilter = 'all';
    s.settings.trackPreviewVisit = 'off';
    s.currentUrl = 'https://linux.do/t/test/100/25'; s.currentTopicIdHint = 100;
    s.currentViewTracked = true;
    let total = 41;
    let emptyBatch = true;
    const post = n => ({id:10000+n, post_number:n, username:'test-user', created_at:'2026-01-01T00:00:00Z',
      cooked:'<p style="height:100px">刷新回归正文 ' + n + '</p>', actions_summary:[]});
    window.fetch = async (input, options = {}) => {
      const url = new URL(input, location.href);
      const batch = url.pathname.endsWith('/posts.json');
      if (!batch && options.cache !== 'no-store') throw Error('刷新主题请求复用了 HTTP 缓存');
      const numbers = batch ? (emptyBatch ? [] : url.searchParams.getAll('post_ids[]').map(id => Number(id)-10000))
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
    return '定位窗口刷新后新增回复可见、空分页重试、补齐且无重复乱序：通过';
  })()`).trim());
  const errors = run(["errors"]).trim();
  assert.equal(errors, "", errors);
} finally {
  run(["close"]);
}
