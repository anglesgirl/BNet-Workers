# BNet SaaS — 网吧管理系统（Cloudflare Workers 重写版）

对标 [BNet Cafe](https://github.com/anglesgirl/BNet.Cafe)（Bryan Bodino 的开源网吧计费系统 v4.8.0）的功能，从头重写。
不移植 .NET Framework 老代码。部署形态是 Cloudflare Workers serverless，
**每家网吧自己申请自己的 Workers 账号、部署自己的实例，单租户，不做多租户隔离**。
开发者不跑任何基础设施。软件免费，锁屏/付款页留广告位赚钱。

## 架构

```
网吧每台电脑                        Cloudflare（每家店自己的账号）
┌─────────────────┐   wss://      ┌──────────────────────────────────┐
│ 锁屏客户端        │ ◄──────────► │ Worker（HTTP API + 控制台）       │
│ .NET 8 WinForms  │   WebSocket   │   ├─ Durable Object（一个 DO）    │
│ 锁屏/登录/扫码充值│               │   │   拿着本店所有客户端的 WebSocket │
│ 计时浮窗/断线重锁 │   https://    │   │   计费定时（alarm）+ 状态机      │
└─────────────────┘ ◄──────────► │   └─ D1（会员/电脑/账单/充值/价格）│
                                  │   微信支付回调 notify_url（公网直收）│
                                  └──────────────────────────────────┘
网吧主电脑：浏览器打开 Worker 地址就是控制台
```

## 目录

| 目录 | 内容 |
| --- | --- |
| `server/` | Workers 服务端（TypeScript）：Worker 入口、Durable Object、D1 迁移、中文控制台、部署文档 |
| `client/` | Windows 锁屏客户端（C#，.NET 8 WinForms） |

详细文档见 [server/README.md](server/README.md) 与 [client/README.md](client/README.md)。

## 全流程（已跑通最简版）

1. 会员在锁屏输入用户名密码 → `POST /api/client/login` → 服务端开 rental → DO 推 `UNLOCK` → 客户端解锁进桌面，计时浮窗开始倒计时。
2. 余额按分钟扣费（向上取整），余额耗尽或预付到期 → DO alarm 推 `LOCK` → 自动下机结算。
3. 余额不足时锁屏扫码充值 → `POST /api/client/topup` 生成微信支付订单 → 扫码付款 → 微信回调 `POST /api/wechat/notify` 直接收（Workers 有公网地址，不用轮询；轮询查单只当备用）→ 加余额 → DO 推 `balance`。
4. 下机 → `POST /api/client/logout` 按实际用时结算。
5. 游客：控制台直接开预付上机（选电脑、选分钟数），DO 推带 `expiresAt` 的 `UNLOCK`。
6. 管理员在控制台可对任意电脑发指令：锁定 / 解锁 / 关机 / 重启 / 暂停 / 恢复 / 消息 / 刷新。

## 每家店自己部署（按顺序做）

```bash
# 1. 装 wrangler，登录自己的 Cloudflare 账号
npm install -g wrangler
wrangler login

# 2. 进 server 目录，装依赖
cd server && npm install

# 3. 建 D1 数据库，把返回的 database_id 填进 wrangler.toml
npx wrangler d1 create bnet-workers

# 4. 跑建表迁移（本地 + 线上）
npx wrangler d1 migrations apply bnet-workers --local
npx wrangler d1 migrations apply bnet-workers --remote

# 5. 填 4 个 secret（各店自己的，绝不写进代码）
wrangler secret put ADMIN_PASSWORD   # 控制台管理员密码
wrangler secret put WECHAT_APPID     # 微信支付 AppID
wrangler secret put WECHAT_MCHID     # 微信支付商户号
wrangler secret put WECHAT_APIKEY    # 微信支付 v2 API 密钥（32 位）

# 6. 部署
npx wrangler deploy
```

也可以点 server/README.md 里的 **Deploy to Cloudflare** 一键部署按钮（部署完再按上面步骤填 secrets 和跑迁移）。

## 客户端安装（每台机器）

1. 目标机器装 [.NET 8 Desktop Runtime](https://dotnet.microsoft.com/download/dotnet/8.0)。
2. 把 `client/BNetSaaSClient/bin/Release/net8.0-windows/` 下的文件拷到机器上（或等发布包）。
3. 首次运行弹配置窗，填：服务端地址（如 `https://bnet-workers-server.<你的子域>.workers.dev`）、电脑编号（如 `PC01`）、电脑名（如 `1号机`），保存后进锁屏。
4. 设开机自启（放启动文件夹或计划任务）。

## 配置项

| 配置 | 位置 | 说明 |
| --- | --- | --- |
| 管理员密码 | Worker secret `ADMIN_PASSWORD` | 控制台登录 |
| 微信 AppID / 商户号 / API 密钥 | Worker secrets `WECHAT_APPID` / `WECHAT_MCHID` / `WECHAT_APIKEY` | 各店自己的商户号 |
| 网吧名、收费标准 | 控制台 → 设置 / 收费标准（存 D1） | 标准价 / 会员价 / VIP 价（分/小时） |
| 服务端地址、电脑编号 | 客户端 `client-config.json` | 每台机器一份 |

## 免费额度（十几台电脑的小网吧够用）

- Worker：每天 10 万次请求；DO：每天 10 万次请求 + 13000 GB-s 时长；D1：每天读 500 万行、写 10 万行。
- WebSocket 必须走 Hibernation API（本项目已用），否则 DO 时长费会爆炸；DO 必须用 SQLite-backed（`new_sqlite_classes`，免费版只支持这个）。
- 部署不要放大号：10 万次/天是全账号共享的，每家店用自己的账号。

## 广告位

- 锁屏底部通栏广告位（`LockForm` 的 `_pnlAd`，高 120），付款页/控制台顶部与底部各留了一个标注好的 div。后续往里放素材即可，不遮挡登录与充值卡片。

## 已知简化（后续再做）

- 计费只取第一条启用的 pricing；没有包夜/包天套餐、没有支付宝。
- 控制台「会员充值」是读余额再累加的两步操作，并发下可能有竞态，单店人工操作可接受。
- 没做远程桌面/屏幕查看、聊天、库存/小卖部、积分——BNet 原版有，重写时先砍掉，只保留上下机计费主线。
- 客户端 `expiresAt` 为空时默认按 1 小时计时。

## 必须在 Windows 真机上验的（沙箱只能编译，不能运行）

服务端（需真实账号与商户号）：
- `wrangler d1 create`、迁移 `--remote`、4 个 secret、`wrangler deploy` 全流程。
- 微信支付全流程：真实商户号下单、扫码、到账回调、客户端收到余额推送；回调失败时轮询查单备用路径。
- 真实锁屏客户端连 `wss://…/ws`，验 hello/welcome、UNLOCK/LOCK 等指令、余额耗尽自动锁定。
- 线上跑一段时间后看 Cloudflare 控制台 DO 时长，确认 Hibernation 生效。

客户端（Windows 真机）：
- 锁屏全屏置顶、Alt+Tab/Win 键拦截、Ctrl+Alt+Del 与任务管理器（钩子拦不住，须组策略禁用）。
- 会员登录 → 计时 → 下机全流程；微信二维码真扫支付与余额刷新。
- UNLOCK/LOCK/PAUSE/RESUME/MESSAGE/REFRESH 逐条指令；SHUTDOWN/RESTART 真关机（测试机上先测）。
- 断线 60 秒自动重锁、断线时锁屏不退出；开机自启；.NET 8 Desktop Runtime 缺失时的表现。
