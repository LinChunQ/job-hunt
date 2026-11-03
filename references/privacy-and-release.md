# 隐私与发布

## 公开内容

通用 skill、程序、插件、虚构示例、测试和文档。不能固化候选人姓名、项目、成绩、联系方式或个人路径。提交元数据也会公开，建议使用不透露个人信息的项目提交身份。

## 私有内容

简历、配置、SQLite 及 WAL/SHM、抓包、请求头、Cookie、令牌、配对码、岗位正文、聊天、个人话术、运行日志、备份和私钥不可发布。

- 默认数据在包外，程序拒绝包内运行目录。
- `.gitignore` 过滤数据和常见凭据文件。
- `npm run privacy` 检查工作区；`--staged` 直接检查索引，避免磁盘已改但暂存仍旧。
- `node scripts/privacy-check.mjs --staged --history` 检查索引与可达历史。仅删除工作区文件不能清理历史泄漏，泄漏后还应轮换凭据。
- 钩子需启用 `git config core.hooksPath .githooks`；新 clone 也需启用，CI 提供另一层检查。
- 报告只输出相对文件名和类别，不回显隐私值。扫描不能识别所有中文姓名或秘密，发布前仍需人工审阅。

## GitHub 与更新

1. 自行创建 GitHub 仓库并绑定远端；此包不预设账号，不自动 push。
2. 运行 `npm run github:configure -- --repository owner/repository`，同步更新来源和 README 动态徽章；不设置远端、不推送。package、release、extension 三处版本保持一致，调整版本后运行 `npm run docs:sync`。
3. 运行 `npm run check`、`npm run release:check`，审查历史；维护者选择许可证后再分发。
4. 用 `v主版本.次版本.修订号` 标签指向检查通过的提交。推送标签后，release 工作流校验版本、隐私与测试，使用 `scripts/build-release.mjs` 按受审计 Git 白名单生成 `job-hunt.zip` 并上传 Release；不压缩整个工作目录，也不包含 Git 历史和用户数据。安装入口使用该附件。
5. `update check` 只查询配置仓库的最新正式 Release，不上传本机数据。未配置时不联网。

当前不下载、执行或自动安装远程代码。`automaticUpdateEnabled` 关闭，`updatePublicKey` 留空；签名清单、哈希校验、原子安装、数据库备份迁移和回滚尚未实现。手动加载的扩展更新后仍需用户在扩展管理页重载。

## 测试

只用包外临时 SQLite 和随机密钥，结束后清理，不使用真实网站、浏览器、现有配对文件或旧数据库；不得把实际响应替换进样本。
