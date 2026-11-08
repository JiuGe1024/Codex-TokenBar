# 使用与恢复

## 构建启动器

在仓库根目录运行以下命令。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./scripts/Build-TokenBar.ps1
```

脚本使用系统 .NET Framework 编译器生成启动器，并创建以下快捷方式。

| 文件 | 用途 |
| --- | --- |
| `outputs/Codex-TokenBar.lnk` | 启动官方 Codex 并开启统计 |
| `outputs/关闭 TokenBar.lnk` | 停止统计后台并移除统计行 |
| `outputs/打开原版 Codex.lnk` | 使用官方应用身份打开 Codex |

将 `Codex-TokenBar.lnk` 固定到任务栏。配套快捷方式包含任务栏分组身份，固定时请选择 .lnk 文件。项目目录移动后需重新生成并固定快捷方式。

## 查看统计

每轮最终回复下方显示四项数据。点击统计长条，详情浮层显示在长条上方。浮层包含输入、输出、整轮平均速度与时长。再次点击长条、点击外部或按 Esc 收起。

Token 使用 k 单位，1k 等于 1,000 Token。鼠标悬停在各项数据上，可查看精确数值与缓存输入。

## 已有窗口与重新附加

如果 Codex 正在运行且已开启合规的回环 CDP 监听，可运行以下命令恢复统计后台。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./scripts/Start-TokenBar.ps1 -AttachOnly
```

启动脚本会核验官方安装、监听地址与进程所有权。普通入口启动的 Codex 若未开启 CDP，请在方便时正常退出，再用配套入口打开。

## 停止与恢复原版使用

双击 `outputs/关闭 TokenBar.lnk`，或运行以下命令。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./scripts/Stop-TokenBar.ps1
```

后台会在下一次轮询停止并移除统计。也可取消配套入口的任务栏固定，恢复使用官方入口。带调试参数启动的 Codex 需要完全退出后再用官方入口打开，才能关闭 CDP 端口。

## 诊断

| 文件 | 内容 |
| --- | --- |
| `work/tokenbar-state.json` | 后台阶段、挂载数量、等待原因和数据警告 |
| `work/tokenbar-start-error.txt` | 最近一次启动失败的信息，可能在后续成功启动后继续保留 |

判断当前状态时，核对状态文件的更新时间。运行中连接断开后，后台会退出；恢复后可使用 AttachOnly 重新附加。

源码中的 `static-bar.mjs`、探针脚本和 Validation 启动器保留用于兼容性调查。日常入口为正式启动器或 `Start-TokenBar.ps1`。
