# AGENTS.md - Linux.do SidePeek 代理协作指南

## 项目概览
这是一个零构建的 Chrome 扩展（Manifest V3），用于在 `https://linux.do/*` 内为主题链接提供右侧抽屉预览。
- 技术栈：原生 JavaScript + 原生 CSS
- 关键入口：`manifest.json`、`src/content.js`、`src/content.css`
- 运行方式：Chrome 直接加载仓库目录
- 当前没有 `package.json`、Node 构建器、Lint 配置或自动化测试框架
- 当前提供最小静态检查与打包产物验证脚本，供本地和 GitHub Actions 复用
- 左侧信任等级面板读取 `connect.linux.do`；扩展通过 `src/background.js` 获取固定页面，油猴版通过 `GM_xmlhttpRequest` 获取。Chrome 使用 service worker，Firefox 发布产物转换为后台 scripts。

## 仓库结构
```text
linux-do-sidepeek/
├── .github/
│   └── workflows/
│       ├── check.yml
│       └── release.yml
├── doc/
│   ├── agent-smoke-cases.md
│   ├── latest-replies-reverse-pagination.md
│   ├── linux-do-rules.md
│   └── testing-standard.md
├── manifest.json
├── scripts/
│   ├── agent-smoke.sh
│   ├── build-release-artifacts.sh
│   ├── check-release-artifacts.sh
│   └── check.sh
├── src/
│   ├── content.js
│   └── content.css
└── AGENTS.md
```

## 外部规则文件状态
已检查以下位置：
- `.cursorrules`
- `.cursor/rules/`
- `.github/copilot-instructions.md`
当前均不存在，因此没有额外的 Cursor 或 Copilot 规则需要继承。
如果后续新增这些文件，必须先读取，并视为高优先级补充约束。

## 代理工作原则
- 这是单 content script 项目，不要假设存在模块系统、构建产物、路径别名或生成目录
- 小改动优先直接编辑 `src/content.js` 与 `src/content.css`
- 不要主动引入 npm、TypeScript、Webpack、Vite、ESBuild、Prettier、ESLint、Jest、Vitest 等工具，除非用户明确要求
- 如果新增文件，先确认 `manifest.json` 是否需要同步声明或引用
- 保持最小必要改动；不要为了“现代化”而重写现有架构
- 油猴产物 `userscript/linuxdo-sidepeek.user.js` 自动生成，禁止直接手改；公共逻辑修改 `src/`，油猴元数据和存储差异修改 `userscript/template.js`，随后运行 `node scripts/build-userscript.cjs`。扩展仍然零构建。

## Build / Lint / Test Commands

### Build
当前可执行的发布产物构建命令：
```bash
bash scripts/build-release-artifacts.sh v0.0.0-local /tmp/linux-do-sidepeek-dist
```
执行内容：
- 产出 Chrome ZIP
- 产出 Firefox 未签名 XPI

### Run Extension
```bash
# 无 CLI 运行命令
# 在 chrome://extensions/ 中开启开发者模式
# 点击“加载已解压的扩展程序”，选择仓库根目录
# 代码修改后点击“重新加载”使改动生效
```

### Lint / Format
当前没有自动化 lint 或格式化命令。
```bash
# N/A - no eslint / prettier / stylelint command exists
```
当前最小静态检查命令：
```bash
bash scripts/check.sh
```
执行内容：
- `node --check src/content.js`
- `jq . manifest.json >/dev/null`
- `node scripts/build-userscript.cjs --check`：只读校验完整油猴产物与源码一致，版本取自 `manifest.json`
- `node scripts/check-userscript.cjs`：生成稳定性、边界保护、CSS 转义、油猴存储迁移及失败降级

### Test
当前没有自动化测试命令。
```bash
# N/A - no npm test / pnpm test / vitest / jest command exists
```
当前可执行的基础验证命令：
```bash
bash scripts/build-release-artifacts.sh v0.0.0-local /tmp/linux-do-sidepeek-dist
bash scripts/check-release-artifacts.sh /tmp/linux-do-sidepeek-dist/linux-do-sidepeek-0.0.0-local-chrome.zip /tmp/linux-do-sidepeek-dist/linux-do-sidepeek-0.0.0-local-firefox-unsigned.xpi
bash scripts/agent-smoke.sh --cdp-port 9222
```
执行内容：
- 验证 Chrome ZIP 与 Firefox XPI 能被正常产出
- 验证产物中包含 `manifest.json`、`src/content.js`、`src/content.css`
- 验证 Firefox 产物中的 `browser_specific_settings.gecko.id` 存在
- 验证 Firefox 产物中的 `browser_specific_settings.gecko.data_collection_permissions.required` 为 `["none"]`
- 验证默认批量 agent Chrome smoke 用例

对应 CI：
- `check.yml` 会在 `pull_request` 和 `main` 分支 `push` 时执行静态检查和打包 smoke
- `release.yml` 会在 tag 发布时执行同一套静态检查，并在发布前验证产物结构

测试文档：
- 分层与 PR 证据格式见 `doc/testing-standard.md`
- agent Chrome 用例库见 `doc/agent-smoke-cases.md`

### Single Test
当前不适用：仓库中没有测试框架，也没有测试文件，因此不存在运行单个测试文件或单个测试用例的命令。
```bash
# N/A - no single-test command exists in this repository
```
如果未来引入测试框架，必须把以下内容补充到本文件：
- 全量测试命令
- 单个测试文件命令
- 单个测试用例命令

## 手动验证清单
每次行为改动后，至少验证与改动相关的路径；改动较大时执行完整清单：
1. 重载扩展并打开 `https://linux.do/latest`
2. 点击列表页主题标题，确认右侧抽屉能打开
3. 确认主题 JSON 正常加载；失败时仍能降级为 iframe 预览
4. 验证“新标签打开”链接可用，且保留 `rel="noopener noreferrer"`
5. 验证“上一帖 / 下一帖”在列表页、搜索结果或用户流中可切换
6. 验证设置面板的打开、关闭、保存、恢复默认
7. 验证“智能预览 / 整页模式”“完整主题 / 仅首帖”“默认顺序 / 最新回复优先”逻辑
8. 验证拖拽调节宽度后，刷新仍能恢复
9. 验证 `Escape` 能关闭设置层、图片预览和抽屉
10. 验证窄屏，尤其 `<= 720px`，布局不破版
11. 打开 Chrome DevTools，确认 Console 无新增错误

补充规则：
- 修复用户已发现的 bug 时，更新 `doc/agent-smoke-cases.md` 中对应回归用例
- 修改界面后必须实际查看桌面与手机截图，检查首屏内容、主次操作和关键按钮可见性；不能用“无溢出”断言代替操作清晰度验收，并检查原站表单样式干扰。
- 优先把稳定断言写入 agent 用例库，再考虑升级成真正脚本化测试
- PR 合并前，如果新增或改动了可稳定断言的交互路径，先在提交分支补对应 agent smoke 用例并跑过，再合并到 `main`

## 架构摘要
- `manifest.json`：声明 MV3 扩展信息、匹配站点与 content script 注入配置
- `src/content.js`：整个功能集中在一个 IIFE 中，负责状态、事件委托、抽屉 UI、网络请求、路由监听与设置持久化
- `src/content.css`：全部样式集中在单文件，选择器统一以 `ld-` 前缀隔离站点样式
- `src/background.js`：仅接受本站顶层内容脚本的信任等级读取及固定 GitHub Gist 同步消息；不得扩展为任意 URL 代理。Gist 仅 GET/POST/PATCH 固定端点和文件，禁止重定向及携带站点 Cookie。
- `src/native-renderer.js`：MAIN world 桥，复用 Discourse 正文和 Boost 组件，并读取原站表情配置；只处理抽屉固定节点事件，不提供任意请求能力。Boost 写入由原站组件在用户操作后执行。切帖、关闭和 pagehide 必须销毁实例，失败保留原有正文。油猴内嵌同一文件，修改后必须同步。
- 当前实现采用“单状态对象 + 一组函数”的组织方式，而不是类、模块分层或多文件拆分
- 状态面板回归：`node scripts/check-status.cjs`；带固定页面浏览器验证：`node scripts/check-status.cjs --browser`（需要 agent-browser，会自行关闭测试浏览器）。状态功能修改需同步独立油猴发行版。
- 收藏管理回归：`node scripts/check-bookmarks.cjs`；固定页面交互：`node scripts/check-bookmarks.cjs --browser`（自行关闭测试浏览器）。原生书签保存在站点，分类/标签/备注按用户 ID 保存到扩展 storage 或油猴 GM 存储；两个收藏存储适配函数同设置适配一起由生成器替换。导入只合并同账号整理数据，不调用原站写入接口。
- 收藏默认入口位于等级下方，复用同一 dialog 的非模态紧凑模式；“管理面板”才切为模态。悬停不得抢焦点，预览返回需保留原模式。收藏夹选择器使用原生 popover，切帖/关闭/pagehide 清理；原站成功、本机分类失败时不得误报整体成功或重试重复创建书签。
- Gist 同步回归：`node scripts/check-gist.cjs`。只同步整理数据，Token 按账号保存在本机独立配置键，不进入备份；按同步基线逐字段合并，手动冲突由用户选本机/云端，非冲突字段保留，取消不覆盖数据或更新基线。自动同步默认关闭，手动配置成功后单独开启；仅可见 L 站页面运行，变更约 30 秒防抖、30 分钟检查云端，编辑/配置延后。账号锁内重读开关和持久化到期时间以协调标签页；自动冲突/失败持久暂停、不弹窗，手动成功恢复，不自动创建 Gist。关闭开关/增强收藏、断开或 pagehide 后不得发起新的自动写入，已发出的请求无法撤回。Gist 无跨设备原子锁，不得宣称完全消除并发覆盖；覆盖前保存两端快照，选择期间云端有变化仍须拦截，禁止自动重试创建/写入。公共逻辑修改后重新生成油猴。
- 预取与阅读回归：`node scripts/check-preview.cjs`、`node scripts/check-preview-browser.cjs`；100 主题缓存回归：`node scripts/check-cache.cjs`。阅读上报只允许实际可见楼层，预取不得计入已读；同一任务中已确认的功能和参数应继续实现，不能因新增子功能而遗漏原有目标。

## JavaScript 代码风格

### 模块与导入
- 不使用 `import` / `export`
- 保持顶层 IIFE，避免污染页面全局作用域
- 不要把现有脚本改造成 ES module，除非用户明确要求并同步调整 Manifest

### 格式
- 使用 2 空格缩进
- 字符串使用双引号
- 保留分号
- 沿用现有换行与空行习惯，不做纯格式噪音改动
- 优先用早返回减少嵌套

### 变量与函数
- 常量使用 `UPPER_SNAKE_CASE`，如 `ROOT_ID`
- 变量、状态字段、函数名使用 `camelCase`
- 处理函数命名用 `handleXxx`
- 构建 DOM 的函数命名用 `buildXxx`
- 渲染逻辑命名用 `renderXxx`
- 布尔值使用可读语义，如 `isResizing`、`hasShownPreviewNotice`
- 优先使用函数声明 `function foo() {}`
- 使用 `const`；仅在需要重新赋值时使用 `let`
- 禁止使用 `var`

### 类型与数据处理
- 本项目是纯 JavaScript，不要引入 TypeScript 类型系统
- 对不确定输入使用运行时守卫，例如 `typeof`、`instanceof`、`Array.isArray`
- 访问可选字段时使用可选链和默认值
- 解析 URL、DOM、存储数据前先校验再使用

### 状态、DOM 与可访问性
- 共享状态统一放入 `state` 对象
- 新增状态优先并入 `state`，不要散落成多个顶层变量
- 优先使用 `document.createElement()`、`append()`、`replaceChildren()`
- 事件处理优先沿用事件委托，当前主要挂在 `document` 与抽屉根节点上
- 操作前先确认目标是 `Element` 或 `HTMLElement`
- 避免随意使用 `innerHTML`
- 仅在内容来源可信时使用 `innerHTML`；当前 `post.cooked` 属于现有可信边界
- 动态文本优先使用 `textContent`
- 新增浮层时补齐键盘可达性和 `aria-*` 属性

### 异步、持久化与错误处理
- 网络请求使用 `fetch` + `async/await`
- 请求继续携带 `credentials: "include"`
- 可取消流程继续使用 `AbortController`
- 用户设置继续存储在 `localStorage`，改结构时注意兼容旧值
- 对 URL 解析、网络请求、存储读取等易失败路径使用 `try/catch`
- `abort`、无效链接、缺失节点等预期失败直接返回
- 主题 JSON 失败时，保持“降级为 iframe 预览”的容错路径
- 只有需要用户感知时才渲染错误提示，否则保持静默处理

### 命名与注释
- 名称直接描述行为，如 `openDrawer`、`loadTopic`、`applyDrawerWidth`
- 选择器常量保持 `_SELECTOR` 后缀
- 避免含糊缩写，除非项目内已有稳定约定
- 先写自解释代码，再补注释
- 注释只用于解释非显而易见的约束、兼容分支或站点特性

## CSS 代码风格
- 所有类名使用 `ld-` 前缀，避免污染 `linux.do` 原站样式
- 尽量把样式限定在 `#ld-drawer-root` 作用域下
- 复用站点变量，如 `--primary`、`--secondary`、`--primary-low`、`--tertiary`
- 继续使用 CSS 变量、`clamp()`、`color-mix()` 与现有尺寸体系
- 响应式重点关注现有断点，尤其 `1120px` 与 `720px`
- 新增样式时延续现有圆角、阴影、边框透明度与模糊背景语言
- 避免写全局覆盖规则，除非确实是为 `body` 状态类服务

## 安全与兼容性约束
- 不要写入密钥、令牌或其他敏感信息
- 外链必须保留 `target="_blank"` 时的 `rel="noopener noreferrer"`
- 不要拦截与预览功能无关的站内外链接
- 修改链接识别逻辑时，要同时考虑列表页、搜索结果、用户流等入口
- 修改渲染逻辑时，要同时考虑移动端、Discourse 主题变量和 iframe 降级路径

## 修改建议流程
1. 先读 `manifest.json`、`src/content.js`、`src/content.css`
2. 确认改动是否需要同步更新 `manifest.json` 或本文件
3. 以最小必要改动实现需求，避免架构漂移
4. 重载扩展并执行相关手动验证
5. 检查 Console、交互路径和响应式表现
6. 若引入新的运行方式、检查命令或约定，及时更新 `AGENTS.md`
