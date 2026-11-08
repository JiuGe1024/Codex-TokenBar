# 使用与排查

## 安装

先安装 Microsoft Store 版 Codex 并登录，再安装 Node.js LTS（22 或更新版本）。下载 Release 中的 win-x64.zip，完整解压到固定文件夹。

正常退出已经打开的 Codex，再双击 Codex-TokenBar.exe，即可启动 Codex 和统计。以后也从这个入口打开。

需要任务栏入口时，双击创建快捷方式.exe，将 outputs 文件夹里的 Codex-TokenBar.lnk 固定到任务栏。移动文件夹后重新创建快捷方式。启动遇到问题时，再运行环境检查.exe 查看原因。

发布包根目录提供以下入口。

| 文件 | 用途 |
| --- | --- |
| Codex-TokenBar.exe | 启动官方 Codex 并连接统计 |
| 环境检查.exe | 显示 Node.js、Codex 和工作目录检查结果 |
| 创建快捷方式.exe | 生成本机路径对应的任务栏入口和辅助快捷方式 |
| 关闭统计.exe | 停止统计后台并移除统计行 |
| 打开原版.exe | 使用官方入口打开 Codex |

## 查看统计

每轮最终回复下方显示四项数据。点击统计长条，在上方查看输入、输出、平均速度与扣除工具后的时长。再次点击、点击外部或按 Esc 收起。

1k 等于 1,000 Token。悬停在统计项上可查看精确数值。

## 常见问题

### 提示找不到 Node.js

从 Node.js 官网安装 LTS 版本，完成后关闭并重新打开环境检查.exe。若仍失败，确认安装时已添加 PATH；也可在 Windows 终端运行 node --version 检查。

### Codex 已打开，但没有统计

先正常退出 Codex，再双击 Codex-TokenBar.exe。首次从官方图标启动的窗口可能没有开放统计所需的调试接口。后台也仅在可识别的 Codex 对话页面、已有完成轮次和可见回复上显示数据。

### 任务栏出现两个图标

取消旧 TokenBar 图标的固定，运行创建快捷方式.exe，然后固定 outputs 中生成的 Codex-TokenBar.lnk。首次使用请选择配套快捷方式。

### 停止统计与恢复原版

双击关闭统计.exe。后台在下一次轮询停止并清理页面节点。取消配套入口的任务栏固定，再使用官方入口。若要关闭调试端口，需正常退出 Codex 后从官方入口重开。

### 更新版本

先关闭统计，将新版完整解压到目标文件夹，再创建并固定新版快捷方式。保留完整目录结构。运行记录位于 work 文件夹，会话原始数据由 Codex 管理。

## 自动恢复与诊断

启动脚本持有单实例锁，初次传输连接最多三次尝试。运行中断线按 1、2、4 秒间隔最多重新附加三次，每次重新验证官方安装、进程、监听及目标页面。恢复次数在本次启动期间累计。

官方进程退出、主动停止或安全校验失败会结束启动链。额度耗尽后可关闭统计，再重新打开配套入口。已有合规监听时，也可通过下列开发命令重新附加。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./scripts/Start-TokenBar.ps1 -AttachOnly
```

| 文件 | 内容 |
| --- | --- |
| work/tokenbar-state.json | 当前后台阶段、挂载数量、数据与布局警告 |
| work/tokenbar-start-error.txt | 最近一次启动失败记录，成功启动后可能继续保留 |

请结合更新时间判断当前状态。reconnecting 表示正在重试；reconnect-exhausted 表示恢复额度耗尽；validation-failed 表示进程或监听校验失败；incompatible-or-failed 表示目标、协议或页面执行异常。

完整实测范围见 [验证记录](validation.md)。
