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
const evaluate = code => run(["eval", "--stdin"], code);
const source = fs.readFileSync(path.join(__dirname, "../src/content.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "../src/content.css"), "utf8");
const html = '<!doctype html><meta charset="utf-8"><meta name="csrf-token" content="test-csrf"><title>树形固定页面</title><div id="current-user"></div>' +
  '<main id="main-outlet"><a class="title" href="/t/test/1">对话测试主题</a><a class="title" href="/t/test/2">另一个主题</a></main>';
const shot = name => {
  if (process.env.SIDEPEEK_SCREENSHOT_DIR) run(["screenshot", path.join(process.env.SIDEPEEK_SCREENSHOT_DIR, name + ".png")]);
};

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
      id:100+number, topic_id:1, post_number:number, username:'user'+number, name:'用户 '+number,
      created_at:'2026-01-01T00:00:00Z', reply_to_post_number:parent, reply_to_user:parent ? {username:'user'+parent} : null,
      reply_count:count, cooked:'<p>第 '+number+' 楼正文：在这里连续阅读对话，保留清晰的回复关系。</p><p><a href="https://linux.do/latest">正文链接</a></p>', actions_summary:[]
    });
    window.replyTopic = {id:1,title:'树形对话测试主题',posts_count:9,
      post_stream:{posts:[makePost(1,null,1),makePost(2,1,3),makePost(5,3),makePost(9,null,1)],
        stream:[101,102,103,104,105,106,107,109,111]}};
    window.fetch = async (input, options = {}) => {
      const url = new URL(input, location.href);
      const request = {path:url.pathname, after:url.searchParams.get('after'), topLevel:url.searchParams.get('filter_top_level_replies'), options};
      replyRequests.push(request);
      const json = data => new Response(JSON.stringify(data), {headers:{'content-type':'application/json'}});
      if (url.pathname === '/topics/timings') return json({});
      if (url.pathname.startsWith('/posts/')) {
        if (replyPending && url.pathname === '/posts/109/replies') return new Promise(resolve => {request.resolve=resolve;});
        if (replyFail && url.pathname === '/posts/109/replies') return new Response('{}',{status:503,headers:{'content-type':'application/json'}});
        if (url.pathname === '/posts/by_number/1/3') return json(makePost(3,2,2));
        if (url.pathname === '/posts/102/replies') return json(request.after === '1' ? [makePost(3,2,2)] : request.after === '3' ? [makePost(3,2,2),makePost(6,2)] : [makePost(6,2),makePost(7,2)]);
        if (url.pathname === '/posts/103/replies') return json([makePost(4,3,1),makePost(5,3)]);
        if (url.pathname === '/posts/104/replies') return json([makePost(8,4,1)]);
        if (url.pathname === '/posts/108/replies') return json([makePost(10,8)]);
        return json([]);
      }
      if (url.pathname.endsWith('/posts.json')) return json({post_stream:{posts:[makePost(11)]}});
      if (request.topLevel === 'true') return json({...replyTopic,post_stream:{posts:[makePost(2,1,3),makePost(9,null,1)],stream:[102,109,111]}});
      return json(replyTopic);
    };
    const style = document.createElement('style'); style.textContent=${JSON.stringify(css)};document.head.append(style);
    ${source.replace(/^  init\(\);$/m, "  init(); globalThis.replyTest = { state, getVisibleReadingPosts, appendLoadedPostsIncrementally, tickReading, flushReading, loadSettings, resetSettings, navigateToPost, loadTopic, buildTopicViewModel, appendCreatedReplyToCurrentTopic, refreshCurrentView, loadVisibleInlineReplies }; ")}
    window.check = (value,message) => {if (!value) throw Error(message);};
    window.settle = async () => {
      await new Promise(r=>setTimeout(r,60));
      for (let i=0;(replyTest.state.inlineReplyControllers.size || replyTest.state.abortController || replyTest.state.isLoadingMorePosts) && i<300;i++) await new Promise(r=>setTimeout(r,10));
      await new Promise(r=>setTimeout(r,60));
      check(!replyTest.state.inlineReplyControllers.size && !replyTest.state.abortController, '请求未结束');
    };
    window.bringTree = async number => {
      const node=replyTest.state.content.querySelector('[data-thread-post-number="'+number+'"]');
      check(node,'缺少楼层 '+number);node.scrollIntoView({block:'center'});await settle();
    };
    window.changeMode = async value => {
      const control=replyTest.state.settingsPanel.querySelector('[data-setting="replyDisplay"]');
      control.value=value;control.dispatchEvent(new Event('change',{bubbles:true}));await settle();
    };
  })()`);
  run(["click", '#main-outlet a[href="/t/test/1"]']);
  run(["wait", "--fn", "!!document.querySelector('.ld-post-card[data-post-number=\"2\"]') && !replyTest.state.abortController"]);
  console.log(evaluate(`(async () => {
    const s=replyTest.state;
    check(replyRequests.some(r=>r.topLevel==='true'), '没有请求顶层过滤');
    check(s.content.querySelector('.ld-post-card[data-post-number="1"]'), '过滤丢失首帖');
    check(!s.content.querySelector('.ld-post-card[data-post-number="5"]'), '子回复仍在主列表重复');
    check(!s.content.querySelector('.ld-post-card[data-post-number="1"] .ld-inline-thread'), '首帖下重复展示顶层回复');
    const root=s.content.querySelector('.ld-post-card[data-post-number="2"]');
    const region=root.querySelector(':scope > .ld-inline-thread');
    await bringTree(2);
    check(!region.hidden && region.querySelector('.ld-inline-post'), '树形没有默认展开');
    check(!s.content.querySelector('.ld-reading-mode') && !s.content.querySelector('.ld-inline-collapse') && !root.querySelector('.ld-post-info-item--replies-trigger'), '正文仍有切换或展开/收起按钮');
    const child=region.querySelector('.ld-inline-post');
    check(child.querySelector('.ld-post-body').textContent.includes('第 3 楼正文'), '没有完整正文');
    const link=child.querySelector('.ld-post-body a');
    check(link.target==='_blank' && link.rel==='noopener noreferrer','正文链接属性丢失');
    check(!child.querySelector('.ld-parent-preview'), '树中重复插入父帖');
    await bringTree(3);
    check(child.querySelectorAll(':scope > .ld-inline-thread > .ld-inline-post').length===2,'子树未展开');
    check(s.content.querySelectorAll('[data-thread-post-number="5"]').length===1,'第5楼重复展示');
    region.querySelector(':scope > .ld-inline-more').click();await settle();
    check(region.querySelectorAll(':scope > .ld-inline-post').length===2,'第二页重复');
    region.querySelector(':scope > .ld-inline-more').click();await settle();
    check(region.querySelectorAll(':scope > .ld-inline-post').length===3 && !region.querySelector(':scope > .ld-inline-more'),'第三页重复或不停');
    check(replyRequests.some(r=>r.path==='/posts/102/replies' && r.after==='3'),'游标错误');
    const next={...s.currentTopic,post_stream:{...s.currentTopic.post_stream,posts:[...s.currentTopic.post_stream.posts,makePost(6,2)]}};
    replyTest.appendLoadedPostsIncrementally(next,[makePost(6,2)],s.drawerBody.scrollTop);
    check(!s.content.querySelector('.ld-post-card[data-post-number="6"]'),'分页重新插入子回复');
    let located=false;region.querySelector('.ld-inline-post').scrollIntoView=()=>{located=true;};
    region.querySelector('.ld-inline-locate').click();check(located,'树内定位失败');
    const before=replyRequests.filter(r=>r.path==='/posts/102/replies').length;
    replyTest.refreshCurrentView();await settle();await bringTree(3);
    check(replyRequests.filter(r=>r.path==='/posts/102/replies').length===before,'重绘重复加载已缓存回复');
    const liveRegion=s.content.querySelector('.ld-post-card[data-post-number="2"] > .ld-inline-thread');
    const body=liveRegion.querySelector('.ld-post-body');body.innerHTML='<p style="height:700px">只读子楼</p>';body.scrollIntoView({block:'start'});
    check(replyTest.getVisibleReadingPosts().has(3) && !replyTest.getVisibleReadingPosts().has(2),'阅读误记父楼');
    s.reading.timings.clear();s.reading.totals.clear();s.reading.onscreen=new Set([3]);s.reading.lastTick=performance.now()-1000;
    s.reading.lastFlush=s.reading.lastActivity=performance.now();replyTest.tickReading();replyTest.flushReading(s.reading);
    await new Promise(r=>setTimeout(r,20));
    const report=new URLSearchParams(replyRequests.filter(r=>r.path==='/topics/timings').at(-1)?.options.body);
    check(report.has('timings[3]') && !report.has('timings[2]'),'上报误记父楼');body.innerHTML=makePost(3).cooked;
    s.directReplyCache.delete(9);replyFail=true;replyTest.refreshCurrentView();await bringTree(9);
    const other=s.content.querySelector('.ld-post-card[data-post-number="9"]');
    check(other.textContent.includes('加载失败'),'失败无提示');
    replyFail=false;Array.from(other.querySelectorAll('button')).find(b=>b.textContent==='重试').click();await settle();
    check(other.textContent.includes('暂无可显示'),'无法重试');s.directReplyCache.delete(9);
    replyPending=true;replyTest.refreshCurrentView();
    await new Promise(r=>setTimeout(r,80));
    s.content.querySelector('.ld-post-card[data-post-number="9"]').scrollIntoView();await new Promise(r=>setTimeout(r,80));
    const closing=replyRequests.findLast(r=>r.path==='/posts/109/replies' && r.resolve);
    check(closing,'未触发可见分支请求');document.querySelector('.ld-drawer-close').click();
    check(closing.options.signal.aborted,'关闭未取消');closing.resolve(new Response('[]',{headers:{'content-type':'application/json'}}));await settle();
    check(!s.directReplyCache.size && !s.inlineReplyObservers.size,'关闭后旧响应回写或观察器未释放');replyPending=false;
    return '顶层过滤、首帖保留、子树无重复、分页、定位、自动展开/缓存、阅读上报及失败重试/关闭取消：通过';
  })()`).trim());
  run(["click", '#main-outlet a[href="/t/test/1"]']);
  run(["wait", "--fn", "!!replyTest.state.currentTopic && !replyTest.state.abortController"]);
  console.log(evaluate(`(async () => {
    const s=replyTest.state;
    s.replyParentCache.clear();s.directReplyCache.clear();
    s.settings.postMode='first';replyTest.navigateToPost(5);await settle();await new Promise(r=>setTimeout(r,100));await settle();
    check(replyRequests.some(r=>r.path==='/posts/by_number/1/3'),'深链接未补祖先');
    check(s.content.querySelectorAll('[data-thread-post-number="5"]').length===1,'目标重复或没有展开');
    check(s.content.querySelector('[data-thread-post-number="2"] [data-thread-post-number="3"] [data-thread-post-number="5"]'),'目标不在祖先树中');
    check(!s.content.querySelector('.ld-post-card[data-post-number="5"]'),'定位临时插入重复主楼');s.settings.postMode='all';
    const parentRegion=s.content.querySelector('[data-thread-post-number="3"] > .ld-inline-thread');
    parentRegion.querySelector('.ld-inline-more').click();await settle();
    check(s.content.querySelectorAll('[data-thread-post-number="5"]').length===1,'目标路径补分页后重复');
    s.settings.authorFilter='topicOwner';
    const ownerTopic={...s.currentTopic,created_by:{username:'user5'}};
    check(replyTest.buildTopicViewModel(ownerTopic,null,null).posts.some(p=>p.post_number===5),'只看楼主漏掉子回复');
    s.settings.authorFilter='all';
    const vm=replyTest.buildTopicViewModel(s.currentTopic,null,{targetPostNumber:5});
    check(vm.posts.every(p=>p.post_number===1 || !(p.reply_to_post_number>1)),'视图模型未过滤');
    s.directReplyCache.delete(9);replyPending=true;replyTest.refreshCurrentView();
    await new Promise(r=>setTimeout(r,80));s.content.querySelector('.ld-post-card[data-post-number="9"]').scrollIntoView();await new Promise(r=>setTimeout(r,80));
    const switching=replyRequests.findLast(r=>r.path==='/posts/109/replies' && r.resolve && !r.options.signal.aborted);check(switching,'切换前没有可见分支请求');await changeMode('legacy');
    check(switching.options.signal.aborted,'切换未取消请求');switching.resolve(new Response('[]',{headers:{'content-type':'application/json'}}));await settle();replyPending=false;
    check(!s.directReplyCache.has(9),'切换后旧响应回写');
    check(s.content.querySelector('.ld-post-card[data-post-number="5"]'),'普通模式丢失子楼');
    check(!s.content.querySelector('.ld-inline-thread'),'普通模式保留树节点');
    const root=s.content.querySelector('.ld-post-card[data-post-number="2"]');const trigger=root.querySelector('.ld-post-info-item--replies-trigger');
    trigger.click();await settle();const popover=root.querySelector('.ld-post-replies-popover');
    check(!popover.hidden && popover.querySelector('.ld-post-reply-preview-jump') && !popover.querySelector('.ld-post-body'),'普通摘要浮层失效');
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));check(popover.hidden,'Esc未关浮层');
    check(replyTest.loadSettings().replyDisplay==='legacy','模式未保存');
    await changeMode('inline');check(s.content.querySelector('[data-thread-post-number="5"]'),'切回后定位丢失');
    await changeMode('legacy');replyTest.resetSettings();await settle();
    check(s.settings.replyDisplay==='inline' && replyTest.loadSettings().replyDisplay==='inline','恢复默认失败');
    const saved=localStorage.getItem('ld-drawer-settings-v1');localStorage.setItem('ld-drawer-settings-v1','{"replyDisplay":"bad"}');
    check(replyTest.loadSettings().replyDisplay==='inline','非法值未回退');localStorage.setItem('ld-drawer-settings-v1',saved);
    await replyTest.appendCreatedReplyToCurrentTopic(makePost(12,5));await settle();
    check(s.content.querySelector('[data-thread-post-number="5"] [data-thread-post-number="12"]'),'发送后未展开新回复');
    check(s.content.querySelectorAll('[data-thread-post-number="12"]').length===1,'新回复重复');
    return '深链接祖先补取/展开、路径分页去重、普通模式/设置切换及发送后子树显示：通过';
  })()`).trim());
  evaluate(`replyTest.state.currentUrl='https://linux.do/t/test/1';replyTest.state.currentResolvedTargetPostNumber=null;replyTest.state.topicCache.clear();replyTest.state.directReplyCache.clear();`);
  console.log(evaluate(`(async () => {await replyTest.loadTopic('https://linux.do/t/test/1','测试',1);await settle();const s=replyTest.state;
    s.settings.replyOrder='latestFirst';const vm=replyTest.buildTopicViewModel(s.currentTopic,{post_stream:{posts:[makePost(9),makePost(5,3),makePost(2,1)]}},null);
    check(vm.posts[0].post_number===1 && vm.posts.some(p=>p.post_number===9) && !vm.posts.some(p=>p.post_number===5),'最新树形过滤或首帖错误');
    s.settings.replyOrder='default';s.drawerBody.scrollTop=s.drawerBody.scrollHeight;s.drawerBody.dispatchEvent(new Event('scroll'));await settle();
    check(s.content.querySelector('.ld-post-card[data-post-number="11"]'),'根流分页没有追加顶层');
    await bringTree(2);await bringTree(3);
    return '最新树形过滤和根流分页：通过';})()`).trim());
  evaluate(`replyTest.state.toastStack.querySelectorAll('.ld-toast-close').forEach(b=>b.click())`);
  for (const [width,height] of [[1280,800],[390,844],[320,740]]) {
    run(["set", "viewport", String(width), String(height)]);
    evaluate(`(async()=>{for(const n of [3,4,8]) await bringTree(n);replyTest.state.drawerBody.scrollTop=0;})()`);
    console.log(evaluate(`(() => {const s=replyTest.state;const rect=s.root.getBoundingClientRect();
      for(const node of s.content.querySelectorAll('.ld-inline-post,.ld-post-number,.ld-post-reply-button')) {
        if(!node.getClientRects().length) continue;const box=node.getBoundingClientRect();
        check(box.left>=rect.left && box.right<=rect.right+1,'帖子或按钮溢出');
      }
      const nested=s.content.querySelector('[data-thread-post-number="10"]');check(nested && nested.getBoundingClientRect().width>180,'深层正文过窄');
      const level3=s.content.querySelector('[data-thread-post-number="8"]');check(level3.getBoundingClientRect().width-nested.getBoundingClientRect().width<4,'深层缩进没有停止');
      return '树形/按钮边界：通过（${width}px）';})()`).trim());
    shot(`tree-${width}`);
    evaluate(`replyTest.state.content.querySelector('.ld-inline-post .ld-inline-post').scrollIntoView({block:'center'})`);shot(`tree-nested-${width}`);
    evaluate(`(async()=>{await changeMode('legacy');replyTest.state.drawerBody.scrollTop=0;})()`);shot(`ordinary-${width}`);
    evaluate(`changeMode('inline')`);
    evaluate(`(async()=>{await bringTree(2);await bringTree(3);})()`);
  }
  console.log(evaluate(`(async()=>{
    await settle();const s=replyTest.state;
    const observers=s.inlineReplyObservers, controllers=s.inlineReplyControllers;
    const regions=[document.createElement('div'),document.createElement('div')];s.content.append(...regions);
    const blockers=[new AbortController(),new AbortController(),new AbortController()];let opened=0;
    s.inlineReplyControllers=new Map(blockers.map(c=>[c,s.content]));
    s.inlineReplyObservers=new Map(regions.map((r,i)=>[r,{visible:i===0,open:()=>{opened++;s.inlineReplyControllers.set(new AbortController(),r);}}]));
    try {
      replyTest.loadVisibleInlineReplies();check(opened===0,'自动分支超过三路并发');
      s.inlineReplyControllers.delete(blockers[0]);replyTest.loadVisibleInlineReplies();
      check(opened===1 && s.inlineReplyObservers.has(regions[1]),'队列未续传或请求了视野外分支');
      s.inlineReplyControllers.clear();s.inlineReplyObservers.get(regions[1]).visible=true;replyTest.loadVisibleInlineReplies();
      check(opened===2 && !s.inlineReplyObservers.size,'进入视野后未自动展开');
    } finally {regions.forEach(r=>r.remove());s.inlineReplyObservers=observers;s.inlineReplyControllers=controllers;}
    return '自动展开并发上限、等待续传与视野外排除：通过';
  })()`).trim());
  if (process.env.SIDEPEEK_SCREENSHOT_DIR) {
    run(["set","viewport","1280","1600"]);
    evaluate(`(async()=>{for(const n of [2,3,4,8]) await bringTree(n);replyTest.state.content.querySelector('[data-thread-post-number="2"]').scrollIntoView({block:'start'});await settle();})()`);
    shot("tree-multilevel-desktop");
    run(["set","viewport","390","1600"]);
    evaluate(`replyTest.state.content.querySelector('[data-thread-post-number="2"]').scrollIntoView({block:'start'})`);
    shot("tree-multilevel-mobile");
    run(["set","viewport","390","844"]);
  }
  evaluate(`document.documentElement.style.cssText='--primary:#e2e8f0;--secondary:#17212b;--primary-low:#334155;--primary-medium:#94a3b8;--tertiary:#60a5fa';document.body.style.background='#17212b';replyTest.state.drawerBody.scrollTop=0`);
  run(["wait", "--fn", "getComputedStyle(document.querySelector('.ld-post-icon-btn')).color === 'rgb(148, 163, 184)'"]);
  shot("tree-dark");
  assert.equal(run(["errors"]).trim(), "");
} finally {
  run(["close"]);
}
