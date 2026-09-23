const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");

const read = name => fs.readFileSync(path.join(__dirname, "..", name), "utf8");
const source = read("src/content.js");
const testSymbols = "state, normalizeBookmarkData, fetchAllBookmarks, updateBookmarkData, importBookmarkBackup, openBookmarkPanel, openDrawer, handlePostBookmark, buildPostCard, canTrackReading, assertBookmarkAccount, refreshBookmarkCache, scheduleBookmarkRefresh";
const instrument = (text, userscript = false) => text.replace(userscript ? /^    init\(\);$/m : /^  init\(\);$/m,
  `globalThis.bookmarkTest = { ${testSymbols} };`);

async function checkStorage(userscript) {
  const storage = new Map();
  let token = "test-session", userId = 7, failWrite = false, queue = Promise.resolve(), requests = 0;
  const context = {
    window: { addEventListener() {} }, unsafeWindow: {}, location: { href: "https://linux.do/latest", origin: "https://linux.do" },
    localStorage: { getItem: () => null }, URL, AbortSignal, Response, TextEncoder, setTimeout: fn => setTimeout(fn, 0),
    document: { addEventListener() {}, querySelector: () => ({ getAttribute: () => token }), createElement: () => ({}), head: { appendChild() {} } },
    navigator: { locks: { request: (key, fn) => { const result = queue.then(fn); queue = result.catch(() => {}); return result; } } },
    chrome: { storage: { local: {
      get: async key => ({ [key]: storage.get(key) }),
      set: async data => { if (failWrite) throw Error("storage full"); for (const [k, v] of Object.entries(data)) storage.set(k, v); }
    } } },
    GM_getValue: async key => storage.get(key) ?? null,
    GM_setValue: async (key, value) => { if (failWrite) throw Error("storage full"); storage.set(key, value); },
    fetch: async () => { requests++; return new Response(JSON.stringify({ current_user: { id: userId, username: "tester" } })); }
  };
  vm.runInNewContext(instrument(userscript ? read("userscript/linuxdo-sidepeek.user.js") : source, userscript), context);
  const api = context.bookmarkTest, b = api.state.bookmarks;
  b.user = { id: 7, username: "tester" }; b.token = token; b.data = api.normalizeBookmarkData(null);
  b.verified = true;
  await Promise.all([
    api.updateBookmarkData(data => { data.folders.push("技术"); }),
    api.updateBookmarkData(data => { data.items["Post:101"] = { folder: "", tags: ["标签"], note: "本地备注" }; })
  ]);
  assert.equal(b.data.folders[0], "技术");
  assert.equal(b.data.items["Post:101"].note, "本地备注", "并行写入不能覆盖另一个修改");
  const backup = { type: "sidepeek-bookmark-metadata", origin: "https://linux.do", userId: 7,
    data: { version: 1, folders: ["生活"], items: {
      "Post:101": { folder: "生活", tags: [], note: "导入旧备注" },
      "Topic:8": { folder: "生活", tags: ["新标签"], note: "新增" }
    } } };
  await api.importBookmarkBackup(backup);
  assert.equal(b.data.items["Post:101"].note, "本地备注");
  assert.equal(b.data.items["Topic:8"].folder, "生活");
  const before = JSON.stringify([...storage]);
  assert.throws(() => api.normalizeBookmarkData({ ...backup.data, oversized: "大".repeat(1_500_000) }), /4 MB/);
  await assert.rejects(api.importBookmarkBackup({ ...backup, userId: 8 }), /当前/);
  await assert.rejects(api.importBookmarkBackup({ ...backup, data: null }), /缺少/);
  await assert.rejects(api.importBookmarkBackup({ ...backup, data: { version: 1, folders: [], items: JSON.parse('{"__proto__":{}}') } }), /格式/);
  await assert.rejects(api.importBookmarkBackup({ ...backup, data: { version: 1, folders: [], items: { "Post:1": { folder: "未知", tags: [], note: "" } } } }), /格式/);
  assert.equal(JSON.stringify([...storage]), before);
  failWrite = true;
  await assert.rejects(api.updateBookmarkData(data => { data.folders.push("不能保存"); }), /storage full/);
  assert.equal(JSON.stringify([...storage]), before);
  failWrite = false;
  assert.equal(requests, 0, "本地整理操作不应发起网络请求");
  userId = 8;
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(api.assertBookmarkAccount(b.user, token, false, cancelled.signal));
  assert.equal(b.verified, true, "取消的旧刷新不得失效当前会话");
  await assert.rejects(api.assertBookmarkAccount(b.user, token), /账号/);
  await assert.rejects(api.updateBookmarkData(data => { data.folders.push("串号"); }), /账号/);
  assert.equal(JSON.stringify([...storage]), before);
  userId = 7; token = "changed-session";
  await assert.rejects(api.updateBookmarkData(data => { data.folders.push("过期会话"); }), /账号/);
  assert.equal(JSON.stringify([...storage]), before);
  console.log(`${userscript ? "油猴" : "扩展"}：存储、并行合并、导入校验、失败保护和账号隔离通过`);
}

function checkBrowser() {
  const session = `sidepeek-bookmarks-check-${process.pid}`;
  const run = (args, input) => {
    const result = spawnSync("agent-browser", ["--session", session, ...args], { input, encoding: "utf8", maxBuffer: 2_000_000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout;
  };
  const evaluate = code => run(["eval", "--stdin"], code);
  const wait = condition => run(["wait", "--fn", condition]);
  const answer = (accept = true) => {
    wait("!!document.querySelector('#ld-bookmark-confirm[open]')");
    run(["click", `#ld-bookmark-confirm [value="${accept ? "confirm" : "cancel"}"]`]);
    wait("!document.querySelector('#ld-bookmark-confirm')");
  };
  const screenshot = name => {
    if (process.env.SIDEPEEK_SCREENSHOT_DIR) run(["screenshot", path.join(process.env.SIDEPEEK_SCREENSHOT_DIR, name)]);
  };
  try {
    run(["open", "about:blank"]);
    run(["network", "route", "https://linux.do/latest", "--body",
      '<!doctype html><meta charset="utf-8"><meta name="csrf-token" content="test-session"><title>收藏固定页面</title><style>body{background:#f3f5f7;font-family:system-ui}input,textarea,select{width:210px}button{font-family:serif;letter-spacing:2px}summary::before{content:"▸"}summary::after{content:"▾"}label{font-weight:bold}#main-outlet{padding:40px}</style><div id="current-user"></div><main id="main-outlet"><h1>社区首页</h1><p>发现有用的内容，和大家一起交流。</p></main>']);
    run(["open", "https://linux.do/latest"]);
    evaluate(`(() => {
      window.storedBookmarks = {'ld-bookmarks-v1:7':{version:1,folders:['技术笔记','生活指南','稍后阅读'],items:{
        'Post:124':{folder:'技术笔记',tags:['教程','实用工具'],note:'周末跟着教程试一遍，命令和注意事项写得很清楚。'},
        'Post:123':{folder:'生活指南',tags:['经验分享'],note:''}
      }}}; window.calls = []; window.testUserId = 7; window.failPage = false; window.badPage = false;
      window.failWrite = false; window.failDelete = false; window.failCreate = false; window.denyLogin = false; window.delayPage = false;
      window.confirm = () => { throw Error('不应使用原生确认框'); };
      window.GM_xmlhttpRequest = options => options.onerror();
      Object.defineProperty(window.chrome, 'storage', { configurable:true, value:{local:{
        get: async key => structuredClone({[key]:window.storedBookmarks[key]}),
        set: async data => { if(window.failWrite) throw Error('存储失败'); Object.assign(window.storedBookmarks, structuredClone(data)); }
      }}});
      const titles=['一个周末整理好自己的数字生活','常用 Docker 命令与排错笔记','那些用了就回不去的小工具','分享一些值得反复阅读的技术文章'];
      window.bookmarks = Array.from({length:25}, (_,i) => ({id:i+1, bookmarkable_type:i===19?'Topic':'Post', bookmarkable_id:101+i,
        topic_id:i+1, linked_post_number:i%3===0?1:i+2, title:i === 24 ? '把旧电脑变成家庭服务器：从安装到远程访问' : i===0 ? '关于 [a+b]? <img> 的收藏' : titles[i%4],
        created_at:new Date(2026,0,i+1).toISOString(), excerpt:'<b>整理了最近实践中用到的方法和工具</b>，也记录了一些容易忽略的小细节，希望对大家有帮助。<img src=x onerror="window.bookmarkXss=true">'}));
      window.fetch = async (input, options={}) => {
        const url = new URL(input, location.href); window.calls.push({path:url.pathname, page:url.searchParams.get('page'), method:options.method||'GET'});
        if(url.pathname === '/session/current.json') return new Response(JSON.stringify({current_user:{id:window.testUserId,username:'tester'+window.testUserId}}), {status:window.denyLogin?403:200});
        if(url.pathname.startsWith('/u/')) {
          const page=Number(url.searchParams.get('page'));
          if(window.delayPage && page===1) await new Promise(resolve=>setTimeout(resolve,300));
          if(window.failPage && page===1) return new Response('{}',{status:429});
          const rows=window.testUserId===7 ? window.bookmarks.slice(page*20,(page+1)*20) : [];
          return new Response(JSON.stringify({user_bookmark_list:{bookmarks:rows,
            more_bookmarks_url:page===0 && rows.length===20 ? (window.badPage?'https://other.invalid/steal':'/u/tester7/bookmarks.json?page=1') : null}}));
        }
        if(url.pathname.startsWith('/bookmarks/')) {
          if(window.failDelete) return new Response('{}',{status:500});
          window.bookmarks=window.bookmarks.filter(item=>item.id!==Number(url.pathname.split('/').pop()));
          return new Response('{}');
        }
        if(url.pathname === '/bookmarks') {
          if(window.failCreate) return new Response('{}',{status:500});
          const payload=JSON.parse(options.body), id=300+window.bookmarks.filter(item=>item.id>=300).length;
          window.bookmarks.push({id,bookmarkable_id:payload.bookmarkable_id,bookmarkable_type:'Post',topic_id:payload.bookmarkable_id-100,linked_post_number:1,title:'新收藏'});
          return new Response(JSON.stringify({id}));
        }
        if(url.pathname.startsWith('/t/')) {
          const id=parseInt(url.pathname.split('/')[3],10)||1;
          const posts=[{id:100+id,post_number:id>=26?1:id+1,username:'tester',cooked:'<p>固定正文</p>',bookmarked:id!==27}];
          return new Response(JSON.stringify({id,title:'固定主题',posts_count:1,post_stream:{posts,stream:posts.map(post=>post.id)}}),{headers:{'content-type':'application/json'}});
        }
        throw Error('固定页面禁止访问其他接口');
      };
      const style=document.createElement('style'); style.textContent=${JSON.stringify(read("src/content.css"))}; document.head.append(style);
      ${instrument(source).replace("globalThis.bookmarkTest =", "init(); globalThis.bookmarkTest =")}
    })()`);
    run(["set", "viewport", "1440", "900"]);
    console.log(evaluate(`(() => {
      const b=bookmarkTest.state.bookmarks, grade=bookmarkTest.state.trustPanel.getBoundingClientRect(), r=b.trigger.getBoundingClientRect();
      if(Math.abs(r.top-grade.bottom-8)>2 || Math.abs(r.width-grade.width)>2 || Math.abs(r.height-grade.height)>2) throw Error('收藏入口未与等级同尺寸排列');
      const range=document.createRange(); range.selectNodeContents(b.trigger.querySelector('span'));
      const label=range.getBoundingClientRect(); range.selectNode(bookmarkTest.state.trustPanel.querySelector('summary').firstChild);
      const gradeLabel=range.getBoundingClientRect();
      if(Math.abs(label.left-gradeLabel.left)>1 || Math.abs((label.top-r.top)-(gradeLabel.top-grade.top))>1 || !b.trigger.querySelector('svg path')) throw Error('五角星入口文字未与等级对齐');
      b.trigger.dispatchEvent(new PointerEvent('pointerenter',{pointerType:'touch'}));
      if(b.dialog.open) throw Error('触屏不应悬停展开');
      return '浏览器：等级下方同尺寸入口、触屏不误展开通过';
    })()`));
    screenshot("bookmarks-entry.png");
    evaluate("bookmarkTest.state.trustPanel.open=true");
    wait("Math.abs(bookmarkTest.state.bookmarks.trigger.getBoundingClientRect().top-bookmarkTest.state.trustPanel.getBoundingClientRect().bottom-8)<2");
    evaluate("bookmarkTest.state.trustPanel.hidden=true");
    wait("bookmarkTest.state.bookmarks.trigger.getBoundingClientRect().top===100");
    evaluate("bookmarkTest.state.trustPanel.hidden=false; bookmarkTest.state.trustPanel.open=false");
    wait("Math.abs(bookmarkTest.state.bookmarks.trigger.getBoundingClientRect().top-bookmarkTest.state.trustPanel.getBoundingClientRect().bottom-8)<2");
    run(["hover", "#ld-bookmarks-trigger"]);
    wait("bookmarkTest.state.bookmarks.complete && !bookmarkTest.state.bookmarks.loading");
    evaluate("window.cachedPages=calls.filter(c=>c.path.startsWith('/u/')).length; window.cachedRequests=calls.length");
    run(["hover", "#main-outlet"]);
    wait("!bookmarkTest.state.bookmarks.dialog.open");
    run(["hover", "#ld-bookmarks-trigger"]);
    wait("bookmarkTest.state.bookmarks.dialog.open");
    assert.equal(evaluate("calls.length===cachedRequests && !bookmarkTest.state.bookmarks.loading && !!document.querySelector('.ld-bookmark-item')").trim(), "true", "重复悬停不请求账号或列表，缓存立即可见");
    assert.equal(evaluate("(() => { const first=document.querySelector('.ld-bookmark-item'); bookmarkTest.openBookmarkPanel('',false,true); return document.querySelector('.ld-bookmark-item')===first && !bookmarkTest.state.bookmarks.loading; })()").trim(), "true", "缓存打开不得先清空列表");
    evaluate("bookmarkTest.openBookmarkPanel('',false,true)");
    assert.equal(evaluate("calls.length===cachedRequests").trim(), "true", "一小时内重开不应发起任何请求");
    evaluate("bookmarkTest.state.bookmarks.cacheAt=Date.now()-3600001; bookmarkTest.scheduleBookmarkRefresh()");
    wait("!bookmarkTest.state.bookmarks.refreshController && Date.now()-bookmarkTest.state.bookmarks.cacheAt<5000");
    assert.equal(evaluate("calls.filter(c=>c.path.startsWith('/u/')).length===cachedPages+2").trim(), "true", "到期应自动刷新所有分页");
    evaluate("window.beforeHidden=calls.length; Object.defineProperty(document,'hidden',{configurable:true,value:true})");
    evaluate("bookmarkTest.refreshBookmarkCache()");
    assert.equal(evaluate("calls.length===beforeHidden").trim(), "true", "后台标签页延后自动刷新");
    evaluate("delete document.hidden; bookmarkTest.scheduleBookmarkRefresh()");
    assert.equal(evaluate("bookmarkTest.state.bookmarks.compact && !bookmarkTest.state.bookmarks.dialog.matches(':modal') && !bookmarkTest.state.bookmarks.dialog.contains(document.activeElement)").trim(), "true");
    run(["hover", ".ld-bookmark-list"]);
    assert.equal(evaluate("bookmarkTest.state.bookmarks.dialog.open").trim(), "true");
    run(["focus", ".ld-bookmark-sort"]);
    run(["hover", "#main-outlet"]);
    assert.equal(evaluate("bookmarkTest.state.bookmarks.dialog.open").trim(), "true");
    evaluate("document.activeElement.blur()");
    wait("!bookmarkTest.state.bookmarks.dialog.open");
    run(["click", "#ld-bookmarks-trigger"]);
    wait("bookmarkTest.state.bookmarks.complete && !bookmarkTest.state.bookmarks.loading");
    run(["hover", "#main-outlet"]);
    assert.equal(evaluate("bookmarkTest.state.bookmarks.pinned && bookmarkTest.state.bookmarks.dialog.open").trim(), "true");
    console.log(evaluate(`(() => {
      const summary=document.querySelector('.ld-bookmark-more summary');
      if(summary.textContent!=='更多' || getComputedStyle(summary,'::before').content!=='none' || getComputedStyle(summary,'::after').content!=='none' || getComputedStyle(summary).display==='list-item') throw Error('更多仍显示原生或站点箭头');
      if(document.querySelector('.ld-bookmark-list-head')) throw Error('列表仍显示重复收藏标题');
      const topic=document.querySelector('.ld-bookmark-item[data-key="Post:125"]');
      const reply=document.querySelector('.ld-bookmark-item[data-key="Post:124"]');
      if(topic.querySelector('.ld-bookmark-reply') || document.querySelector('.ld-bookmark-item[data-key="Topic:120"] .ld-bookmark-reply') || !reply.querySelector('.ld-bookmark-floor').textContent.includes('#25')) throw Error('主题与回复层级错误');
      const title=reply.querySelector('a').getBoundingClientRect(), detail=reply.querySelector('.ld-bookmark-reply').getBoundingClientRect();
      if(detail.top<title.bottom || detail.left<=title.left || !reply.querySelector('.ld-bookmark-excerpt').textContent.includes('实践')) throw Error('回复未缩进展示楼层和实际摘要');
      return '浏览器：无重复标题、更多无箭头、主题标题与回复层级通过';
    })()`));
    screenshot("bookmarks-compact-desktop.png");
    for (const term of ['家庭服务器', '[a+b]?', '<img>', 'docker', '实践', '周末', '实用工具']) {
      run(["fill", ".ld-bookmark-search", term]);
      assert.equal(evaluate(`(() => {
        const marks=[...document.querySelectorAll('.ld-bookmark-list mark')];
        return marks.some(mark=>mark.textContent.toLowerCase()===${JSON.stringify(term.toLowerCase())} && mark.getBoundingClientRect().height>0) && !document.querySelector('.ld-bookmark-list img');
      })()`).trim(), "true", `搜索高亮应可见且保持文本安全：${term}`);
    }
    screenshot("bookmarks-search.png");
    assert.equal(evaluate("document.querySelector('.ld-bookmark-reply .ld-bookmark-excerpt').textContent.includes('实践') && !document.querySelector('.ld-bookmark-reply .ld-bookmark-excerpt').textContent.includes('标签：') && document.querySelector('.ld-bookmark-tag-chip mark').textContent==='实用工具'").trim(), "true", "标签命中只高亮标签，不替换回复摘要");
    run(["fill", ".ld-bookmark-search", ""]);
    assert.equal(evaluate("document.querySelectorAll('.ld-bookmark-list mark').length").trim(), "0");
    run(["click", '.ld-bookmark-item[data-key="Post:125"] a']);
    wait("!!bookmarkTest.state.currentTopic");
    assert.equal(evaluate("!!document.querySelector('.ld-post-card')").trim(), "true", "收藏预览必须真正渲染正文，而非只更新主题状态");
    assert.equal(evaluate("bookmarkTest.state.currentUrl.endsWith('/25/1') && !bookmarkTest.state.bookmarks.dialog.open").trim(), "true");
    run(["click", ".ld-drawer-close"]);
    wait("bookmarkTest.state.bookmarks.dialog.open && !bookmarkTest.state.bookmarks.loading");
    assert.equal(evaluate("bookmarkTest.state.bookmarks.compact && !bookmarkTest.state.bookmarks.dialog.matches(':modal')").trim(), "true");
    run(["set", "viewport", "390", "700"]);
    wait("bookmarkTest.state.bookmarks.dialog.getBoundingClientRect().right<=innerWidth");
    console.log(evaluate(`(() => {
      const r=bookmarkTest.state.bookmarks.dialog.getBoundingClientRect();
      if(r.width>380 || r.height>500 || r.left<0 || r.right>innerWidth || r.bottom>innerHeight) throw Error('紧凑收藏列表溢出');
      return '浏览器：悬停、点击固定、侧栏阅读返回及390px紧凑列表通过';
    })()`));
    screenshot("bookmarks-compact-mobile.png");
    run(["set", "viewport", "1440", "900"]);
    evaluate("document.documentElement.style.cssText='--primary:#e4e7ec;--secondary:#1d232a;--primary-low:#353e47;--tertiary:#79c7b2;--danger:#ef8e87;color-scheme:dark'");
    screenshot("bookmarks-compact-dark.png");
    evaluate("document.documentElement.style.cssText=''");
    run(["press", "Escape"]);
    wait("!bookmarkTest.state.bookmarks.dialog.open && document.activeElement.id==='ld-bookmarks-trigger'");
    run(["press", "Enter"]);
    wait("bookmarkTest.state.bookmarks.dialog.open && !bookmarkTest.state.bookmarks.loading");
    run(["click", '[data-bookmark-action="manage"]']);
    wait("!bookmarkTest.state.bookmarks.loading && bookmarkTest.state.bookmarks.dialog.matches(':modal')");
    run(["snapshot", "-i"]);
    run(["click", '.ld-bookmark-heading']);
    assert.equal(evaluate("bookmarkTest.state.bookmarks.dialog.open").trim(), "true", "弹窗内空白不应关闭");
    run(["mouse", "move", "700", "75"]);
    run(["mouse", "down"]);
    run(["mouse", "move", "5", "5"]);
    run(["mouse", "up"]);
    assert.equal(evaluate("bookmarkTest.state.bookmarks.dialog.open").trim(), "true", "从弹窗内拖到外面不应关闭");
    evaluate("bookmarkTest.state.bookmarks.busy=true");
    run(["mouse", "down"]);
    run(["mouse", "up"]);
    assert.equal(evaluate("bookmarkTest.state.bookmarks.dialog.open").trim(), "true", "保存中不能从背景关闭");
    evaluate("bookmarkTest.state.bookmarks.busy=false");
    run(["mouse", "down"]);
    run(["mouse", "up"]);
    wait("!bookmarkTest.state.bookmarks.dialog.open && document.activeElement.id==='ld-bookmarks-trigger'");
    evaluate("bookmarkTest.openBookmarkPanel()");
    assert.equal(evaluate("document.querySelector('.ld-bookmark-folder-form').hidden && document.querySelector('.ld-bookmark-editor').hidden && !document.querySelector('.ld-bookmark-more').open").trim(), "true");
    run(["click", '.ld-bookmark-more summary']);
    run(["press", "Escape"]);
    assert.equal(evaluate("bookmarkTest.state.bookmarks.dialog.open && !document.querySelector('.ld-bookmark-more').open && document.activeElement.matches('.ld-bookmark-more summary')").trim(), "true");
    assert.equal(evaluate("document.querySelectorAll('.ld-bookmark-item').length").trim(), "25");
    assert.equal(evaluate("!!window.bookmarkXss || !!document.querySelector('.ld-bookmark-list img')").trim(), "false");
    run(["fill", ".ld-bookmark-search", "家庭服务器"]);
    assert.equal(evaluate("document.querySelectorAll('.ld-bookmark-item').length").trim(), "1");
    assert.equal(evaluate("document.querySelector('.ld-bookmark-item a mark').textContent").trim(), '"家庭服务器"');
    assert.equal(evaluate("getComputedStyle(document.querySelector('.ld-bookmark-item mark')).backgroundColor").trim(), '"rgb(255, 224, 61)"');
    run(["click", '[data-bookmark-action="clear-search"]']);
    assert.equal(evaluate("document.querySelector('.ld-bookmark-search').value==='' && document.querySelector('.ld-bookmark-search-clear').hidden && !document.querySelector('.ld-bookmark-list mark')").trim(), "true");
    run(["fill", ".ld-bookmark-search", "实用工具"]);
    assert.equal(evaluate(`(() => {
      const row=document.querySelector('.ld-bookmark-item'), info=row.querySelector('.ld-bookmark-row-meta');
      const date=info.firstElementChild.getBoundingClientRect(), chip=info.querySelector('.ld-bookmark-folder-chip').getBoundingClientRect();
      return row.querySelector('.ld-bookmark-reply .ld-bookmark-excerpt').textContent.includes('实践') &&
        !!info.querySelector('.ld-bookmark-tag-chip mark') && chip.left>date.right && Math.abs(chip.top-date.top)<8;
    })()`).trim(), "true", "完整管理页摘要保留，日期后同排显示收藏夹和标签");
    screenshot("bookmarks-search-manager.png");
    run(["set", "viewport", "390", "700"]);
    screenshot("bookmarks-search-manager-mobile.png");
    assert.equal(evaluate("[...document.querySelectorAll('.ld-bookmark-chips span')].every(chip=>chip.getBoundingClientRect().right<=innerWidth)").trim(), "true");
    run(["set", "viewport", "1280", "900"]);
    run(["fill", ".ld-bookmark-search", ""]);
    run(["hover", '[data-folder-row="生活指南"]']);
    run(["click", '[data-folder-row="生活指南"] summary']);
    wait("document.querySelector('[data-folder-row=\"生活指南\"] [popover]').matches(':popover-open')");
    screenshot("bookmarks-folder-menu.png");
    assert.equal(evaluate("[...document.querySelector('[data-folder-row=\"生活指南\"] .ld-bookmark-folder-menu').querySelectorAll('button')].map(b=>b.textContent).join(',')").trim(), '"修改,删除"');
    run(["press", "Escape"]);
    evaluate(`(() => {
      window.beforeLocalRequests=calls.length;
      const source=document.querySelector('[data-folder-row="生活指南"]'), target=document.querySelector('[data-folder-row="技术笔记"]');
      window.folderDragTransfer=new DataTransfer();
      source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:folderDragTransfer}));
      const rect=target.getBoundingClientRect();
      target.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:folderDragTransfer,clientY:rect.top+2}));
    })()`);
    assert.equal(evaluate("document.querySelector('[data-folder-row=\"技术笔记\"]').dataset.dropPosition").trim(), '"before"');
    screenshot("bookmarks-folder-drag.png");
    evaluate(`(() => {
      const target=document.querySelector('[data-folder-row="技术笔记"]'), rect=target.getBoundingClientRect();
      target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:folderDragTransfer,clientY:rect.top+2}));
    })()`);
    wait("!bookmarkTest.state.bookmarks.busy");
    assert.equal(evaluate("storedBookmarks['ld-bookmarks-v1:7'].folders[0]").trim(), '"生活指南"');
    assert.equal(evaluate("!!document.querySelector('[data-drop-position]')").trim(), "false");
    run(["drag", '[data-folder-row="技术笔记"]', '[data-folder-row="生活指南"]']);
    wait("!bookmarkTest.state.bookmarks.busy");
    assert.equal(evaluate("storedBookmarks['ld-bookmarks-v1:7'].folders[0]").trim(), '"技术笔记"');
    assert.equal(evaluate("calls.length===beforeLocalRequests").trim(), "true", "拖拽不应联网");
    evaluate("window.prompt=()=> { throw Error('改名不应使用原生输入框'); }");
    run(["hover", '[data-folder-row="生活指南"]']);
    run(["click", '[data-folder-row="生活指南"] summary']);
    wait("document.querySelector('[data-folder-row=\"生活指南\"] [popover]').matches(':popover-open')");
    run(["click", '[data-folder-row="生活指南"] [data-bookmark-action="rename-folder"]']);
    wait("!!document.querySelector('.ld-bookmark-folder-rename input')");
    screenshot("bookmarks-folder-rename.png");
    run(["fill", '.ld-bookmark-folder-rename input', "技术笔记"]);
    run(["press", "Enter"]);
    assert.equal(evaluate("!document.querySelector('.ld-bookmark-folder-rename input').validity.valid && storedBookmarks['ld-bookmarks-v1:7'].items['Post:123'].folder==='生活指南'").trim(), "true");
    run(["fill", '.ld-bookmark-folder-rename input', "生活经验"]);
    assert.equal(evaluate("(() => { const event=new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}); document.querySelector('.ld-bookmark-folder-rename input').dispatchEvent(event); return event.defaultPrevented && !bookmarkTest.state.bookmarks.busy; })()").trim(), "true");
    evaluate("window.failWrite=true");
    run(["press", "Enter"]);
    wait("!bookmarkTest.state.bookmarks.busy");
    assert.equal(evaluate("document.querySelector('.ld-bookmark-folder-rename input').value==='生活经验' && storedBookmarks['ld-bookmarks-v1:7'].items['Post:123'].folder==='生活指南'").trim(), "true");
    evaluate("window.failWrite=false");
    run(["press", "Enter"]);
    wait("!bookmarkTest.state.bookmarks.busy");
    assert.equal(evaluate("storedBookmarks['ld-bookmarks-v1:7'].items['Post:123'].folder").trim(), '"生活经验"');
    assert.equal(evaluate("[...document.querySelectorAll('[data-folder-row]')].every(row=>row.draggable)").trim(), "true", "改名保存后仍能拖拽");
    run(["hover", '[data-folder-row="生活经验"]']);
    run(["click", '[data-folder-row="生活经验"] summary']);
    wait("document.querySelector('[data-folder-row=\"生活经验\"] [popover]').matches(':popover-open')");
    run(["click", '[data-folder-row="生活经验"] [data-bookmark-action="rename-folder"]']);
    wait("!!document.querySelector('.ld-bookmark-folder-rename input')");
    run(["fill", '.ld-bookmark-folder-rename input', "不应保存"]);
    run(["press", "Escape"]);
    assert.equal(evaluate("bookmarkTest.state.bookmarks.dialog.open && !document.querySelector('.ld-bookmark-folder-rename') && storedBookmarks['ld-bookmarks-v1:7'].items['Post:123'].folder==='生活经验'").trim(), "true");
    run(["hover", '[data-folder-row="生活经验"]']);
    run(["click", '[data-folder-row="生活经验"] summary']);
    wait("document.querySelector('[data-folder-row=\"生活经验\"] [popover]').matches(':popover-open')");
    run(["click", '[data-folder-row="生活经验"] [data-bookmark-action="rename-folder"]']);
    run(["fill", '.ld-bookmark-folder-rename input', "生活指南"]);
    run(["press", "Enter"]);
    wait("!bookmarkTest.state.bookmarks.busy");
    assert.equal(evaluate("storedBookmarks['ld-bookmarks-v1:7'].items['Post:123'].folder").trim(), '"生活指南"');
    assert.equal(evaluate("document.querySelector('.ld-bookmark-folder-chip').textContent.startsWith('收藏夹 · ') && document.querySelector('.ld-bookmark-tag-chip').textContent.startsWith('# ')").trim(), "true");
    evaluate(`window.GM_xmlhttpRequest=options=> {
      if(options.method==='POST') window.testGist={id:'b'.repeat(32),public:false,files:JSON.parse(options.data).files};
      if(options.method==='PATCH') window.testGist.files=JSON.parse(options.data).files;
      options.onload({status:200,responseText:JSON.stringify(window.testGist)});
    }`);
    run(["click", '.ld-bookmark-more summary']);
    run(["click", '[data-bookmark-action="sync-settings"]']);
    wait("!bookmarkTest.state.bookmarks.busy && !document.querySelector('.ld-bookmark-sync').hidden");
    evaluate("window.prompt=()=> { throw Error('Token 不应使用原生输入框'); }");
    assert.equal(evaluate("document.querySelector('#ld-bookmark-sync-token').type==='password' && !document.querySelector('.ld-bookmark-sync [data-bookmark-action=\"cancel-edit\"]') && !document.querySelector('.ld-bookmark-sync details')").trim(), "true");
    run(["focus", '#ld-bookmark-sync-token']);
    run(["hover", '[aria-controls="ld-bookmark-token-help"]']);
    wait("document.querySelector('#ld-bookmark-token-help').matches(':popover-open')");
    assert.equal(evaluate("document.activeElement.id==='ld-bookmark-sync-token'").trim(), "true");
    run(["hover", '#ld-bookmark-token-help a']);
    assert.equal(evaluate("document.querySelector('#ld-bookmark-token-help').matches(':popover-open') && document.querySelector('#ld-bookmark-token-help a').rel==='noopener noreferrer'").trim(), "true");
    screenshot("bookmarks-gist-help-desktop.png");
    evaluate("document.documentElement.style.cssText='--primary:#e4e7ec;--secondary:#1d232a;--primary-low:#353e47;--tertiary:#79c7b2;--danger:#ef8e87;color-scheme:dark'");
    screenshot("bookmarks-gist-help-dark.png");
    evaluate("document.documentElement.style.cssText=''");
    run(["press", "Escape"]);
    assert.equal(evaluate("!document.querySelector('#ld-bookmark-token-help').matches(':popover-open') && !document.querySelector('.ld-bookmark-sync').hidden").trim(), "true");
    run(["fill", '#ld-bookmark-sync-token', "test_token_not_a_secret"]);
    run(["click", '.ld-bookmark-sync button[type="submit"]']);
    screenshot("bookmarks-confirm-desktop.png");
    evaluate("document.documentElement.style.cssText='--primary:#e4e7ec;--secondary:#1d232a;--primary-low:#353e47;--tertiary:#79c7b2;color-scheme:dark'");
    screenshot("bookmarks-confirm-dark.png");
    evaluate("document.documentElement.style.cssText=''");
    answer();
    wait("!bookmarkTest.state.bookmarks.busy");
    assert.equal(evaluate("document.querySelector('.ld-bookmark-sync input[name=\"gistId\"]').value==='b'.repeat(32) && document.querySelector('#ld-bookmark-sync-token').value==='' && !!storedBookmarks['ld-bookmarks-gist:7'].lastSync").trim(), "true");
    screenshot("bookmarks-gist-desktop.png");
    run(["press", "Escape"]);
    run(["click", '.ld-bookmark-more summary']);
    run(["click", '[data-bookmark-action="sync-settings"]']);
    wait("!bookmarkTest.state.bookmarks.busy && !document.querySelector('.ld-bookmark-sync').hidden");
    assert.equal(evaluate("document.querySelector('#ld-bookmark-sync-token').value==='' && !document.querySelector('.ld-bookmark-more').open").trim(), "true");
    run(["click", '.ld-bookmark-sync button[type="submit"]']);
    wait("!bookmarkTest.state.bookmarks.busy");
    assert.equal(evaluate("document.querySelector('.ld-bookmark-status').textContent.startsWith('已同步')").trim(), "true");
    run(["fill", '#ld-bookmark-sync-token', "unsaved_test_token"]);
    run(["press", "Escape"]);
    answer(false);
    assert.equal(evaluate("document.querySelector('#ld-bookmark-sync-token').value==='unsaved_test_token' && !document.querySelector('.ld-bookmark-sync').hidden").trim(), "true");
    run(["click", '[aria-controls="ld-bookmark-token-help"]']);
    run(["click", '[data-bookmark-folder="*"]']);
    answer();
    assert.equal(evaluate("document.querySelector('#ld-bookmark-sync-token').value==='' && !document.querySelector('.ld-bookmark-sync-tip:popover-open')").trim(), "true");
    run(["click", '.ld-bookmark-more summary']);
    run(["click", '[data-bookmark-action="sync-settings"]']);
    wait("!bookmarkTest.state.bookmarks.busy && !document.querySelector('.ld-bookmark-sync').hidden");
    run(["set", "viewport", "390", "700"]);
    screenshot("bookmarks-gist-mobile.png");
    run(["click", '[aria-controls="ld-bookmark-id-help"]']);
    wait("document.querySelector('#ld-bookmark-id-help').matches(':popover-open')");
    screenshot("bookmarks-gist-help-mobile.png");
    assert.equal(evaluate("(() => {const r=document.querySelector('#ld-bookmark-id-help').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.bottom<=innerHeight;})()").trim(), "true");
    run(["press", "Escape"]);
    run(["focus", '[aria-controls="ld-bookmark-token-help"]']);
    run(["press", "Enter"]);
    wait("document.querySelector('#ld-bookmark-token-help').matches(':popover-open')");
    run(["press", "Escape"]);
    assert.equal(evaluate("!document.querySelector('.ld-bookmark-sync-tip:popover-open') && !document.querySelector('.ld-bookmark-sync').hidden").trim(), "true");
    run(["hover", '.ld-bookmark-heading']);
    assert.equal(evaluate("document.querySelector('.ld-bookmark-sync button[type=\"submit\"]').getBoundingClientRect().right<=innerWidth").trim(), "true");
    run(["click", '[data-bookmark-action="disconnect-sync"]']);
    screenshot("bookmarks-confirm-mobile.png");
    run(["press", "Escape"]);
    wait("!document.querySelector('#ld-bookmark-confirm')");
    assert.equal(evaluate("!document.querySelector('.ld-bookmark-sync').hidden && !!storedBookmarks['ld-bookmarks-gist:7']").trim(), "true", "确认框 Esc 不应断开同步或关闭父面板");
    run(["click", '[data-bookmark-action="disconnect-sync"]']);
    answer();
    wait("!bookmarkTest.state.bookmarks.busy");
    assert.equal(evaluate("storedBookmarks['ld-bookmarks-gist:7']===null && !!storedBookmarks['ld-bookmarks-v1:7'].items['Post:124'] && !!window.testGist").trim(), "true");
    run(["press", "Escape"]);
    evaluate("document.querySelector('[data-folder-row=\"技术笔记\"]').scrollIntoView({block:'nearest',inline:'nearest'})");
    run(["click", '[data-folder-row="技术笔记"] summary']);
    wait("document.querySelector('[data-folder-row=\"技术笔记\"] [popover]').matches(':popover-open')");
    screenshot("bookmarks-folder-menu-mobile.png");
    assert.equal(evaluate("(() => { const r=document.querySelector('.ld-bookmark-folder-menu:popover-open').getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight; })()").trim(), "true");
    run(["click", '[data-folder-row="技术笔记"] [data-bookmark-action="rename-folder"]']);
    wait("!!document.querySelector('.ld-bookmark-folder-rename input')");
    screenshot("bookmarks-folder-rename-mobile.png");
    run(["fill", '.ld-bookmark-folder-rename input', "点外不保存"]);
    run(["click", '.ld-bookmark-heading']);
    wait("!document.querySelector('.ld-bookmark-folder-rename')");
    assert.equal(evaluate("storedBookmarks['ld-bookmarks-v1:7'].folders.includes('技术笔记') && !storedBookmarks['ld-bookmarks-v1:7'].folders.includes('点外不保存')").trim(), "true");
    assert.equal(evaluate("bookmarkTest.state.bookmarks.dialog.open").trim(), "true");
    run(["set", "viewport", "1280", "900"]);
    console.log("浏览器：清空/明亮高亮、分类排序/改名/类型区分、Gist 配置/创建/断开通过");
    run(["click", '[data-bookmark-action="new-folder"]']);
    evaluate("window.beforeLocalRequests=calls.length");
    run(["fill", '.ld-bookmark-folder-form input', "技术"]);
    run(["click", '.ld-bookmark-folder-form button[type="submit"]']);
    wait("!bookmarkTest.state.bookmarks.busy");
    assert.equal(evaluate("calls.length===beforeLocalRequests").trim(), "true", "新建收藏夹不应联网");
    assert.equal(evaluate("document.querySelector('.ld-bookmark-empty').textContent.includes('分类与备注')").trim(), "true");
    run(["click", '[data-bookmark-folder="*"]']);
    run(["click", '.ld-bookmark-item[data-key="Post:125"] [data-bookmark-action="edit"]']);
    assert.equal(evaluate("document.querySelector('.ld-bookmark-browse').hidden").trim(), "true");
    run(["select", '.ld-bookmark-editor select', "技术"]);
    run(["fill", '.ld-bookmark-editor input[name="tags"]', "教程，书签"]);
    run(["fill", '.ld-bookmark-editor textarea', "完整备注"]);
    run(["mouse", "move", "5", "5"]);
    run(["mouse", "down"]);
    run(["mouse", "up"]);
    answer(false);
    assert.equal(evaluate("bookmarkTest.state.bookmarks.dialog.open && !document.querySelector('.ld-bookmark-editor').hidden").trim(), "true", "点击背景不能丢弃未保存编辑");
    run(["click", '.ld-bookmark-back']);
    answer(false);
    assert.equal(evaluate("document.querySelector('.ld-bookmark-editor').hidden").trim(), "false");
    run(["click", '.ld-bookmark-editor button[type="submit"]']);
    wait("!bookmarkTest.state.bookmarks.busy");
    run(["fill", ".ld-bookmark-search", "完整备注"]);
    assert.equal(evaluate("document.querySelectorAll('.ld-bookmark-item').length").trim(), "1");
    assert.equal(evaluate("document.querySelector('.ld-bookmark-note mark').textContent").trim(), '"完整备注"');
    assert.equal(evaluate("document.querySelector('.ld-bookmark-topic-detail .ld-bookmark-excerpt').textContent.includes('实践')").trim(), "true", "备注命中不能替换主题摘要");
    run(["fill", ".ld-bookmark-search", ""]);
    run(["set", "viewport", "1440", "900"]);
    screenshot("bookmarks-desktop.png");
    run(["click", '.ld-bookmark-item[data-key="Post:125"] [data-bookmark-action="edit"]']);
    screenshot("bookmarks-editor.png");
    run(["fill", '.ld-bookmark-editor textarea', "不应保存的临时编辑"]);
    run(["mouse", "move", "5", "5"]);
    run(["mouse", "down"]);
    run(["mouse", "up"]);
    answer();
    wait("!bookmarkTest.state.bookmarks.dialog.open");
    evaluate("bookmarkTest.openBookmarkPanel()");
    assert.equal(evaluate("storedBookmarks['ld-bookmarks-v1:7'].items['Post:125'].note").trim(), '"完整备注"');
    run(["click", '.ld-bookmark-item[data-key="Post:125"] [data-bookmark-action="edit"]']);
    run(["press", "Escape"]);
    assert.equal(evaluate("bookmarkTest.state.bookmarks.dialog.open && document.querySelector('.ld-bookmark-editor').hidden").trim(), "true");
    run(["click", '[data-bookmark-folder="folder:技术"]']);
    run(["click", '[data-folder-row="技术"] summary']);
    wait("document.querySelector('[data-folder-row=\"技术\"] [popover]').matches(':popover-open')");
    run(["click", '[data-folder-row="技术"] [data-bookmark-action="delete-folder"]']);
    answer();
    wait("!bookmarkTest.state.bookmarks.busy");
    assert.equal(evaluate("storedBookmarks['ld-bookmarks-v1:7'].items['Post:125'].folder").trim(), '""');
    assert.equal(evaluate("calls.some(c=>c.method==='DELETE')").trim(), "false");
    console.log("浏览器：全部分页、末页搜索、文本安全、分类/标签/备注和删除分类保留原站书签通过");

    for (const width of [1280, 390]) {
      run(["set", "viewport", String(width), "700"]);
      console.log(evaluate(`(() => {
        const d=document.querySelector('#ld-bookmarks'), r=d.getBoundingClientRect();
        if(r.left<0||r.right>innerWidth||d.scrollWidth>d.clientWidth) throw Error('收藏面板横向溢出');
        const list=document.querySelector('.ld-bookmark-list').getBoundingClientRect();
        if(list.height<200 || list.top-r.top>innerHeight*0.48) throw Error('首屏收藏列表被管理控件挤占');
        const input=document.querySelector('.ld-bookmark-search'), wrap=input.parentElement.getBoundingClientRect();
        if(Math.abs(input.getBoundingClientRect().width-wrap.width)>2) throw Error('站点固定输入宽度污染搜索布局');
        return '收藏面板布局通过（${width}px）';
      })()`));
    }
    screenshot("bookmarks-mobile.png");
    run(["mouse", "move", "5", "5"]);
    run(["mouse", "down"]);
    run(["mouse", "up"]);
    wait("!bookmarkTest.state.bookmarks.dialog.open");
    console.log("浏览器：桌面/手机背景关闭、内部拖出保护、未保存确认及保存中保护通过");
    run(["click", '#ld-bookmarks-trigger']);
    wait("!bookmarkTest.state.bookmarks.loading");
    run(["click", '[data-bookmark-action="manage"]']);
    wait("!bookmarkTest.state.bookmarks.loading");
    assert.equal(evaluate("document.activeElement.matches('.ld-bookmark-close')").trim(), "true");
    run(["click", '.ld-bookmark-item[data-key="Post:125"] [data-bookmark-action="edit"]']);
    screenshot("bookmarks-editor-mobile.png");
    console.log(evaluate(`(() => {
      const editor=document.querySelector('.ld-bookmark-editor');
      for(const field of editor.querySelectorAll('input,select,textarea')) {
        if(field.getBoundingClientRect().width < editor.clientWidth-50) throw Error('站点固定输入宽度污染编辑表单');
      }
      const save=editor.querySelector('button[type="submit"]').getBoundingClientRect();
      const footer=document.querySelector('.ld-bookmark-status').getBoundingClientRect();
      if(save.bottom>footer.top || save.top<editor.getBoundingClientRect().top) throw Error('手机编辑页保存按钮不可见');
      return '浏览器：编辑独立视图、未保存提醒、主题样式隔离和首屏列表可见通过';
    })()`));
    run(["click", '.ld-bookmark-back']);
    assert.equal(evaluate("document.activeElement.classList.contains('ld-bookmark-list')").trim(), "true");
    run(["set", "viewport", "1440", "900"]);
    evaluate("document.documentElement.style.cssText='--primary:#e4e7ec;--secondary:#1d232a;--primary-low:#353e47;--tertiary:#79c7b2;--danger:#ef8e87;color-scheme:dark'");
    screenshot("bookmarks-dark.png");
    evaluate("document.documentElement.style.cssText=''");
    run(["select", ".ld-bookmark-sort", "oldest"]);
    assert.equal(evaluate("document.querySelector('.ld-bookmark-item').dataset.key").trim(), '"Post:101"');
    evaluate("document.querySelector('.ld-bookmark-list').scrollTop=300; window.savedListScroll=document.querySelector('.ld-bookmark-list').scrollTop");
    evaluate("document.querySelector('.ld-bookmark-item[data-key=\"Post:105\"] a').click()");
    wait("!!bookmarkTest.state.currentTopic");
    assert.equal(evaluate("bookmarkTest.state.currentUrl.endsWith('/5/6')").trim(), "true");
    run(["click", ".ld-drawer-close"]);
    wait("bookmarkTest.state.bookmarks.dialog.open && !bookmarkTest.state.bookmarks.loading");
    assert.equal(evaluate("document.querySelector('.ld-bookmark-list').scrollTop === window.savedListScroll").trim(), "true");
    run(["press", "Escape"]);
    wait("!bookmarkTest.state.bookmarks.dialog.open && document.activeElement.id === 'ld-bookmarks-trigger'");
    assert.equal(evaluate("document.activeElement.id").trim(), '"ld-bookmarks-trigger"');
    console.log("浏览器：排序、预览楼层、返回保留位置与 Esc/焦点恢复通过");

    evaluate("window.failPage=true");
    evaluate("bookmarkTest.openBookmarkPanel('',true)");
    assert.equal(evaluate("bookmarkTest.state.bookmarks.complete").trim(), "false");
    assert.equal(evaluate("document.querySelector('.ld-bookmark-tools').disabled").trim(), "true");
    evaluate("window.failPage=false; window.badPage=true; bookmarkTest.openBookmarkPanel('',true)");
    assert.equal(evaluate("bookmarkTest.state.bookmarks.complete").trim(), "false");
    evaluate("window.badPage=false; bookmarkTest.openBookmarkPanel('',true)");
    evaluate("document.querySelector('[data-bookmark-action=\"edit\"]').click()");
    evaluate("window.failDelete=true; document.querySelector('[data-bookmark-action=\"remove\"]').click()");
    wait("!bookmarkTest.state.bookmarks.busy");
    assert.equal(evaluate("bookmarkTest.state.bookmarks.items.length").trim(), "25");
    evaluate("window.failDelete=false; document.querySelector('[data-bookmark-action=\"remove\"]').click()");
    wait("!bookmarkTest.state.bookmarks.busy");
    assert.equal(evaluate("bookmarkTest.state.bookmarks.items.length").trim(), "24");
    console.log("浏览器：分页失败、跨域分页拒绝、取消收藏失败/成功通过");

    evaluate(`(() => {
      const originalUrl=URL.createObjectURL, originalClick=HTMLAnchorElement.prototype.click;
      URL.createObjectURL=blob=>{window.exportedBookmarkBlob=blob;return originalUrl(blob);};
      HTMLAnchorElement.prototype.click=function(){if(!this.download)originalClick.call(this);};
      document.querySelector('[data-bookmark-action="export"]').click();
    })()`);
    wait("!bookmarkTest.state.bookmarks.busy");
    console.log(evaluate(`(async()=>{
      const backup=JSON.parse(await window.exportedBookmarkBlob.text());
      if(backup.userId!==7 || backup.data.items['Post:125'].note!=='完整备注' || backup.bookmarks) throw Error('备份内容错误');
      backup.data.folders.push('导入分类');
      backup.data.items['Post:122']={folder:'导入分类',tags:['备份'],note:'导入备注'};
      const transfer=new DataTransfer(); transfer.items.add(new File([JSON.stringify(backup)],'backup.json',{type:'application/json'}));
      const input=document.querySelector('.ld-bookmark-import');input.files=transfer.files;input.dispatchEvent(new Event('change'));
      return '浏览器：导出包含账号和整理数据，不包含原站正文或书签';
    })()`));
    wait("!bookmarkTest.state.bookmarks.busy");
    assert.equal(evaluate("bookmarkTest.state.bookmarks.data.items['Post:122'].note").trim(), '"导入备注"');
    evaluate(`(() => {
      window.beforeInvalidImport=JSON.stringify(window.storedBookmarks);
      const transfer=new DataTransfer();transfer.items.add(new File(['{broken'],'broken.json'));
      const input=document.querySelector('.ld-bookmark-import');input.files=transfer.files;input.dispatchEvent(new Event('change'));
    })()`);
    wait("!bookmarkTest.state.bookmarks.busy");
    assert.equal(evaluate("JSON.stringify(window.storedBookmarks) === window.beforeInvalidImport").trim(), "true");
    console.log("浏览器：导出/导入往返、损坏文件不覆盖已有数据通过");

    console.log(evaluate(`(async () => {
      const api=bookmarkTest;
      const post={id:126,post_number:1,username:'tester',cooked:'<p>新收藏正文</p>'};
      const card=api.buildPostCard(post), button=card.querySelector('[data-bookmark-post-id]');
      api.state.bookmarks.busy=true;
      await api.handlePostBookmark(button,post,'test-session');
      if(post.bookmarked) throw Error('分类保存时不应并行创建书签');
      api.state.bookmarks.busy=false;
      await api.handlePostBookmark(button,post,'test-session');
      if(!post.bookmarked || post.bookmark_id!==300 || button.getAttribute('aria-pressed')!=='true' || card.querySelector('.ld-post-bookmark-edit')) throw Error('创建书签状态错误');
      const existing={id:102,post_number:3,username:'tester',cooked:'<p>已有收藏</p>',bookmarked:true};
      const existingCard=api.buildPostCard(existing), existingButton=existingCard.querySelector('[data-bookmark-post-id]');
      const before=window.calls.filter(c=>c.method==='POST').length;
      await api.handlePostBookmark(existingButton,existing,'test-session');
      if(existing.bookmarked || window.calls.filter(c=>c.method==='POST').length!==before || window.bookmarks.some(item=>item.id===2)) throw Error('缺少bookmark_id时重复创建书签');
      return '浏览器：楼层创建、整理入口和已有书签缺少 id 时正确取消通过';
    })()`));

    run(["press", "Escape"]);
    evaluate("bookmarkTest.openDrawer('https://linux.do/t/topic/27/1','选择收藏夹',null)");
    wait("bookmarkTest.state.currentTopic?.id===27");
    wait("document.getAnimations().every(animation=>animation.playState!=='running')");
    assert.equal(evaluate("!document.querySelector('.ld-post-bookmark-edit') && document.querySelector('.ld-topic-bookmark button').dataset.bookmarkPostId==='127'").trim(), "true");
    screenshot("bookmarks-topic-header.png");
    evaluate("document.querySelector('.ld-post-card [data-bookmark-post-id]').dispatchEvent(new PointerEvent('pointerenter',{pointerType:'touch'}))");
    assert.equal(evaluate("!bookmarkTest.state.bookmarks.pickerTarget").trim(), "true");
    run(["focus", '.ld-drawer-close']);
    evaluate("window.beforeHoverWrites=calls.filter(c=>c.method!=='GET').length");
    run(["hover", '.ld-post-card [data-bookmark-post-id]']);
    wait("!!document.querySelector('#ld-bookmark-picker [data-bookmark-pick-folder=\"技术笔记\"]')");
    assert.equal(evaluate("document.activeElement.matches('.ld-drawer-close') && !bookmarkTest.state.bookmarks.pickerPinned && calls.filter(c=>c.method!=='GET').length===window.beforeHoverWrites").trim(), "true");
    run(["hover", '#ld-bookmark-picker']);
    assert.equal(evaluate("document.querySelector('#ld-bookmark-picker').matches(':popover-open')").trim(), "true");
    run(["hover", '.ld-drawer-title']);
    wait("!document.querySelector('#ld-bookmark-picker').matches(':popover-open')");
    run(["focus", '.ld-post-card [data-bookmark-post-id]']);
    run(["press", 'Enter']);
    wait("bookmarkTest.state.bookmarks.pickerPinned && !!document.querySelector('#ld-bookmark-picker [data-bookmark-pick-folder=\"技术笔记\"]')");
    run(["hover", '.ld-drawer-title']);
    assert.equal(evaluate("document.querySelector('#ld-bookmark-picker').matches(':popover-open')").trim(), "true");
    run(["press", 'Escape']);
    evaluate("window.delayPage=true; void bookmarkTest.openBookmarkPanel('',true,true)");
    wait("bookmarkTest.state.bookmarks.loading");
    run(["click", '.ld-topic-bookmark button']);
    wait("!!document.querySelector('#ld-bookmark-picker [data-bookmark-pick-folder=\"技术笔记\"]')");
    assert.equal(evaluate("!bookmarkTest.state.bookmarks.dialog.open && !bookmarkTest.state.bookmarks.loading").trim(), "true");
    evaluate("window.delayPage=false");
    screenshot("bookmarks-picker-desktop.png");
    evaluate("window.beforePicker=JSON.stringify(storedBookmarks); window.failCreate=true");
    run(["click", '#ld-bookmark-picker [data-bookmark-pick-folder="技术笔记"]']);
    wait("!bookmarkTest.state.bookmarks.busy");
    assert.equal(evaluate("JSON.stringify(storedBookmarks)===window.beforePicker && !bookmarkTest.state.currentTopic.post_stream.posts[0].bookmarked").trim(), "true");
    evaluate("window.failCreate=false; window.failWrite=true");
    run(["click", '#ld-bookmark-picker [data-bookmark-pick-folder="技术笔记"]']);
    wait("!bookmarkTest.state.bookmarks.busy");
    assert.equal(evaluate("bookmarkTest.state.currentTopic.post_stream.posts[0].bookmarked && document.querySelector('.ld-bookmark-picker-status').textContent.includes('分类保存失败') && JSON.stringify(storedBookmarks)===window.beforePicker").trim(), "true");
    evaluate("window.failWrite=false; window.pickerPosts=calls.filter(c=>c.method==='POST').length");
    run(["fill", '#ld-bookmark-picker input', "直接新建"]);
    run(["click", '#ld-bookmark-picker button[type="submit"]']);
    wait("!bookmarkTest.state.bookmarks.busy");
    assert.equal(evaluate("storedBookmarks['ld-bookmarks-v1:7'].items['Post:127'].folder==='直接新建' && calls.filter(c=>c.method==='POST').length===window.pickerPosts && !document.querySelector('#ld-bookmark-picker').matches(':popover-open') && [...document.querySelectorAll('[data-bookmark-post-id=\"127\"]')].every(button=>button.getAttribute('aria-pressed')==='true')").trim(), "true");
    wait("!bookmarkTest.state.bookmarks.refreshController && bookmarkTest.state.bookmarks.cacheAt>0 && bookmarkTest.state.bookmarks.items.some(item=>item.key==='Post:127')");
    evaluate("storedBookmarks['ld-bookmarks-v1:7'].items['Post:127'].note='保留备注'");
    run(["focus", '.ld-drawer-close']);
    run(["hover", '.ld-post-card [data-bookmark-post-id]']);
    wait("!!document.querySelector('#ld-bookmark-picker [data-bookmark-pick-folder=\"直接新建\"]')");
    assert.equal(evaluate("document.querySelector('.ld-bookmark-picker-status').textContent==='当前收藏夹：直接新建' && document.querySelector('#ld-bookmark-picker [data-bookmark-pick-folder=\"直接新建\"]').getAttribute('aria-pressed')==='true'").trim(), "true");
    screenshot("bookmarks-picker-current.png");
    assert.equal(evaluate(`(() => {
      const current=document.querySelector('#ld-bookmark-picker [aria-pressed="true"]').getBoundingClientRect();
      const list=document.querySelector('.ld-bookmark-picker-folders').getBoundingClientRect();
      return current.top>=list.top-1 && current.bottom<=list.bottom+1;
    })()`).trim(), "true", "悬停后当前分类必须在列表可见区域");
    evaluate("document.querySelector('#ld-bookmark-picker [data-bookmark-pick-folder=\"生活指南\"]').scrollIntoView({block:'nearest'})");
    run(["click", '#ld-bookmark-picker [data-bookmark-pick-folder="生活指南"]']);
    wait("!bookmarkTest.state.bookmarks.busy");
    assert.equal(evaluate("storedBookmarks['ld-bookmarks-v1:7'].items['Post:127'].folder==='生活指南' && storedBookmarks['ld-bookmarks-v1:7'].items['Post:127'].note==='保留备注' && calls.filter(c=>c.method==='POST').length===window.pickerPosts").trim(), "true");
    evaluate("document.querySelectorAll('.ld-toast-close').forEach(button=>button.click())");
    wait("!document.querySelector('.ld-toast-dismissible')");
    run(["set", "viewport", "390", "700"]);
    wait("document.getAnimations().every(animation=>animation.playState!=='running')");
    screenshot("bookmarks-topic-header-mobile.png");
    run(["click", '.ld-post-card [data-bookmark-post-id]']);
    wait("!!document.querySelector('#ld-bookmark-picker [data-bookmark-pick-folder=\"生活指南\"]')");
    screenshot("bookmarks-picker-mobile.png");
    console.log(evaluate(`(() => {
      const r=document.querySelector('#ld-bookmark-picker').getBoundingClientRect();
      if(r.left<0 || r.right>innerWidth || r.top<0 || r.bottom>innerHeight) throw Error('收藏夹选择器窄屏溢出');
      const save=document.querySelector('#ld-bookmark-picker button[type="submit"]').getBoundingClientRect();
      if(save.bottom>r.bottom || save.top<r.top) throw Error('新建并收藏按钮被列表挤出可见区域');
      return '浏览器：就地选择/新建/移动、原站失败、本地失败后重试不重复收藏及窄屏通过';
    })()`));
    run(["press", "Escape"]);
    assert.equal(evaluate("!document.querySelector('#ld-bookmark-picker').matches(':popover-open') && document.activeElement.matches('[data-bookmark-post-id]')").trim(), "true");
    run(["click", '#ld-bookmarks-trigger']);
    wait("bookmarkTest.state.bookmarks.complete && !bookmarkTest.state.bookmarks.loading");
    assert.equal(evaluate("!!document.querySelector('.ld-bookmark-item[data-key=\"Post:127\"]')").trim(), "true");
    run(["press", "Escape"]);
    run(["click", '.ld-topic-bookmark button']);
    wait("!document.querySelector('.ld-bookmark-picker-remove').hidden");
    evaluate("window.beforeCancel=calls.filter(c=>c.method==='DELETE').length");
    run(["click", '.ld-bookmark-picker-remove']);
    wait("!bookmarkTest.state.bookmarks.busy");
    assert.equal(evaluate("[...document.querySelectorAll('[data-bookmark-post-id=\"127\"]')].every(button=>button.getAttribute('aria-pressed')==='false') && calls.filter(c=>c.method==='DELETE').length===window.beforeCancel+1").trim(), "true");
    wait("!bookmarkTest.state.bookmarks.refreshController && bookmarkTest.state.bookmarks.cacheAt>0 && !bookmarkTest.state.bookmarks.items.some(item=>item.key==='Post:127')");
    run(["click", '.ld-post-card [data-bookmark-post-id]']);
    wait("document.querySelector('#ld-bookmark-picker').matches(':popover-open')");
    evaluate("bookmarkTest.openDrawer('https://linux.do/t/topic/28/1','切换主题',null)");
    wait("bookmarkTest.state.currentTopic?.id===28");
    assert.equal(evaluate("!document.querySelector('#ld-bookmark-picker').matches(':popover-open') && !bookmarkTest.state.bookmarks.pickerTarget").trim(), "true");
    assert.equal(evaluate("document.querySelector('.ld-topic-bookmark button').dataset.bookmarkPostId").trim(), '"128"');
    for (const width of [1280,390]) {
      run(["set", "viewport", String(width), "700"]);
      wait("document.getAnimations().every(animation=>animation.playState!=='running')");
      assert.equal(evaluate(`(() => {
        const title=bookmarkTest.state.title; window.savedBookmarkTitle=title.textContent;
        title.textContent='很长的帖子标题'.repeat(40);
        const icon=document.querySelector('.ld-topic-bookmark button').getBoundingClientRect(), group=title.parentElement.getBoundingClientRect();
        title.textContent=window.savedBookmarkTitle;
        return icon.width>0 && icon.right<=group.right+1 && icon.left>=title.getBoundingClientRect().left;
      })()`).trim(), "true", "长标题不能挤掉收藏按钮");
    }
    run(["click", '.ld-drawer-settings-toggle']);
    run(["select", '[data-setting="enhancedBookmarks"]', "off"]);
    evaluate("window.beforeDisabledRefresh=calls.length; bookmarkTest.refreshBookmarkCache()");
    assert.equal(evaluate("calls.length===beforeDisabledRefresh").trim(), "true", "关闭增强收藏后停止自动请求");
    assert.equal(evaluate("document.querySelector('#ld-bookmarks-trigger').hidden && getComputedStyle(document.querySelector('#ld-bookmarks-trigger')).display==='none' && document.querySelector('.ld-topic-bookmark').hidden && !bookmarkTest.state.bookmarks.dialog.open && JSON.parse(localStorage.getItem('ld-drawer-settings-v1')).enhancedBookmarks==='off'").trim(), "true");
    evaluate("document.querySelector('.ld-toast-stack').replaceChildren(); document.querySelector('[data-setting=\"enhancedBookmarks\"]').scrollIntoView({block:'center'})");
    screenshot("bookmarks-settings-mobile.png");
    run(["set", "viewport", "1280", "900"]);
    evaluate("document.querySelector('[data-setting=\"enhancedBookmarks\"]').scrollIntoView({block:'center'})");
    screenshot("bookmarks-settings-desktop.png");
    run(["click", '.ld-drawer-settings-toggle']);
    run(["hover", '.ld-post-card [data-bookmark-post-id]']);
    assert.equal(evaluate("!document.querySelector('#ld-bookmark-picker').matches(':popover-open')").trim(), "true");
    evaluate("window.beforeBasic=calls.length; window.basicPost=bookmarkTest.state.currentTopic.post_stream.posts[0]; basicPost.bookmarked=false; basicPost.bookmark_id=null");
    run(["click", '.ld-post-card [data-bookmark-post-id]']);
    wait("!bookmarkTest.state.bookmarks.busy");
    assert.equal(evaluate("basicPost.bookmarked && calls.slice(beforeBasic).filter(c=>c.method==='POST').length===1 && !document.querySelector('#ld-bookmark-picker').matches(':popover-open')").trim(), "true");
    run(["click", '.ld-post-card [data-bookmark-post-id]']);
    wait("!bookmarkTest.state.bookmarks.busy");
    assert.equal(evaluate("!basicPost.bookmarked && calls.slice(beforeBasic).filter(c=>c.method==='DELETE').length===1 && !document.querySelector('#ld-bookmark-confirm')").trim(), "true");
    run(["click", '.ld-drawer-settings-toggle']);
    run(["select", '[data-setting="enhancedBookmarks"]', "on"]);
    assert.equal(evaluate("!document.querySelector('#ld-bookmarks-trigger').hidden && !document.querySelector('.ld-topic-bookmark').hidden").trim(), "true");
    run(["click", '.ld-drawer-settings-toggle']);
    console.log("浏览器：本地整理零请求、一小时缓存/自动刷新/变更更新、自定义确认、增强开关与直接收藏通过");
    run(["network", "route", "https://linux.do/t/topic/99/1", "--body", "<!doctype html><p>固定整页回退</p>"]);
    evaluate("bookmarkTest.state.settings.previewMode='iframe'; bookmarkTest.openDrawer('https://linux.do/t/topic/99/1','整页回退',null)");
    assert.equal(evaluate("document.querySelector('.ld-topic-bookmark').hidden && !document.querySelector('.ld-topic-bookmark button')").trim(), "true");
    evaluate("bookmarkTest.state.settings.previewMode='auto'");
    run(["click", ".ld-drawer-close"]);
    assert.equal(evaluate("!document.querySelector('.ld-topic-bookmark button')").trim(), "true");
    console.log("浏览器：仅图标、悬停无写入/不抢焦点、点击固定、当前收藏夹及标题/首帖收藏同步通过");

    evaluate("window.testUserId=8; document.querySelector('meta[name=\"csrf-token\"]').content='account-8'; bookmarkTest.openBookmarkPanel()");
    assert.equal(evaluate("document.querySelectorAll('.ld-bookmark-item').length").trim(), "0");
    assert.equal(evaluate("bookmarkTest.state.bookmarks.data.folders.length").trim(), "0");
    evaluate("window.testUserId=7; document.querySelector('meta[name=\"csrf-token\"]').content='test-session'; bookmarkTest.openBookmarkPanel()");
    evaluate("window.denyLogin=true; document.querySelector('#current-user').remove(); bookmarkTest.openBookmarkPanel()");
    assert.equal(evaluate("document.querySelectorAll('.ld-bookmark-item').length").trim(), "0");
    assert.equal(evaluate("document.querySelector('.ld-bookmark-tools').hidden").trim(), "true");
    evaluate("window.denyLogin=false; window.delayPage=true; bookmarkTest.openBookmarkPanel('',true); bookmarkTest.state.bookmarks.dialog.close()");
    wait("!bookmarkTest.state.bookmarks.loading");
    assert.equal(evaluate("bookmarkTest.state.bookmarks.dialog.open").trim(), "false");
    console.log("浏览器：账号切换、未登录不泄露旧列表、关闭取消请求通过");
  } finally {
    run(["close"]);
  }
}

(async () => {
  await checkStorage(false);
  await checkStorage(true);
  if (process.argv.includes("--browser")) checkBrowser();
})().catch(error => { console.error(error); process.exitCode = 1; });
