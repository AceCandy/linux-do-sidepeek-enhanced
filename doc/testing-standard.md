# 测试标准

这份文档定义仓库当前可执行的测试分层、PR 证据格式、以及新增回归用例的规则。

目标：

1. 先把已经能稳定执行的检查固化下来
2. 把 agent 浏览器测试从临时操作变成可复用流程
3. 每次修 bug，都补一个回归用例，而不是只靠记忆

这份标准参考了 `gstack` 的三个做法，但按当前仓库规模做了压缩：

1. 分层，不把所有验证都塞进一种方式
2. bug fix 必须补回归用例
3. 先固化稳定断言，再逐步升级成真正自动化

## 1. 分层

### Tier 0：静态检查

每次改动后必跑：

```bash
bash scripts/check.sh
```

覆盖内容：

1. `node --check src/content.js`
2. `jq . manifest.json >/dev/null`

适用范围：

1. 任意 `src/content.js` 改动
2. 任意 `manifest.json` 改动
3. 任意 release / packaging 改动

### Tier 1：产物检查

适用于 `manifest.json`、`.github/workflows/release.yml`、README 安装说明、Firefox 打包相关改动。

执行命令：

```bash
bash scripts/build-release-artifacts.sh v0.0.0-local /tmp/linux-do-sidepeek-dist
bash scripts/check-release-artifacts.sh /tmp/linux-do-sidepeek-dist/linux-do-sidepeek-0.0.0-local-chrome.zip /tmp/linux-do-sidepeek-dist/linux-do-sidepeek-0.0.0-local-firefox-unsigned.xpi
```

覆盖内容：

1. Chrome ZIP 与 Firefox XPI 能正常产出
2. 产物中包含 `manifest.json`、`src/content.js`、`src/content.css`
3. Firefox 产物中的 `browser_specific_settings.gecko.id` 存在
4. Firefox 产物中的 `browser_specific_settings.gecko.data_collection_permissions.required` 为 `["none"]`

### Tier 2：agent 辅助 Chrome smoke

适用于可以通过真实浏览器稳定断言的 UI 路径。当前使用 `agent-browser`，连接已加载扩展的真实 Chrome 会话。

前置条件：

1. Chrome 使用非默认 `user-data-dir` 启动
2. Chrome 带 `--remote-debugging-port=9222`
3. 已在 `chrome://extensions/` 里加载当前仓库
4. 改动后已点过扩展页的 `Update`

推荐启动方式：

```bash
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-codex
```

连接方式：

```bash
agent-browser --cdp 9222 get url
agent-browser --cdp 9222 snapshot -i
```

当前可执行脚本：

```bash
bash scripts/agent-smoke.sh --cdp-port 9222
```

默认覆盖：

1. `AGENT-CHROME-001`
2. `AGENT-CHROME-002`
3. `AGENT-CHROME-003`
4. `AGENT-CHROME-004`
5. `AGENT-CHROME-005`
6. `AGENT-CHROME-006`
7. `AGENT-CHROME-008`
8. `AGENT-CHROME-009`
9. `AGENT-CHROME-010`

说明：

1. `AGENT-CHROME-008` 在页面不存在“查看 x 个新的或更新的话题”提示条时会记为 `SKIP`
2. `AGENT-CHROME-007` 目前仍保留在用例库里做定向执行，不进入默认批量脚本

执行规则：

1. 高风险交互改动至少跑相关的 2 到 3 条 agent 用例
2. 如果修的是线上回归，必须补对应回归用例
3. agent 用例只记录稳定断言，不记录“看起来差不多”

合并前规则：

1. 如果 PR 新增或改动了可稳定断言的交互路径，必须先在提交分支补对应 agent smoke 用例
2. 新增用例和受影响的既有用例必须先在提交分支跑过，再合并到 `main`

用例定义见 [agent-smoke-cases.md](/mnt/hdd/work/temp/linux.do_improvement/doc/agent-smoke-cases.md)。

### Tier 3：人工保留项

以下内容暂时不强行 agent 化：

1. Firefox 浏览器内完整交互兼容性
2. 窄屏 / 响应式观感
3. 视觉细节是否正常
4. 浏览计数是否增长
5. 需要人工判断影响级别的 Console 噪声

界面改动必须实际查看桌面与手机截图，核对首屏是否以主要内容为主、操作文字是否明确、保存等关键按钮是否可见，并覆盖编辑态与暗色主题。尺寸与无溢出断言只能补充截图检查，不能替代；原站给表单控件设置固定宽度的情况应加入固定页面回归。

## 2. 变更到测试层的映射

### 改 `src/content.js` / `src/content.css`

至少执行：

1. Tier 0
2. 相关 Tier 2 用例
3. 如果涉及视觉或 Firefox 行为，再补 Tier 3

### 改 `manifest.json` / release workflow / README 安装发布说明

至少执行：

1. Tier 0
2. Tier 1
3. 如果同时影响真实交互，再补相关 Tier 2

## 3. 回归规则

每次修用户已发现的 bug，都要做两件事：

1. 修代码
2. 在 [agent-smoke-cases.md](/mnt/hdd/work/temp/linux.do_improvement/doc/agent-smoke-cases.md) 增加或更新对应回归用例

当前已固化的回归用例：

1. `AGENT-CHROME-006`
   浮层模式下，抽屉打开时点击另一个列表主题，应直接切换抽屉内容，不能先关闭再第二次打开
2. `AGENT-CHROME-013`
   抽屉内容滚到底后继续滚轮时，外层列表页不应继续跟着滚动

## 4. PR 证据格式

功能 PR 的测试证据按下面格式写：

```text
Tier 0
- bash scripts/check.sh

Tier 1
- bash scripts/build-release-artifacts.sh v0.0.0-local /tmp/linux-do-sidepeek-dist
- bash scripts/check-release-artifacts.sh /tmp/linux-do-sidepeek-dist/linux-do-sidepeek-0.0.0-local-chrome.zip /tmp/linux-do-sidepeek-dist/linux-do-sidepeek-0.0.0-local-firefox-unsigned.xpi

Tier 2
- bash scripts/agent-smoke.sh --cdp-port 9222
- AGENT-CHROME-001 PASS
- AGENT-CHROME-005 PASS
- AGENT-CHROME-006 PASS

Tier 3
- 未执行：Firefox 浏览器内完整回归
```

如果本次没跑某一层，直接写未执行，不要省略。

## 5. 升级规则

一个用例满足下面条件后，可以从“agent smoke 用例”升级成真正脚本化测试：

1. 连续多次执行，断言稳定
2. 不依赖实时内容波动
3. 有明确的 pass/fail 信号
4. 失败时能定位到具体回归点

在仓库当前阶段，不追求一次到位引入完整 E2E 框架。先把分层和用例库稳定下来，再挑最稳的路径升级。

## 油猴生成检查

油猴生成检查：修改公共源码、油猴模板或版本号后，运行 `node scripts/build-userscript.cjs` 更新入仓产物。`bash scripts/check.sh` 包含只读产物一致性检查和 `node scripts/check-userscript.cjs`，覆盖重复生成、模板边界、CSS 特殊字符、页面上下文、GM 设置优先级、旧设置迁移及存储异常回退。CI 和发布均调用此检查，不自动覆盖未同步产物。实际脚本管理器沙箱与跨域会话仍需在线验证。

## 可见标题预取与实际阅读上报验证

- `bash scripts/check.sh`：语法、两个发行版函数一致性、100 主题缓存、预取限速/并发/暂停、点击复用、取消竞态、阅读时长/楼层/会话边界及失败降频通过。
- `node scripts/check-preview-browser.cjs`：固定页面完整初始化，原生 IntersectionObserver 发现可见标题、每秒两次限速、屏幕外排除、缓存点击、实际楼层上报、设置关闭和动态深链接定位通过。
- 真实 Linux.do 阅读入账、Connect 等级指标变化以及 Firefox/油猴管理器在线交互尚未验证；此前环境遇到站点 403 验证页。未伪造任何真实账号阅读记录。

## 左侧信任等级面板验证

- `bash scripts/check.sh`：通过，包含原有缓存断言和新增后台请求边界检查。
- `node scripts/check-status.cjs --browser`：固定数据解析、文本安全、折叠、刷新、失败恢复及 390px 窄屏边界通过。
- Chrome 实际加载当前扩展，在固定列表页自动注入状态面板与原抽屉；Connect 请求失败后显示登录/验证提示，未发现脚本错误。
- Chrome ZIP 与 Firefox XPI 构建及后台声明检查通过。测试浏览器已关闭，临时打包产物已清理。
- 未验证：真实账号 Connect 数字、阅读后指标变化、Firefox 实际运行和油猴管理器跨域会话。站点 403 验证页阻止在线核对。

## 0.7.2 同步验证

- `node scripts/check-cache.cjs`：验证内存缓存 12 条上限、最近使用顺序、10 分钟过期、滚动位置保存，以及设置存储不可用或损坏时的回退。
- 本次静态检查、Chrome ZIP 和 Firefox XPI 结构检查通过。
- 独立 Chrome 固定页面验证通过：扩展自动注入、顶部七个操作按钮、接口异常时整页回退、设置打开与持久化、Esc 关闭；未记录脚本错误。
- 真实 linux.do 被站点验证页面阻挡，未完成在线正文加载、登录后回复、上传、自定义表情及 Firefox 实际交互回归。固定页面验证不替代这些检查。

## 收藏管理验证

- Gist 自动同步回归：`bash scripts/check.sh` 与 `node scripts/check-bookmarks.cjs --browser` 通过，扩展/油猴共用同步流程，无新增权限。可控时钟覆盖 30 秒连续修改防抖、30 分钟远端拉取、重载后无需打开收藏即可同步、持久化到期时间、默认关闭、编辑/后台/pagehide/增强关闭延后、跨标签锁内去重、自动冲突不弹窗且不改两端数据、失败暂停不重试、手动恢复、断开不创建及账号失败保护。浏览器验证开关即时持久化、存储失败回退、自动合并及暂停提示；桌面、390px 手机、暗色与暂停状态截图已实际查看，独立代码复核未发现问题。未验证真实 GitHub 凭据、Firefox/油猴管理器实装、真实多设备并发；页面定时器在关页后不运行，已发出的请求不能撤回，Gist 跨设备写入仍非原子。
- 本次额外执行 `node scripts/check-preview-browser.cjs`：首轮在“向下按钮未定位到最新回复”断言失败；用 HEAD 原始源码做只读对照也在同一断言失败，当前工作树重跑完整通过。记录为既有不稳定回归，未修改预览代码或放宽断言。测试浏览器均已关闭，验收截图已清理。

- Gist 冲突选边回归：`bash scripts/check.sh`（含扩展/油猴 `check-gist.cjs`）与 `node scripts/check-bookmarks.cjs --browser` 通过。覆盖本机/云端选边、非冲突字段保留、首次无基线、分类删除/新增/排序、多字段冲突、输入快照不变、同步前两端快照、取消/Esc 不覆盖且不更新基线/时间，以及选择期间云端变化时拒绝覆盖。独立复核未发现问题；桌面、390px 手机与暗色弹窗截图已实际查看，油猴产物已同步。仍为手动同步；未使用真实 GitHub 凭据，未验证多设备真实并发、Firefox 或油猴管理器实装，Gist 非原子写入的短暂竞争窗口仍存在。

- 悬停缓存补充：`bash scripts/check.sh` 与 `node scripts/check-bookmarks.cjs --browser` 通过。断言从“分页请求数不增加”升级为“总请求数不增加”，覆盖真实移出/移入、重开不清空列表、不显示加载态，以及 CSRF 切换账号、登录标记移除时重新校验。桌面/手机紧凑截图已查看，油猴产物已同步。未验证真实站点会话变化；仅服务端变化且页面标记未变时仍需等待刷新发现。

- 收藏性能、缓存和开关回归：本机新建/拖拽/整理写入零网络请求，一小时内复用列表、到期自动刷新、新增/取消后更新、后台页面延后、关闭增强后停止请求均有固定页面断言。自定义确认覆盖确认/取消/Esc，取消收藏无弹窗；增强关闭后保留楼层直接收藏，入口隐藏且设置持久化。静态检查和智能预览浏览器回归通过；桌面/手机确认框及设置、暗色确认框截图已实际查看。缓存为页面内存，不跨页面重载；尚未验证真实账号、Firefox 和油猴管理器实装。

- Gist 配置界面更新：行内密码框替代原生填写窗（覆盖下方历史记录的“Token 不进入 DOM”保证）；删除返回入口和整块说明，字段问号提供可点击帮助。静态检查与固定页面浏览器回归通过，覆盖悬停不抢焦点、键盘 Enter/Esc、手机提示边界、保存清空、留空复用、退出确认与清空、重开不回填、切换分类清理提示。桌面/手机截图已实际查看，油猴产物已同步。未使用真实 Token 验证 GitHub，也未验证 Firefox/油猴管理器实装；页面内输入可被原站脚本读取。

- 搜索摘要与元信息布局回归：`bash scripts/check.sh`、`node scripts/check-bookmarks.cjs --browser` 通过。标签搜索保留回复原摘要，备注搜索保留主题原摘要；完整管理页日期后同排显示分类和标签，手机自动换行，紧凑模式命中标签仍可见。桌面/手机管理页与紧凑搜索截图已实际查看，油猴产物已同步。未验证真实站点主题、Firefox/油猴实装；仍有环境兼容性风险。
- 分类交互精简回归：`bash scripts/check.sh` 与 `node scripts/check-bookmarks.cjs --browser` 通过。插入分割线与落点共用判断、落下后清除、菜单仅“修改/删除”、原位输入、重名拒绝、存储失败保留输入重试、Esc/失焦取消、中文组合输入不误提交、保存后仍可拖拽均已检查。桌面分割线/菜单/输入框与手机输入框截图已实际查看；真实站点主题、Firefox 和油猴管理器实装仍未验证。
- Gist 与分类操作回归：`bash scripts/check.sh`（含 `check-gist.cjs`）、`node scripts/check-bookmarks.cjs --browser`、`node scripts/check-preview-browser.cjs` 通过。模拟扩展后台与油猴传输，验证创建非公开 Gist、字段级双向合并、分类删除/排序、冲突拒绝、失败重试、账号隔离、截断/公开 Gist 拒绝、Token 不上传及重复创建保护。浏览器验证清空搜索/亮黄色高亮、drag 命令与上移排序、分类改名/删除、类型样式区分、同步配置/创建/断开、Token 不进入页面 DOM；桌面、390px 手机、暗色、搜索和分类菜单截图已实际查看。Chrome/Firefox 打包结构检查通过。真实 GitHub 凭据、跨设备竞争、Firefox 与油猴管理器实装未验证；Gist 写入前后复查不等于跨设备原子锁。
- 收藏悬停与标题入口回归：`node scripts/check-bookmarks.cjs --browser` 与 `bash scripts/check.sh` 通过。仅图标、悬停不写入/不抢焦点、移出收起、点击/Enter 固定、当前分类自动滚入可见区域、移动保留备注、取消确认、标题与首帖状态同步、长标题及整页回退清理均已断言；桌面/手机标题与当前分类截图已实际查看。标题入口当前仅位于智能侧栏，未注入原站标题；真实账号与脚本管理器仍未验证。
- `bash scripts/check.sh`：通过，包含扩展与油猴收藏存储、并行写入合并、导入校验、存储失败及账号隔离检查。
- `node scripts/check-bookmarks.cjs --browser`：固定页面通过 25 条收藏分页、末页搜索、分类/标签/备注、删除分类保留原站收藏、排序、楼层预览与返回位置、Esc 焦点、1280px/390px 布局、分页与取消收藏失败、JSON 导出/导入往返、损坏文件保护及账号切换检查。
- 楼层收藏图标悬停展开收藏夹，已收藏时显示当前分类；已有书签缺少 ID 时读取原生列表后取消，不重复创建。关闭面板取消加载，接口验证失败不显示上一账号的收藏或整理信息。
- 界面回归补充：默认管理控件折叠、空收藏夹指引、编辑独立视图、未保存退出确认、更多菜单与编辑页 Esc 层级、手机打开/返回不聚焦文本框，以及站点固定输入宽度隔离。1280px/390px 首屏列表可见，手机编辑页保存按钮保持可见；桌面/手机/编辑/暗色截图已逐张核对。可通过 `SIDEPEEK_SCREENSHOT_DIR` 指定临时目录输出截图，验收后清理。
- 紧凑入口回归：等级下方同尺寸、等级展开/隐藏后位置跟随、悬停不抢焦点与移出收起、点击/Enter 固定、触屏不误展开、侧栏正文实际渲染和返回原模式、390px 边界通过。就地选择/新建/移动收藏夹、原站失败、本机失败后重试不重复创建、保存时快捷按钮互斥、列表加载中切换到选择器、Esc/切帖清理及新收藏重新打开可见通过。桌面、手机、暗色和选择器截图已检查；较多收藏夹只滚动选项，保留新建操作栏。
- 收藏视觉整理回归：五角星与等级文字对齐、原站字体/字距及 summary 伪元素隔离、去重复列表标题、大小写/正则特殊字符/HTML 字面量搜索高亮、摘要和本机标签/备注命中可见、主题与回复缩进层级通过。完整管理页桌面/手机背景关闭、内部拖出不误关、未保存确认和保存中保护通过；桌面/手机紧凑列表、完整管理和搜索截图已实际查看。继续复用收藏列表与侧栏，不增加逐帖请求或依赖。
- `node scripts/check-status.cjs --browser`：等级面板解析、折叠、刷新、失败恢复和手机布局复跑通过。
- `node scripts/check-preview-browser.cjs`：原有预取、阅读、缓存、搜索、楼层操作及抽屉布局有完整通过记录；收尾复跑曾两次在“向下按钮未定位到最新回复”断言失败，随后增加失败现场信息的三次复跑均通过，未确认间歇失败原因，不能视为已修复。Chrome/Firefox 产物结构及新增 `storage` 权限检查通过。
- 未验证真实登录后的收藏接口、Firefox 实装和油猴管理器沙箱；此前真实站点停留在 Cloudflare 验证页，本轮使用固定响应验证。接口兼容分支依据 Discourse 上游源码与固定响应，不等同于 L 站当前版本的在线证据。
