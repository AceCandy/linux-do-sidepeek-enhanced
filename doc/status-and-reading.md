# 信任等级展示与阅读统计

本次核对 LDStatus v1.13 和 Discourse 上游默认分支；不代表 Linux.do 当前部署版本。Linux.do 与 Connect 的未登录读取均遇到 403 验证页，未验证真实账号指标。

## 数据来源

[LDStatus](https://github.com/1e0n/LinuxDoStatus/blob/master/LDStatus.user.js) 的 `fetchTrustLevelData` GET 请求 `https://connect.linux.do`，再从 HTML 的 `.card`、`.tl3-ring`、`.tl3-bar-item`、`.tl3-quota-card`、`.tl3-veto-item` 读取信任等级要求。它不发送阅读上报，也不自行统计读过的主题。v1.13 不包含旧版今日、昨日活动统计；界面变化箭头只是前后两次采样之差，不是新增阅读事件。

本扩展按相同页面结构提取数据，只显示文本和达标状态；不会插入远端 HTML、加载远端脚本或更新器。页面无法识别时提示打开 Connect，不把解析失败当成 0。等级数字保留在当前页面内存，不写入持久存储；仅保存面板展开状态。

## 与上报机制的对应

| 指标 | Discourse 上游来源 | 扩展当前状态 |
| --- | --- | --- |
| 信任等级的浏览话题 | `TrustLevel3Requirements.topics_viewed_query` 查询 `TopicViewItem`，排除私信；近期指标按 `viewed_at` 过滤 | 已有带访问参数和浏览请求头的主题请求，实际入账由后端判断 |
| 信任等级的已读帖子 | `TrustLevel3Requirements.posts_read` 汇总时间窗口内的 `user_visits.posts_read`；总量汇总全部日期 | 已接入阅读时间上报；预取 JSON 不上报 |
| 逐楼阅读记录和已读位置 | `/topics/timings` → `PostTiming.process_timings` → `TopicUser.update_last_read` | 上报实际可见楼层和停留时间；最终入账需在线验证 |
| 用户摘要中的阅读总数 | `UserStat.update_view_counts` 对 `post_timings` 等记录作汇总校正 | 与信任等级的统计路径不完全相同，不能用本地点击次数代替 |

参考源码：

- [信任等级统计](https://github.com/discourse/discourse/blob/main/app/models/trust_level3_requirements.rb)
- [用户统计汇总](https://github.com/discourse/discourse/blob/main/app/models/user_stat.rb)
- [阅读时间采集与提交](https://github.com/discourse/discourse/blob/main/frontend/discourse/app/services/screen-track.js)
- [阅读记录处理](https://github.com/discourse/discourse/blob/main/app/models/post_timing.rb)
- [已读游标更新](https://github.com/discourse/discourse/blob/main/app/models/topic_user.rb)

已读游标按上报的最高楼号前进，不要求连续读完；最新回复优先模式看到末楼后，可能使列表认为已追到最新，但不代表中间每个帖子都获得阅读记录。预取不得触发阅读上报。Connect 可能存在统计或缓存延迟，不能要求每次阅读后面板立即加一。

## 验证与限制

### 预取与阅读实现

- 标题沿用现有链接识别边界，通过 IntersectionObserver 发现可见条目；动态列表及楼层 URL 都保留原有语义。当前前台页面每 500ms 最多启动一个预取，并发最多两个，失败后暂停一分钟。离开视口的未开始任务不请求，整页模式不预取。
- 预取和实际打开共用最多 100 个主题的内存缓存，获取后 10 分钟过期；主题 ID 作为共享键，楼层与显示设置作为阅读位置键。正在预取时点击会复用请求；缺失的目标楼层和最新回复按需补取。缓存超过 30 秒时打开后后台刷新。
- 阅读沿用 `trackPreviewVisit` 设置，默认开启；只在原站已登录、CSRF 可用、抽屉展示智能正文、页面前台有焦点时采样。设置层、回复框和图片层打开时暂停；可见楼层需要至少一半进入抽屉有效区域，并通过中心点遮挡检查和连续采样。
- 每秒采样，约每五秒批量上报；切帖、关闭、失焦或隐藏页面时尝试提交剩余时间。三分钟未滚动暂停，每个楼层单次阅读会话最多累计六分钟，不补计后台休眠时间。整页 iframe 由原站处理。
- 上报使用登录凭据、CSRF 和 `keepalive`；网络结果不明的批次不自动重放，避免累加接口重复计时。失败后后续批次降频三十秒；关闭页面、断网或会话失效仍可能丢失未确认进度。不会把旧 CSRF 会话的待发记录交给新会话。
- 上报成功不直接修改原站列表 DOM；列表即时变灰与未读数字刷新取决于原站状态更新，必要时刷新列表核对。

### 已执行检查

- `node scripts/check-cache.cjs`：100 主题上限、LRU、过期、同主题多楼层位置及 iframe 不污染缓存。
- `node scripts/check-preview.cjs`：限速与并发、后台暂停、点击复用、取消竞态、失败降频、目标补取、实际阅读与会话边界。
- `node scripts/check-preview-browser.cjs`：固定页面完整初始化，验证原生可见性观察、缓存点击、阅读请求、设置关闭及动态深链接定位；不访问真实账号。

- `bash scripts/check.sh` 包含后台请求来源限制、固定地址、并发合并、失败重试和两个发行版状态逻辑一致性检查。
- `node scripts/check-status.cjs --browser` 使用固定页面，验证四类指标、千位分隔符、异常页面拒绝、文本渲染、折叠持久化、刷新间隔、失败提示和窄屏边界。
- 在线验证仍需在已登录 Connect 的浏览器中检查数值是否与原页面一致，并在原站阅读后观察统计变化。
- Chrome ZIP 和 Firefox XPI 使用不同后台声明；源码目录默认是 Chrome manifest。Firefox 应加载生成的 XPI。
- 尚未验证 Firefox 和油猴管理器的真实会话跨域行为；登录 Cookie、站点验证或页面结构变化都可能导致读取失败，面板提供原页面入口。
