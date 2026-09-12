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
