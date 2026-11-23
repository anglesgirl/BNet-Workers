# BNet SaaS 锁屏客户端（Windows）

.NET 8 WinForms 锁屏客户端，从头重写，未移植 BNet 的 .NET Framework 老代码。
对标 BNet Cafe v4.8.0 锁屏客户端的功能：会员登录上机、计时、游客微信扫码充值、
服务端远程控制（解锁/锁屏/关机/重启/暂停/消息/刷新配置）。

服务端按同一份 API 契约实现（见 `BNetSaaSClient/Models.cs` 注释）：
WebSocket `wss://<worker-host>/ws?computerId=PC01` + HTTP `/api/client/*`。

## 目录

```
client/
├── BNetSaaSClient/              # 单项目 BNetSaaSClient（net8.0-windows）
│   ├── BNetSaaSClient.csproj
│   ├── Program.cs               # 入口：无配置先弹 ConfigForm，保存后再进锁屏
│   ├── Models.cs                # 配置 + 全部 API/WS 数据模型
│   ├── ApiClient.cs             # HTTP API：config/login/logout/topup/order
│   ├── WsClient.cs              # WebSocket：hello、心跳 30s、收指令、断线重连
│   ├── LockForm.cs              # 锁屏主窗体（全屏置顶、登录、充值、广告位）
│   ├── TimerForm.cs             # 上机计时浮窗（余额、剩余时间、下机）
│   ├── ConfigForm.cs            # 首次运行配置窗
│   ├── QrHelper.cs              # QRCoder 生成微信支付二维码
│   └── KeyboardLock.cs          # 锁屏键盘钩子（拦 Win 键 / Alt+Tab / Ctrl+Esc）
├── nuget-local/                 # Linux 沙箱离线还原用的本地包源（见下）
├── client-config.example.json   # 配置样例，部署时改名 client-config.json 放 exe 旁
└── README.md
```

## 部署（Windows 真机）

1. 在 Windows 上 `dotnet build -c Release`（或 `dotnet publish -c Release`），
   把 `bin/Release/net8.0-windows/` 下的文件拷到店里每台机器（如 `C:\BNetSaaSClient\`）。
   目标机须装 [.NET 8 Desktop Runtime](https://dotnet.microsoft.com/download/dotnet/8.0)
   （WinForms 属于 Desktop Runtime；只装 .NET 8 Runtime 不够）。
2. 复制 `client-config.example.json` 为 `client-config.json` 放 exe 同目录，
   填 `serverUrl`（店里自己的 Worker 地址）、`computerId`（如 PC01）、
   `computerName`（如 1号机）。也可以首次运行在弹出的小窗里填，会自动保存。
3. 设开机自启（任务计划 / 注册表 Run / 开始菜单启动文件夹，三选一）。

维护退出：锁屏界面按 `Ctrl+Shift+Q`（或连点 3 下右上角电脑名）→ 确认后退出。
真机部署时建议再加管理员密码确认，并用组策略禁用任务管理器（见验证清单）。

## 关键行为

- **fail-closed**：锁屏期间断线只显示“正在重连”，锁屏绝不退出；
  已解锁状态下断线超过 60 秒（看门狗 5 秒一检）自动调 logout 结算并重新锁屏。
- **计时**：以服务端给的 `expiresAt` 为准本地倒计时；时间到自动下机结算。
  收到 `welcome.status=in_use` 时自动恢复会话（客户端重启不用重新登录）。
- **充值**：选金额 → `POST /api/client/topup` 拿 `codeUrl` → QRCoder 画二维码 →
  每 3 秒轮询 `GET /api/client/order/:orderNo`，`paid` 后刷新余额；5 分钟过期。
- **广告位**：`LockForm._pnlAd`，底部通栏、高 120，空 Panel + 占位文字，
  后续接广告直接往里放图片/视频控件，位置尺寸不要挪。

## 构建

### Windows（正常方式）

```powershell
cd client\BNetSaaSClient
dotnet build -c Release
```

### Linux 沙箱（只能编译不能运行）

沙箱里的 .NET 8 SDK 在 `~/workspace/dotnet`（8.0.428，手动装的，见下）：

```bash
export DOTNET_CLI_HOME=$HOME/workspace/dotnet-home DOTNET_CLI_TELEMETRY_OPTOUT=1
export PATH=$HOME/workspace/dotnet:$PATH
cd ~/workspace/bnet-workers/client/BNetSaaSClient
dotnet build -c Release --source ~/workspace/bnet-workers/client/nuget-local
```

## Linux 下踩过的坑（都已解决，记录下来别再踩）

1. **dotnet-install 脚本装出来是坏的**：第一次用 `dotnet-install.sh` 装，
   `dotnet` 主程序是 0 字节。改用手动下载 tarball 再解压才正常：
   `curl https://builds.dotnet.microsoft.com/dotnet/Sdk/8.0.428/dotnet-sdk-8.0.428-linux-x64.tar.gz`
   解压时必须加 `--no-same-owner`，否则 tar 会尝试还原包内 uid 2001 的属主，
   在沙箱里报 `Cannot change ownership ... Operation not permitted` 导致解压失败。
   （另：`/tmp` 只有 512M tmpfs，217MB 的 tarball + 解压不能都放 `/tmp`。）
2. **Linux 版 SDK 没有 WinForms 模板**：`dotnet new winforms` 报
   `No templates or subcommands found matching: 'winforms'`。项目文件是手写的，
   界面全部用代码搭建，没有 `.Designer.cs`。
3. **NETSDK1100**：Linux 上编 `net8.0-windows` 须在 csproj 加
   `<EnableWindowsTargeting>true</EnableWindowsTargeting>`。
4. **NU1301 还原连不上 nuget.org**：沙箱走带认证的 egress 代理，
   curl 能通但 `dotnet restore` 直接连 nuget.org 会超时（11 分钟才失败）。
   解法：用 curl 把包下好放 `nuget-local/`，还原时 `--source` 只指本地源。
   本地源里已有：`QRCoder 1.6.0`、`System.Drawing.Common 6.0.0`、
   `Microsoft.Win32.SystemEvents 6.0.0`（QRCoder 的依赖）、
   `Microsoft.WindowsDesktop.App.Ref 8.0.34`。
   注意本地源文件名必须是 `{id}.{version}.nupkg` 格式。
5. **NU1102 版本锁死 8.0.34**：SDK 按本机运行时版本精确索取
   `Microsoft.WindowsDesktop.App.Ref (= 8.0.34)`，8.0.0 的包不认，
   必须备 8.0.34 版。
6. **NU1213**：`Microsoft.WindowsDesktop.App.Ref` 是 DotnetPlatform 类型包，
   **不能**直接写 `PackageReference`，否则 NU1213。
   正确做法：不写引用，`UseWindowsForms=true` 已隐含框架引用，
   SDK 还原时自动从 NuGet 源解析 targeting pack（Linux 下从本地源解析）。
7. **`System.Drawing.Common.dll` 不会出现在输出目录**：net8.0-windows 下它是
   WindowsDesktop 共享框架自带的，属正常现象，不是缺包。

## Windows 真机验证清单（Linux 沙箱无法验证，必须逐项真机测）

- [ ] 首次运行无 `client-config.json` 时弹出配置窗，填完保存后进锁屏；第二次直接进锁屏
- [ ] 锁屏全屏置顶：盖住桌面与任务栏，Alt+Tab / Win 键 / Ctrl+Esc 出不去，
      Alt+F4 关不掉；多显示器时主屏全屏（副屏行为待确认）
- [ ] 会员登录 → 计时浮窗出现、锁屏隐藏；剩余时间倒计时走字；时间到自动下机结算
- [ ] 下机按钮 → 调 logout，锁屏恢复，显示本次消费金额与时长
- [ ] 游客充值：选金额 → 二维码显示（微信能扫）→ 支付后 3 秒内轮询到 paid、余额刷新
- [ ] 服务端发 UNLOCK / LOCK / PAUSE / RESUME / MESSAGE / REFRESH 逐条验证
- [ ] SHUTDOWN / RESTART 指令真的关机/重启（先在测试机上测，别在营业机上直接试）
- [ ] 断线重锁：上机后拔网线/停 Worker 60 秒 → 自动锁屏；锁屏状态下断线 → 锁屏不退出，
      恢复后自动重连，welcome 为 in_use 时恢复会话
- [ ] Ctrl+Alt+Del / 任务管理器：应用层钩子拦不住，须配组策略或注册表禁用才完整
- [ ] 开机自启后直接进锁屏；.NET 8 Desktop Runtime 未装的机器会报什么错
- [ ] 广告位 Panel 位置尺寸：接广告素材后不遮挡登录/充值卡片
