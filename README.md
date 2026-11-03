<!-- job-hunt:hero:start -->
<h1 align="center">job-hunt v0.1.0</h1>

<p align="center">本地求职助手：岗位采集、AI 匹配评分、个性化打招呼草稿与人工审阅。</p>

<p align="center">
  <img alt="GitHub Stars" src="https://img.shields.io/static/v1?label=Stars&amp;message=not+published&amp;color=lightgrey&amp;style=flat&amp;logo=github">
  <img alt="当前源码版本" src="https://img.shields.io/static/v1?label=version&amp;message=v0.1.0-preview&amp;color=orange&amp;style=flat">
  <img alt="Node.js 22.20+ 的 22.x 或 24+" src="https://img.shields.io/static/v1?label=Node.js&amp;message=22.20%2B+%2822.x%29+%7C+24%2B&amp;color=339933&amp;style=flat&amp;logo=nodedotjs">
  <img alt="SQLite 本地存储" src="https://img.shields.io/static/v1?label=storage&amp;message=SQLite&amp;color=003B57&amp;style=flat&amp;logo=sqlite">
  <img alt="GitHub Issues" src="https://img.shields.io/static/v1?label=issues&amp;message=not+published&amp;color=lightgrey&amp;style=flat">
  <img alt="最近提交" src="https://img.shields.io/static/v1?label=last+commit&amp;message=local+only&amp;color=lightgrey&amp;style=flat">
  <img alt="自动化检查" src="https://img.shields.io/static/v1?label=checks&amp;message=local+only&amp;color=lightgrey&amp;style=flat">
</p>

<p align="center"><a href="#快速开始">快速开始</a> · <a href="#功能与状态">功能与状态</a> · <a href="references/commands.md">命令文档</a> · <a href="#隐私与数据">隐私与数据</a></p>
<!-- job-hunt:hero:end -->

> **开发预览**：当前仅适配 BOSS 直聘。聊天支持用户确认后填入，最终由用户手动发送。托管仓库未配置时，统计徽章显示未发布状态。

把找岗位、整理职责、判断匹配与撰写话术接成一个本地工作流。你向 WorkBuddy 描述求职需求，由它调用 skill 和本机脚本；Node.js 服务保存任务与计划，浏览器插件连接你正常登录的标签页。

**不需要远程 MCP、Python 或 Fiddler。** 不启动自动化浏览器，不需要打开网站 F12 开发者工具。

## 功能与状态

| 能力 | 当前状态 | 说明 |
| --- | --- | --- |
| 普通浏览器会话连接 | 已实现 | 手动登录、一次加载扩展、侧栏配对授权 |
| 岗位搜索与职责详情 | 已实现 · BOSS | 单次一页列表或一个岗位详情 |
| 招聘人公开称呼 | 已实现 | 取公开展示的称呼和职务，缺失不猜测 |
| 岗位去重与历史记录 | 已实现 | SQLite 按平台与岗位 ID 关联 |
| 匹配评分与问候语 | WorkBuddy 执行 | 根据用户资料和验证后的 JD 生成，保存为草稿 |
| 本地定时采集 | 已实现 | 服务运行期间触发；关机、休眠期间不执行 |
| 查看与审阅 | 已实现 | 本地页面查看岗位、正文和编辑草稿；侧栏核对对象并填入 |
| 自动发送消息 | 未实现 | 当前需要用户在网页手动发送 |
| GitHub 版本检测 | 已实现入口 | 配置仓库后检查正式 Release；不会自动安装 |
| 猎聘 / 前程无忧 | 计划支持 | 已预留平台能力注册，尚无可用适配 |
| 自动安装更新 / 开机自启 | 未实现 | 不会静默修改系统启动项或执行远程代码 |

## 工作方式

```text
你用自然语言描述需求
          ↓
WorkBuddy + job-hunt skill ─── 理解条件、评分、生成话术
          ↓
本地 Node.js 服务 ──────────── 任务、定时计划、去重、SQLite
          ↕                              ↕
浏览器插件侧栏                       本地审阅页面
          ↕
你手动登录并授权的 BOSS 标签页
```

AI 分析由 WorkBuddy 提供，本服务不内置大模型，也不会在 WorkBuddy 未运行时自行唤醒它。后台新增岗位会留在待审阅数据中，供下次调用处理。

## 快速开始

### 1. 准备环境

- Node.js **22.20+ 的 22.x** 或 **24+**，目前没有第三方 npm 运行依赖。
- 支持侧栏的桌面版 Edge / Chrome。
- 能执行本机脚本的 WorkBuddy，以及你正常登录的 BOSS 账号。

将**完整项目目录**放进 WorkBuddy 可识别的 skill 目录，文件夹命名为 `job-hunt`。保留 `SKILL.md`、`scripts`、`server`、`extension` 等文件，不要只复制提示词。

### 2. 让 WorkBuddy 启动并提供配对码

可以向 WorkBuddy 说：

> 使用 job-hunt，先检查本机环境并启动服务，把插件配对码展示给我。暂时不要搜索岗位。

WorkBuddy 在包根目录运行下列命令，**用户不必自己执行**：

```sh
node scripts/job-hunt.mjs doctor
node scripts/job-hunt.mjs service start
node scripts/job-hunt.mjs pair
```

配对码仅用于当前电脑，不要发到 Issues、截图、仓库或公开日志中。

### 3. 一次加载插件并连接

1. 在浏览器打开扩展管理页：Edge 为 `edge://extensions`，Chrome 为 `chrome://extensions`。
2. 开启扩展管理页的“开发者模式”，选择“加载解压缩的扩展”，选中项目内的 `extension` 文件夹。
3. 手动打开 BOSS 并正常登录，点击插件图标打开侧栏。
4. 粘贴 WorkBuddy 给出的配对码，点击“连接当前标签页”。

扩展管理页的开发者模式与网站 F12 开发者工具是两个入口；此流程无需打开后者。

服务与插件默认端口均为 `18674`。同一本机服务共用配对码；新开的聊天标签页仍需重新点击连接授权。浏览器重启或扩展重载后，也需重新连接。

### 4. 描述需求，开始搜索与审阅

例如：

> 帮我找北京的 AI 应用开发岗位，先搜索一页。结合我提供的简历筛选，获取合适岗位的详情，再生成打招呼草稿供我审阅。

也可以说：

> 创建一个每 30 分钟检查新增岗位的采集计划，使用刚确认的城市和关键词。避免重复岗位，暂时不要发送消息。

WorkBuddy 需要先确认用户资料与搜索条件。当前搜索参数为关键词和城市编码；薪资、经验等其他偏好在本地审阅阶段处理。截图和示例不作为你的真实求职配置。

### 5. 查看结果并处理草稿

让 WorkBuddy 运行 `node scripts/job-hunt.mjs ui`，获取本地页面地址；手动打开并输入配对码，可查看岗位、职责和编辑草稿。

需要填入聊天时，手动打开对应聊天，在插件中选择草稿并标记公司、岗位、招聘人和输入框。四项有效后核对对象，确认并填入正文，最后在网页手动发送。插件中的“已发送”记录来自用户确认，不代表平台送达证明。

## 常用命令

以下命令由 WorkBuddy 在项目根目录执行：

| 命令 | 用途 |
| --- | --- |
| `node scripts/job-hunt.mjs doctor` | 环境和本机服务检查 |
| `node scripts/job-hunt.mjs service start` | 启动本地服务 |
| `node scripts/job-hunt.mjs status` | 连接、暂停、冷却和当前任务状态 |
| `node scripts/job-hunt.mjs jobs` | 查看已保存岗位 |
| `node scripts/job-hunt.mjs pending` | 查看待补详情/待审阅岗位 |
| `node scripts/job-hunt.mjs schedule list` | 查看采集计划 |
| `node scripts/job-hunt.mjs ui` | 获取本地工作台地址 |
| `node scripts/job-hunt.mjs update check` | 检测 GitHub 正式 Release 版本 |
| `node scripts/job-hunt.mjs service stop` | 停止服务 |

搜索、资料保存、审阅导入和计划配置使用包外 JSON 文件。完整结构见 [命令与输入](references/commands.md)，话术约束见 [审阅规则](references/greeting-rules.md)。

## 隐私与数据

**代码包与用户数据分开存放。** Windows 默认运行目录为 `%LOCALAPPDATA%/job-hunt`；其他系统默认为 `~/.local/share/job-hunt`。可用 `JOB_HUNT_STATE_DIR` 或 `--state-dir` 指定其他包外目录，程序拒绝将运行数据放到项目内。

| 私有文件 | 内容 | 是否提交 Git |
| --- | --- | --- |
| `history.sqlite3` 及 WAL/SHM | 求职资料、岗位、JD、评分、草稿、计划和执行记录 | 否 |
| `bridge.json` | 本机配对密钥 | 否 |
| `service.log` | 服务启动与状态信息 | 否 |
| 包外输入文件 | 用户资料、任务和审阅结果 | 否 |

公开版使用通用提示词和虚构示例，不包含真实简历、个人求职配置、抓包、认证令牌或个人项目成绩。SQLite 不提供静态加密，请保护电脑账户和目录权限。

`.gitignore`、本地提交钩子、隐私扫描和 CI 共同降低误提交风险；仍需人工审阅公开差异。服务没有云端数据库或遥测；WorkBuddy 处理资料时仍适用其自身的数据规则。README 徽章由外部图片服务提供，查看 README 时会请求这些图片，不会读取本机数据库。

详见 [隐私与发布](references/privacy-and-release.md)。原个人版不会自动替换，旧数据库也不会自动迁移到本版。

## 运行边界与常见问题

<details>
<summary><strong>插件连接成功，为什么网页看起来没动？</strong></summary>

查询在已授权标签页的会话内执行，不依赖翻页动画。用 WorkBuddy 的 `runs`、`jobs` 或本地工作台确认任务结果，连接诊断本身不会搜索岗位。

</details>

<details>
<summary><strong>验证码、登录失效或任务结果不确定怎么办？</strong></summary>

停止站点动作，在网站人工检查后通过侧栏恢复。服务不会自动重试、切换账号或网络；不确定任务需人工核实后结案。单次一页/单岗及默认 180 秒间隔是本地限制，无法保证站点接受请求。详情任务内部还包含一次列表刷新。

</details>

<details>
<summary><strong>关闭 WorkBuddy 后还能运行吗？</strong></summary>

Node.js 服务是独立本地进程，已经保存的计划可在服务运行、浏览器在线且已授权时采集；AI 审阅需 WorkBuddy 运行。关机、休眠、服务退出时不采集，恢复后合并错过的周期，不集中补跑。本版不安装开机项。

</details>

<details>
<summary><strong>能自动发消息、自动更新或切换其他平台吗？</strong></summary>

目前不能。消息由用户手动发送；更新只检测配置仓库的正式 Release，不自动下载安装；猎聘与前程无忧尚未实现。

</details>

## GitHub 托管与徽章配置

GitHub 仓库未配置时，Stars、Issues、最近提交和 CI 使用静态未发布状态；不会借用其他项目数据。标题、版本徽章及动态链接由脚本生成，避免升级时手动改漏。

创建 GitHub 仓库后，在本地运行（将示例替换为实际仓库名）：

```sh
npm run github:configure -- --repository owner/job-hunt
```

该命令同步 `release.json` 的更新来源和 README 动态徽章，不请求网络、不设置 Git 远端、不推送代码。仓库名属于公开项目标识，不应填写令牌或私人文件路径。

只刷新标题/版本徽章：

```sh
npm run docs:sync
```

项目未配置仓库时 `update check` 不联网。配置后使用 GitHub 最新正式 Release 检测版本；签名安装、原子更新、数据库迁移和回滚仍待实现。选择许可证、检查隐私和发布流程见 [发布说明](references/privacy-and-release.md)。

## 开发与检查

```sh
git config core.hooksPath .githooks
npm run check
npm run release:check
```

测试只使用虚构数据、包外临时 SQLite 和本机回环服务，不打开自动化浏览器，不访问招聘网站。项目不需要先运行 `npm install`。徽章与配置一致性已纳入检查，GitHub Actions 工作流位于 `.github/workflows/ci.yml`。

```text
job-hunt/
├── SKILL.md       WorkBuddy 操作说明
├── scripts/       本机 CLI、隐私检查、徽章配置
├── server/        Node.js 服务、SQLite、任务与计划
├── extension/     BOSS 浏览器侧栏插件
├── web/           本地查看与草稿审阅页面
├── references/    命令、架构、话术及发布说明
├── examples/      虚构输入示例
└── tests/         隔离测试
```

## 许可与后续计划

尚未选择开源许可证，不能据此假定已授权第三方复制或分发。维护者需在首次公开发布前明确许可证。

- [x] 本地 skill + Node.js 服务 + 浏览器侧栏
- [x] SQLite 去重、职责详情与草稿审阅
- [x] 本地采集计划与 GitHub 版本检测入口
- [ ] 签名更新、迁移与回滚
- [ ] 经用户确认的开机服务安装器
- [ ] 猎聘与前程无忧适配

欢迎在仓库发布后通过 Issues 提交问题；请仅提供脱敏错误码和复现步骤，不上传简历、数据库、配对码或抓包。
