# job-hunt

可下载的本地求职助手：一个 skill、一组 Node.js 脚本服务、一个普通浏览器扩展和一个简洁审阅页面。WorkBuddy 理解需求和生成话术，本地服务维护 SQLite、任务与计划，扩展连接用户手动登录的 BOSS 标签页。

这是 **0.1.0 preview** 的独立公开版，不自动迁移既有个人版数据。支持 BOSS 岗位列表、单岗详情、招聘人公开称呼、岗位去重、话术审阅和确认填入。猎聘、前程无忧预留平台注册入口，尚未实现。自动发送、开机自启、自动安装更新和旧数据迁移均未实现。

## 安装与启动

需要 Node.js 22.20+ 的 22.x 或 24+。无需 Python 和第三方 npm 依赖。将整个包放到 WorkBuddy 可识别的 skill 目录，文件夹名为 `job-hunt`，不要只复制 `SKILL.md`。

由 WorkBuddy 在包根目录运行：

```sh
node scripts/job-hunt.mjs doctor
node scripts/job-hunt.mjs service start
node scripts/job-hunt.mjs pair
```

用户在 Edge/Chrome 扩展管理页开启开发者模式，选择“加载解压缩的扩展”，选中包内 `extension`。此步骤不需要打开网站开发者工具。正常登录 BOSS，打开扩展侧栏，粘贴 WorkBuddy 展示的配对码，连接当前标签页。插件与服务默认端口均为 `18674`。

同一本机服务共用配对码；新聊天标签页需重新连接授权。扩展重载或浏览器重启后也需重新连接。本包不替换旧个人版；同一次操作只授权所需的一个扩展，避免并行查询。

```sh
node scripts/job-hunt.mjs status
node scripts/job-hunt.mjs ui
node scripts/job-hunt.mjs service stop
```

`ui` 返回本地地址，用户手动打开并输入配对码。服务只监听本机回环地址。查看页不自动嵌入配对码。

## 数据与隐私

Windows 默认运行目录 `%LOCALAPPDATA%/job-hunt`；其他系统为 `~/.local/share/job-hunt`。`JOB_HUNT_STATE_DIR` 或 `--state-dir` 可改为其他**包外**目录。

- `history.sqlite3`：求职资料、岗位、JD、评分、草稿、计划与任务记录。
- `bridge.json`：本机配对密钥，仅供本地 CLI 与服务使用。
- `service.log`：启动与错误状态，不记录请求正文或密钥。

数据库未提供静态加密，需保护电脑账户和目录权限，不要分享运行目录。代码更新不覆盖运行目录。示例全部为虚构数据；公开提示词不包含真实个人经历或默认简历。

`.gitignore`、提交钩子、隐私扫描和 CI 降低误提交风险，不能替代发布前人工审阅。提交前运行 `npm run check`，发布前运行 `npm run release:check`。详见 [隐私与发布](references/privacy-and-release.md)。

## 工作方式

搜索一次一页；详情一次一个岗位，内部包含列表刷新和详情请求。遇到站点验证、接口异常或结果不明会暂停，需用户检查后恢复。限速不保证网站接受请求，不自动重试、切换账号或更换网络。

本地服务持久保存定时采集计划；关机、休眠或服务退出期间不运行。没有远程 MCP、云端数据库或遥测。WorkBuddy 负责审阅；本地服务不自行唤醒 WorkBuddy。

```sh
node scripts/job-hunt.mjs task --input <包外任务文件>
node scripts/job-hunt.mjs pending
node scripts/job-hunt.mjs reviews --input <包外审阅文件>
node scripts/job-hunt.mjs schedule list
node scripts/job-hunt.mjs update check
```

见 [命令与输入](references/commands.md)、[话术规则](references/greeting-rules.md) 和 [架构](references/architecture.md)。

## 本地开发

```sh
npm run check
npm run release:check
git config core.hooksPath .githooks
```

测试只使用包外临时目录及虚构数据，不访问招聘网站。提交钩子需要按上面命令启用。

尚未选择开源许可证，不能据此假定已授权第三方复制分发；首次公开发布前由维护者明确许可。GitHub 地址尚未配置；已有版本检测入口，签名安装与回滚尚未实现。
