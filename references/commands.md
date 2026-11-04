# 命令与输入

Windows 从包根目录运行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/job-hunt.ps1 <命令>`，无需预先安装 Node；引导不改系统 PATH。其他系统有兼容 Node 时可用 `node scripts/job-hunt.mjs <命令>`。见 [运行环境](runtime-bootstrap.md)。输出 JSON；错误用 `errorCode` 表达。输入文件必须位于包外，UTF-8 JSON，最大 1 MB。示例只演示结构，不会自动执行。

| 命令 | 作用 |
| --- | --- |
| `install --skills-dir DIR` | 复制公开包到已核实的 skill 目录，不覆盖旧安装 |
| `setup` / `onboarding` | 启动并引导 / 只复查缺项，无站点动作 |
| `doctor` / `version` / `platforms` | 本机诊断、版本、平台 |
| `service start` / `service stop` | 启停服务 |
| `pair` | 只向当前用户展示配对码 |
| `status` / `runs` / `jobs` / `pending` | 状态、最近任务、目录、待审阅 |
| `profile get` / `profile put --input FILE` | SQLite 中的用户资料 |
| `collection list` / `collection create --input FILE` / `collection control --input FILE` | 串行采集与断点控制，详见 [采集管线](collection-pipeline.md) |
| `pool search --input FILE` / `pool action --input FILE` / `pool history --input FILE` | 岗位池分页筛选、流转与历史 |
| `task --input FILE` | 提交一次动作 |
| `reviews --input FILE` | 写评分与话术 |
| `schedule list` / `schedule put --input FILE` | 列出或保存计划 |
| `resolve --input FILE` | 人工结案不确定动作 |
| `ui` | 在系统默认浏览器打开本机工作台；`--no-open` 只返回地址 |
| `update check` | 只检测，不安装 |

`setup` 也会自动打开工作台，测试/无界面环境加 `--no-open`。网页操作见 [本机工作台](workbench.md)。

`--state-dir DIR` 指定包外私有目录；`service start --port PORT` 仅用于开发，插件固定连接默认 18674 端口。

## 搜索

```json
{"requestId":"sample-search-001","platform":"boss","action":"search","query":"示例岗位","city":"101010100"}
```

始终一页，不接受多页任务；其他筛选由 AI 本地审阅。`deferred` 表示没有派发，原因可能是离线、暂停、有未结案任务或冷却。

## 详情

```json
{"requestId":"sample-detail-001","platform":"boss","action":"details","query":"示例岗位","city":"101010100","jobId":"demo_job","page":1}
```

使用目录返回的真实关联字段。示例 jobId 不可向网站发送。已有验证正文会跳过。

## 用户资料

```json
{"displayName":"示例候选人","facts":["已确认的项目经历"],"preferences":{"keywords":["示例岗位"],"cities":["示例城市"],"salaryMin":15,"salaryMax":25,"experience":"1-3年","degree":"本科","workMode":"混合","notes":"用户偏好"}}
```

只接收白名单文本，不保存 Cookie、密钥或请求头。完整简历如需长期留存，应经授权，仅放本机包外目录。

## 审阅

```json
{"reviews":[{"sourceKey":"boss:demo_job","contextFingerprint":"从 pending 原样获取","score":75,"greeting":"您好，我有与岗位要求相关的项目经验，希望进一步沟通。","hits":["有依据的匹配点"],"reason":"结合正文说明理由","caution":"说明不足"}]}
```

指纹绑定当前 JD 与联系人；变化后旧审阅被拒绝。岗位身份字段不通过话术输入覆盖。

## 计划

```json
{"id":"example-plan","enabled":false,"intervalMinutes":30,"task":{"platform":"boss","action":"search","query":"示例岗位","city":"101010100"}}
```

示例关闭，按用户要求启用。最短 5 分钟，不是网站安全阈值。休眠期间错过的周期合并，不积压请求。不包含 AI 自动唤醒和自动发消息。

不确定任务结案：`{"requestId":"待核实编号","confirmedByUser":true}`。只有用户已核实后才能提交；仍需插件人工恢复。


## 管线输入示例

以下为虚构示例，编码必须替换为经过核实的实际值，文件放在包外。

```json
{"requestId":"example-collection","platform":"boss","keywords":["示例岗位"],"cities":[{"name":"示例城市","code":"000000001"}],"maxPages":1,"detailLimit":5,"requestBudget":20,"filters":{"salaryMin":15,"salaryMax":25,"titleExcludes":["示例排除词"],"filterUnknownSalary":false}}
```

控制输入：`{"id":"example-collection","action":"pause"}`，action 可用 `pause/resume/cancel`。

岗位检索：`{"stage":"review","sort":"score","page":1,"pageSize":15}`。

批量流转：`{"action":"archive","confirmedByUser":true,"items":[{"sourceKey":"boss:example","revision":1}]}`。revision 取最新岗位 `poolRevision`；归档需当前用户授权，不代造确认。

历史查询：`{"sourceKey":"boss:example"}`。
