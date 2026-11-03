# Windows 运行环境引导

用户不需要手动安装 Node.js。WorkBuddy 从包根目录运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/job-hunt.ps1 doctor
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/job-hunt.ps1 service start
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/job-hunt.ps1 pair
```

系统自带的 PowerShell 5.1 即可，无需额外安装 PowerShell 7。子命令和参数与原 CLI 相同，保留 `scripts/job-hunt.mjs` 供开发和其他系统使用。自动下载支持 Windows x64 / ARM64。

## 选择顺序

1. 当前用户 `.workbuddy-ai/binaries/node/versions` 内的 Node。
2. 系统 PATH 上已有的 `node.exe`。
3. job-hunt 私有运行目录内缓存的固定版本。
4. 都不可用时，准备项目专用便携 Node。

每个候选程序都实际验证版本和内存 SQLite。兼容范围为 22.20+ 的 22.x 或 24+。WorkBuddy 内部路径可能改变，找不到则转下一项，不保证所有安装都一定自带可用 Node。

固定下载版本为 **22.22.2**，唯一来源是 Node.js 官方发行目录：

```text
https://nodejs.org/download/release/v22.22.2/
```

程序固定了 x64 / ARM64 ZIP 的官方 SHA-256 摘要，关闭下载跳转并限制时间和体积。校验后只提取 `node.exe` 与 `LICENSE`，不展开 npm/node_modules，不修改注册表、系统 PATH、WorkBuddy 文件或系统执行策略。失败清理暂存；并发安装用文件锁，损坏缓存不自动覆盖。

默认缓存 `%LOCALAPPDATA%/job-hunt/runtime`。运行时、数据库和配对码都在代码包外，不参与提交或发布。缓存不能位于包内或目录联接中。

## 诊断与离线

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/job-hunt.ps1 --no-runtime-download --runtime-info
```

`--runtime-info` 输出来源（`workbuddy` / `system` / `managed`）、版本和可执行路径，不运行岗位请求。路径可能含本机用户名，不上传诊断全文。`--no-runtime-download` 禁止下载，没有兼容环境时明确失败。引导参数必须在业务命令前。

| 环境变量 | 用途 |
| --- | --- |
| `JOB_HUNT_WORKBUDDY_DIR` | WorkBuddy 根目录改变时指定位置，只读不改 |
| `JOB_HUNT_RUNTIME_DIR` | 指定包外缓存，不改变业务数据位置 |
| `JOB_HUNT_STATE_DIR` | 原有 SQLite/配对码目录，与运行时分别配置 |

`-ExecutionPolicy Bypass` 只适用于当前 PowerShell 进程，不持久改系统设置；如果组织策略禁止脚本执行，报告限制，不修改策略绕过。

## 常见错误

| 错误码 | 处理 |
| --- | --- |
| `RUNTIME_NOT_FOUND_DOWNLOAD_DISABLED` | 离线模式找不到环境，允许下载或提供兼容环境 |
| `RUNTIME_DOWNLOAD_FAILED` | 检查官方站点连通性，不自动换镜像 |
| `RUNTIME_CHECKSUM_MISMATCH` | 停止，不运行文件，检查网络和发布配置 |
| `RUNTIME_INSTALL_BUSY` | 另一引导正在安装，等其完成 |
| `RUNTIME_CACHE_INVALID` | 缓存损坏，停止服务后检查并移走该版本目录 |
| `RUNTIME_DIRECTORY_MUST_BE_OUTSIDE_PACKAGE` | 将缓存改到包外私有目录 |
| `RUNTIME_DIRECTORY_LINK_REJECTED` | 使用非目录联接路径 |
| `RUNTIME_ARCHITECTURE_UNSUPPORTED` | 自动下载只支持 Windows x64 / ARM64 |

更新固定版本与摘要时以官方 `SHASUMS256.txt` 为依据，不把新下载文件自行计算的摘要当作可信期望值。发布前测试真实官方包及隔离失败分支。
