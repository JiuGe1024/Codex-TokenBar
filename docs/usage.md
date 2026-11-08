# 使用与排查

## 安装

先安装 Microsoft Store 版 Codex 并登录，再安装 Node.js LTS（22 或更新版本）。下载 Release 中的 win-x64.zip，完整解压到固定文件夹。

双击 Codex-TokenBar.exe，即可启动 Codex 和统计。以后也从这个入口打开，重复点击会将已有窗口切到前台。

启动器自动检查 Node.js，缺失或版本不兼容时直接提示安装地址。首次使用时，如果 Codex 已从官方图标打开，请先正常退出一次，再双击 Codex-TokenBar.exe。

## 查看统计

每轮最终回复下方显示四项数据。点击统计长条，在上方查看输入、输出、平均速度与扣除工具后的时长。再次点击、点击外部或按 Esc 收起。

1k 等于 1,000 Token。悬停在统计项上可查看精确数值。

## 常见问题

### 提示找不到 Node.js

按启动窗口提示安装 Node.js LTS，完成后重新双击 Codex-TokenBar.exe。若仍提示缺失，重新运行 Node.js 安装程序，确保启用添加到 PATH 的选项。

### Codex 已打开，但没有统计

先正常退出 Codex，再双击 Codex-TokenBar.exe。首次从官方图标启动的窗口可能没有开放统计所需的调试接口。后台也仅在可识别的 Codex 对话页面、已有完成轮次和可见回复上显示数据。

### 停止统计与恢复原版

正常退出 Codex 后，统计后台自动结束。使用原版时，从官方 Codex 图标重新打开。

### 更新版本

正常退出 Codex，将新版完整解压到目标文件夹，再双击新版 Codex-TokenBar.exe。请保留整个解压文件夹。

## 自动恢复

连接短暂中断时，后台会自动尝试恢复。若仍没有统计，正常退出 Codex，再重新打开 Codex-TokenBar.exe。

<details>
<summary>开发诊断与连接细节</summary>

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

</details>
