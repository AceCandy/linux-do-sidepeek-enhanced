const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const session = `sidepeek-navigation-${process.pid}`;
const run = (args, input) => {
  const result = spawnSync("agent-browser", ["--session", session, ...args], { input, encoding: "utf8", maxBuffer: 2_000_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
};
const evaluate = code => run(["eval", "--stdin"], code);
const clickTopic = () => {
  run(["wait", "--fn", "!document.getAnimations().some(a => a.playState === 'running' && a.effect.getComputedTiming().iterations !== Infinity)"]);
  run(["click", "#next-topic"]);
};
const source = fs.readFileSync(path.join(__dirname, "../src/content.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "../src/content.css"), "utf8");
const html = '<!doctype html><meta charset="utf-8"><title>抽屉导航固定页</title><main id="main-outlet">' +
  '<div class="topic-list-item"><a class="title" href="/t/nav/101">主题 101</a></div></main>';
const frameHtml = '<!doctype html><meta charset="utf-8"><title>整页主题</title>' +
  '<a id="frame-next" href="/t/nav/102">整页内主题 102</a><input aria-label="整页输入" id="frame-input">';

try {
  run(["open", "about:blank"]);
  run(["network", "route", "https://linux.do/latest", "--body", html]);
  run(["network", "route", "https://linux.do/t/nav/*", "--body", frameHtml]);
  run(["open", "https://linux.do/latest"]);
  evaluate(`(() => {
    localStorage.clear();
    window.GM_xmlhttpRequest = options => options.onerror();
    window.fixtureClicks=[]; document.addEventListener("click",e=>fixtureClicks.push({tag:e.target.tagName,id:e.target.id,className:e.target.className,alt:e.altKey}),true);
    window.fetch = async input => {
      const url = new URL(input, location.href);
      const id = Number(url.pathname.match(/\\/nav\\/(\\d+)/)?.[1]);
      if (!id) throw Error('固定页面不访问其他接口');
      return new Response(JSON.stringify({id,title:'主题 '+id,posts_count:1,post_stream:{stream:[id*100],posts:[{
        id:id*100,post_number:1,username:'tester',actions_summary:[],cooked:'<p>主题 '+id+' 正文</p><a id="next-topic" href="/t/nav/'+(id+1)+'">下一个站内主题</a>'
      }]}}),{headers:{'content-type':'application/json'}});
    };
    const style=document.createElement('style'); style.textContent=${JSON.stringify(css)} + ':where(.ld-shortcuts) button {width:600px}'; document.head.append(style);
    ${source.replace(/^  init\(\);$/m, "  init(); globalThis.navTest = { state, openDrawer, closeDrawer, handlePreviewTopicClick };")}
  })()`);
  run(["click", "#main-outlet a"]);
  run(["wait", "--fn", "navTest.state.currentTopic?.id === 101"]);
  run(["press", "Alt+ArrowLeft"]);
  evaluate(`if(location.pathname!=='/latest' || navTest.state.currentTopic.id!==101) throw Error('空历史发生跳转')`);
  clickTopic();
  run(["wait", "--fn", "navTest.state.currentTopic?.id === 102"]);
  clickTopic();
  run(["wait", "--fn", "navTest.state.currentTopic?.id === 103"]);
  run(["press", "Alt+ArrowLeft"]);
  run(["wait", "--fn", "navTest.state.currentTopic?.id === 102"]);
  run(["press", "Alt+ArrowRight"]);
  run(["wait", "--fn", "navTest.state.currentTopic?.id === 103"]);
  run(["press", "Alt+ArrowRight"]);
  console.log(evaluate(`(() => {
    const s=navTest.state;
    if(location.pathname!=='/latest' || s.currentTopic.id!==103 || s.previewHistory.length!==3) throw Error('历史边界/记录错误');
    const before=s.currentUrl;
    for(const props of [{ctrlKey:true},{metaKey:true},{shiftKey:true}]) {
      const event=new MouseEvent('click',{button:0,cancelable:true,...props});
      Object.defineProperty(event,'target',{value:document.querySelector('#next-topic')});
      if(navTest.handlePreviewTopicClick(event) || event.defaultPrevented || s.currentUrl!==before) throw Error('修饰键点击被拦截');
    }
    const download=document.createElement('a'); download.href='/t/nav/104'; download.download='topic';
    const downloadEvent=new MouseEvent('click',{button:0,cancelable:true});Object.defineProperty(downloadEvent,'target',{value:download});
    if(navTest.handlePreviewTopicClick(downloadEvent)) throw Error('下载链接被拦截');
    document.querySelector('#next-topic').target='_blank';
    for(const href of ['https://example.com/t/nav/104','/u/tester','/latest']) {
      const link=document.createElement('a'); link.href=href;
      const event=new MouseEvent('click',{button:0,cancelable:true}); Object.defineProperty(event,'target',{value:link});
      if(navTest.handlePreviewTopicClick(event) || event.defaultPrevented) throw Error('拦截了非站内主题');
    }
    return '真实点击、后退前进、空历史/边界、修饰键与非主题链接：通过';
  })()`).trim());
  run(["press", "Alt+ArrowLeft"]);
  run(["wait", "--fn", "navTest.state.currentTopic?.id === 102"]);
  evaluate(`document.querySelector('#next-topic').href='/t/nav/104';document.querySelector('#next-topic').target='_blank'`);
  clickTopic();
  run(["wait", "--fn", "navTest.state.currentTopic?.id === 104"]);
  run(["press", "Alt+ArrowRight"]);
  evaluate(`if(navTest.state.previewHistory.at(-1).url!=='https://linux.do/t/nav/104' || navTest.state.previewHistory.length!==3) throw Error('新跳转未清除前进记录')`);

  evaluate(`navTest.state.settings.postBodyFontSize=17; navTest.state.settings.replyOrder='latestFirst'; navTest.state.settings.replyDisplay='legacy'`);
  for (const mode of ["iframe", "auto", "smart"]) {
    run(["click", ".ld-drawer-settings-toggle"]);
    run(["select", '[data-setting="previewMode"]', mode]);
    run(["click", ".ld-drawer-settings-toggle"]);
    console.log(evaluate(`(() => {
      const s=navTest.state;
      for(const field of s.settingsPanel.querySelectorAll('[data-smart-setting]')) {
        if(field.hidden!==${mode === "iframe"} || (getComputedStyle(field).display==='none')!==${mode === "iframe"}) throw Error('设置项可见性错误');
      }
      if(s.settings.postBodyFontSize!==17 || s.settings.replyOrder!=='latestFirst' || s.settings.replyDisplay!=='legacy') throw Error('模式切换丢失设置值');
      if(s.settingsPanel.querySelector('[data-setting="replyOrder"]').options.length!==2) throw Error('回复排序被误删');
      return '${mode} 模式设置可见性及回复排序保留：通过';
    })()`).trim());
    run(["press", "Escape"]);
  }
  for (const width of [1280, 390, 320]) {
    evaluate(`document.documentElement.style.cssText = ${JSON.stringify(width === 320 ? "--primary:#ddd;--secondary:#222;--primary-low:#444;--primary-medium:#bbb;background:#222;color:#ddd" : "")}`);
    run(["set", "viewport", String(width), "800"]);
    run(["click", ".ld-drawer-shortcuts-toggle"]);
    evaluate(`window.beforeHelpUrl=navTest.state.currentUrl`);
    run(["press", "Alt+ArrowLeft"]);
    evaluate(`if(location.pathname!=='/latest' || navTest.state.currentUrl!==beforeHelpUrl) throw Error('快捷键说明内触发了历史导航')`);
    console.log(evaluate(`(() => {
      const s=navTest.state, dialog=s.shortcutsDialog;
      if(!dialog.open || !dialog.textContent.includes('Mac') || !dialog.textContent.includes('Windows') || dialog.querySelectorAll('tbody tr').length!==6) throw Error('快捷键说明不完整');
      if(s.root.querySelector('.ld-drawer-reply-toggle') || s.replyFabButton.hidden) throw Error('回复入口未精简');
      const box=dialog.getBoundingClientRect(), close=dialog.querySelector('button').getBoundingClientRect();
      if(box.left<0 || box.right>innerWidth || box.top<0 || box.bottom>innerHeight || dialog.scrollWidth>dialog.clientWidth || close.left<box.left || close.right>box.right || close.bottom>innerHeight) throw Error('说明布局或关闭按钮不可见');
      return '快捷键说明、单一回复入口及 ${width}px 布局：通过';
    })()`).trim());
    if (process.env.SIDEPEEK_SCREENSHOT_DIR) run(["screenshot", path.join(process.env.SIDEPEEK_SCREENSHOT_DIR, `shortcuts-${width}.png`)]);
    run(["press", "Escape"]);
    evaluate(`if(navTest.state.shortcutsDialog.open || document.activeElement!==navTest.state.shortcutsToggle) throw Error('关闭说明未恢复焦点')`);
    run(["click", ".ld-drawer-settings-toggle"]);
    run(["select", '[data-setting="previewMode"]', "iframe"]);
    run(["click", ".ld-drawer-settings-toggle"]);
    evaluate(`(() => {
      const card=navTest.state.settingsCard, title=card.querySelector('.ld-settings-title').getBoundingClientRect();
      if(!card.contains(document.elementFromPoint(title.left+2,title.top+2))) throw Error('设置标题被悬浮入口遮挡');
      if(getComputedStyle(navTest.state.toastStack).visibility!=='hidden') throw Error('设置被首次提示遮挡');
    })()`);
    if (process.env.SIDEPEEK_SCREENSHOT_DIR) run(["screenshot", path.join(process.env.SIDEPEEK_SCREENSHOT_DIR, `iframe-settings-${width}.png`)]);
    run(["select", '[data-setting="previewMode"]', "smart"]);
    run(["click", ".ld-drawer-settings-toggle"]);
    if (process.env.SIDEPEEK_SCREENSHOT_DIR) run(["screenshot", path.join(process.env.SIDEPEEK_SCREENSHOT_DIR, `smart-settings-${width}.png`)]);
    run(["press", "Escape"]);
  }
  evaluate(`navTest.closeDrawer(); navTest.state.settings.previewMode='iframe'; navTest.openDrawer('https://linux.do/t/nav/101','整页主题',null)`);
  run(["wait", "--fn", "document.querySelector('.ld-topic-iframe')?.contentDocument?.querySelector('#frame-next')"]);
  console.log(evaluate(`(() => {
    const frame=document.querySelector('.ld-topic-iframe'), doc=frame.contentDocument;
    const key=(target,props={})=>{const e=new frame.contentWindow.KeyboardEvent('keydown',{key:'ArrowLeft',altKey:true,bubbles:true,cancelable:true,...props});target.dispatchEvent(e);return e;};
    if(!key(doc.body).defaultPrevented || navTest.state.currentUrl!=='https://linux.do/t/nav/101') throw Error('iframe 空历史未拦下浏览器后退');
    if(key(doc.querySelector('input')).defaultPrevented) throw Error('iframe 输入框方向键被抢占');
    doc.querySelector('#frame-next').click();
    if(navTest.state.currentUrl!=='https://linux.do/t/nav/102' || location.pathname!=='/latest') throw Error('整页主题链接未留在抽屉');
    return '整页 iframe 点击、空历史和输入框按键：通过';
  })()`).trim());
  run(["wait", "--fn", "document.querySelector('.ld-topic-iframe')?.contentDocument?.querySelector('#frame-next')"]);
  evaluate(`document.querySelector('.ld-topic-iframe').contentDocument.body.focus()`);
  // 聚焦 iframe 内链接，使用真实键盘事件验证父页接入。
  evaluate(`document.querySelector('.ld-topic-iframe').contentDocument.querySelector('#frame-next').focus()`);
  run(["press", "Alt+ArrowLeft"]);
  run(["wait", "--fn", "navTest.state.currentUrl.endsWith('/101') && document.querySelector('.ld-topic-iframe')?.contentDocument?.querySelector('#frame-next')"]);
  evaluate(`document.querySelector('.ld-topic-iframe').contentDocument.querySelector('#frame-next').focus()`);
  run(["press", "Alt+ArrowRight"]);
  run(["wait", "--fn", "navTest.state.currentUrl.endsWith('/102')"]);
  console.log("整页 iframe 内真实键盘后退/前进：通过");
  evaluate(`(() => {const frame=document.querySelector('.ld-topic-iframe');window.crossFrameLoaded=false;frame.addEventListener('load',()=>{window.crossFrameLoaded=true;},{once:true});frame.setAttribute('sandbox','allow-scripts');frame.srcdoc='<p>隔离源固定验证页</p>';})()`);
  run(["wait", "--fn", "window.crossFrameLoaded && document.querySelector('.ld-topic-iframe').contentDocument === null"]);
  evaluate(`if(!navTest.state.currentUrl.endsWith('/102')) throw Error('跨源验证页错误改写主题历史');navTest.state.shortcutsToggle.focus()`);
  run(["press", "Alt+ArrowLeft"]);
  run(["wait", "--fn", "navTest.state.currentUrl.endsWith('/101') && document.querySelector('.ld-topic-iframe')?.contentDocument?.querySelector('#frame-next')"]);
  console.log("跨源 iframe 不接管、父页仍可返回同源主题：通过");
  evaluate(`navTest.closeDrawer(); navTest.openDrawer('https://linux.do/t/nav/101','重开',null); if(navTest.state.previewHistory.length!==1) throw Error('关闭后未清理历史')`);
  const errors = run(["errors"]).trim();
  assert.equal(errors, "", errors);
} catch (error) {
  console.error(evaluate(`JSON.stringify({url:location.href,current:window.navTest?.state.currentUrl,topic:window.navTest?.state.currentTopic?.id,history:window.navTest?.state.previewHistory,clicks:window.fixtureClicks})`));
  throw error;
} finally {
  run(["close"]);
}
