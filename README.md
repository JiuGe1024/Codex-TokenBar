# Codex TokenBar

为 Windows 版 Codex Desktop 添加逐轮 Token 统计。在每轮最终回复下方保留一条精简统计，点击即可查看本轮详情。

![逐轮统计条](docs/images/tokenbar-inline.png)

## 功能

- **逐轮统计** — 本轮 Token、缓存命中率、截至该轮的对话累计 Token 与累计缓存率。
- **点击查看详情** — 在统计条上方悬浮显示精确输入、输出、整轮平均速度与时长。再次点击、点击外部或按 Esc 收起。
- **历史快照** — 每条统计对应自己的轮次，后续对话不会改写历史累计值。
- **简洁显示** — Token 使用 k 单位，悬停查看精确数值。详情省略上下文占用。
- **本机运行** — 只读会话用量，通过回环 CDP 连接挂载界面。

![点击统计条显示详情浮层](docs/images/tokenbar-popover.png)

以上为真实界面局部截图，红框标出统计入口。

## 快速开始

### 环境要求

- Windows 10/11 x64，已安装 Microsoft Store 版 Codex Desktop。
- Node.js 22 或更新版本。
- Windows PowerShell 和系统 .NET Framework C# 编译器，用于构建启动器。

### 构建与启动

下载仓库 ZIP 并解压，或克隆仓库后，在项目根目录运行以下命令。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./scripts/Build-TokenBar.ps1
```

构建会生成 `outputs/Codex-TokenBar.exe` 和配套快捷方式。首次右键 `outputs/Codex-TokenBar.lnk`，选择固定到任务栏，以后从这个入口打开 Codex。

请保留完整项目目录结构，启动器需要同目录项目中的脚本与模块。运行时使用 Node.js 内置模块，构建和日常使用无需安装 npm 依赖。

如果 Codex 已从原生入口打开，且未开启 CDP，请在方便时正常退出，再从 TokenBar 配套入口打开。启动器会核验官方安装、监听地址和端口所属进程。

[查看完整使用与恢复说明](docs/usage.md)

## 统计口径

| 指标 | 含义 |
| --- | --- |
| 本轮 Token | 本轮所有模型调用的输入与输出之和 |
| 输入 Token | 各次调用携带的提示、历史、工具定义及工具结果等输入累计，包含缓存命中部分 |
| 输出 Token | 官方记录的各次模型调用输出累计，包含推理与工具调用参数 |
| 本轮缓存 | 本轮缓存输入 ÷ 本轮输入 |
| 对话累计 | 截至该轮完成时的官方累计快照 |
| 累计缓存 | 累计缓存输入 ÷ 累计输入，按总量加权 |
| 整轮平均速度 | 本轮输出 Token ÷ 整轮耗时 |
| 时长 | 官方记录的整轮耗时，包含工具执行和等待 |

一轮对话可能调用模型多次，每次携带的历史都会计入输入。因此输入累计可能显著大于输出，也可能大于单次上下文窗口容量。缓存输入已经包含在输入中，总 Token 使用输入加输出计算。

平均速度与时长使用同一时间口径，两者相乘约等于输出 Token，显示值存在四舍五入误差。字段缺失、轮次归属不明确或快照冲突时显示 `--`。

## 数据与连接

- 会话文件位于当前用户的 `~/.codex/sessions`，以只读方式打开。
- 仅投影身份、用量和整轮耗时字段。JSONL 扫描会经过包含正文的文件字节，非统计内容按结构跳过，正文与凭据不作为产品数据提取或保存。
- CDP 端口固定为 `127.0.0.1:9337`，连接前核验唯一官方主页面与进程所有权。该端口提供本机调试访问，关闭端口需完全退出带调试参数启动的 Codex。
- 无遥测与外部统计服务。页面统计通过 DOM 挂载，用量数据经本机回环连接提供。

## 兼容与当前限制

- 适用于官方 Windows Codex Desktop 的 Codex 对话页面，普通 ChatGPT 页面不挂载。
- 官方原生快捷方式不会替 TokenBar 开启 CDP，日常使用配套入口。
- 页面结构或会话格式变化后，可能需要适配。身份或布局不满足校验时停止挂载。
- 运行中 CDP 断开后，后台退出。当前连接恢复需通过配套脚本重新附加。
- 分叉继承会话与归档会话尚不支持。旧格式缺少响应身份或计时字段时，相应指标显示 `--`。
- 本机已验证逐轮显示、详情浮层与任务栏分组。完整冷启动、所有 DPI、主题及多屏组合仍需进一步验证。

## 开发与验证

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm test
```

当前 24 项自动化测试覆盖响应去重、官方快照核验、缓存率、整轮平均速度、增量读取、页面隔离、浮层交互和启动生命周期。DOM 测试使用 jsdom，真实窗口布局另行检查。

| 目录 | 内容 |
| --- | --- |
| `src/` | 统计解析、状态模型、CDP 连接、页面组件及启动器源码 |
| `scripts/` | 构建、启动、关闭、诊断与任务栏配置脚本 |
| `tests/` | 自动化测试 |
| `docs/` | 使用说明与展示图片 |
| `outputs/` | 本机构建产物，Git 忽略 |
| `work/` | 本机运行状态与测试产物，Git 忽略 |

## 许可与参考

采用 MIT 许可证，详见 [LICENSE](LICENSE)。

开发过程中参考了 Usage Monitor 与 codex-statusbar 的公开实现思路。相关版本链接如下。

- [Usage Monitor](https://github.com/JiaYang-BUAA/Codex-Desktop-Usage-Monitor-Windows/tree/b87aad820961ea4c638348f94563ebdb611988f4)
- [codex-statusbar](https://github.com/dongyue-19/codex-statusbar/tree/17f0ddd25512b9a823b56a37da325d36ca53971f)

项目由社区维护，与 OpenAI 官方无隶属关系。
