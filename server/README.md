# BNet SaaS 服务端

网吧计费系统的 Cloudflare Workers 服务端重写（TypeScript，不移植 .NET Framework 老代码）。
对标开源 BNet Cafe v4.8.0 的功能：会员上机、按时间计费、远程指令、微信扫码支付。

**部署模型：单租户。一个部署 = 一家网吧。** 不写多租户代码；多家店就各自部署一份，
各店填自己的管理员密码、微信商户号/密钥、网吧名、收费标准。

## 架构（文字版）

```
客户端（锁屏程序 / 投币机页）
   │  wss://<worker>/ws?computerId=PC01        HTTPS API
   ▼                                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Worker（src/index.ts）                                           │
│  · HTTP API：/api/client/*、/api/admin/*、/api/wechat/notify      │
│  · 管理控制台：GET /（中文单页，内联 JS，无构建步骤）              │
│  · 微信支付：统一下单 / 查单 / 回调验签（src/wechat.ts + MD5）     │
└──────┬───────────────────────────────┬──────────────────────────┘
       │ 内部调用（stub.fetch）          │ D1 查询
       ▼                               ▼
┌──────────────────────┐      ┌──────────────────────┐
│ Durable Object       │      │ D1（SQLite）          │
│ CafeRoom（src/do.ts） │      │ users / computers /   │
│ · SQLite-backed      │      │ pricing / rentals /   │
│ · Hibernation WS：   │      │ topups / settings     │
│   一个 DO 拿全店电脑 │      │                       │
│ · alarm 计费定时：   │      │ 账单、余额、订单都在   │
│   余额耗尽/预付到期  │      │ 这里，DO 只存会话     │
│   → 推 LOCK、下机结算 │      │                       │
└──────────────────────┘      └──────────────────────┘
```

关键点：

- **WebSocket 必须用 Hibernation API**（`ctx.acceptWebSocket`）：DO 只在有消息/alarm 时才醒，
  不用时长费就不会爆炸。客户端断线只记 offline，不结束上机；重连后 `welcome` 恢复状态。
- **计费**：会员按余额扣费，单价按用户类型取 pricing 表（会员价 / VIP 价 / 标准价）；
  按分钟向上取整。余额耗尽时刻 = `余额 / 单价 × 3600 秒`，DO alarm 到点推 `LOCK` 并结算。
  游客由控制台直接预付开卡（时长 + 金额），到期同样自动锁定结算。
- **微信支付 v2**：签名算法照搬原版 `WeChatPayHelper.cs`（参数 ASCII 排序 → `k=v&…` →
  `&key=API_KEY` → MD5 大写）。Workers 的 WebCrypto 没有 MD5，所以 `src/md5.ts` 是纯 TS
  手写的 MD5 实现。原版跑在局域网收不到回调、只能轮询查单；Workers 有公网地址，
  `notify_url` 直接收回调验签、改订单、加余额、经 DO 推消息给客户端，轮询查单只当备用。
- **金额一律用分（整数）**，避免浮点误差。

## API 契约（客户端按同一份契约写）

### WebSocket：`wss://<worker-host>/ws?computerId=PC01`

客户端发：

```json
{"type": "hello", "computerId": "PC01", "computerName": "1号机", "version": "1.0.0"}
{"type": "heartbeat", "computerId": "PC01", "ts": 1699999999}
```

服务端发：

```json
{"type": "welcome", "computerId": "PC01", "status": "locked|in_use", "rentalId": 123, "remainingSeconds": 3600}
{"type": "command", "command": "UNLOCK", "rentalId": 123, "userId": 5, "username": "zhangsan", "expiresAt": "..."}
{"type": "command", "command": "LOCK", "reason": "time_expired|admin"}
{"type": "command", "command": "SHUTDOWN|RESTART|PAUSE|RESUME|REFRESH"}
{"type": "command", "command": "MESSAGE", "message": "..."}
{"type": "balance", "balanceCents": 5000}
```

### HTTP API（JSON）

| 接口 | 说明 |
|---|---|
| `GET /api/client/config?computerId=PC01` | `{shopName, pricing:[...], serverTime}` |
| `POST /api/client/login` `{computerId, username, password}` | 成功后经 DO 推 UNLOCK，返回 `{ok, rentalId, username, balanceCents, expiresAt}` |
| `POST /api/client/logout` `{computerId, rentalId}` | 按实际用时扣费，返回 `{ok, amountCents, durationSeconds}` |
| `POST /api/client/topup` `{computerId, username, amountCents}` | 微信 NATIVE 下单，返回 `{ok, orderNo, codeUrl}`（付款码内容，客户端画二维码） |
| `GET /api/client/order/:orderNo` | 轮询查单备用，返回 `{ok, status, balanceCents}` |
| `POST /api/wechat/notify` | 微信回调（XML），验签后改订单、加余额、推消息 |
| `POST /api/admin/login` `{password}` | 返回 `{ok, token}`（HMAC token，24 小时有效） |
| `GET /api/admin/computers` | 电脑列表（D1 + DO 实时在线/剩余时间） |
| `POST /api/admin/command` `{computerId, command, message?}` | LOCK / LOGOUT / SHUTDOWN / RESTART / PAUSE / RESUME / REFRESH / MESSAGE；`command:"CREATE"` + `minutes` + `amountCents` = 游客预付开卡 |
| `POST /api/admin/rental` `{computerId, minutes, amountCents}` | 游客预付上机，经 DO 推 UNLOCK 带 expiresAt |
| `GET/POST /api/admin/members` | 会员列表 / 新建（`{username, password, type, balanceCents, phone}`）或按 `id` 更新（改类型/电话/余额/密码） |
| `GET /api/admin/rentals` | 账单（上机记录） |
| `GET /api/admin/topups` | 充值记录 |
| `GET/POST /api/admin/pricing` | 收费标准（计费取第一条启用的） |
| `GET/POST /api/admin/settings` | 设置（`shop_name` 等） |

以上 admin 接口（除 login 外）都需 `Authorization: Bearer <token>`。

## 部署步骤

```bash
cd server
npm install

# 1. 建 D1 数据库（把返回的 database_id 填进 wrangler.toml）
npx wrangler d1 create bnet-workers

# 2. 跑迁移（建表 + 默认收费标准 + 网吧名）
npx wrangler d1 migrations apply bnet-workers --remote

# 3. 填 secrets（绝不在代码/仓库里写真实值）
npx wrangler secret put ADMIN_PASSWORD   # 管理员密码（控制台登录用）
npx wrangler secret put WECHAT_APPID     # 微信支付 AppID
npx wrangler secret put WECHAT_MCHID     # 微信支付商户号
npx wrangler secret put WECHAT_APIKEY    # 微信支付 v2 API 密钥（32 位）

# 4. 部署
npx wrangler deploy
```

本地校验（不部署）：`npx tsc --noEmit`、`npx wrangler deploy --dry-run`。

### 一键部署

[![Deploy to Cloudflare](https://deploy.cloudflare.com/button)](https://deploy.cloudflare.com/?url=https://github.com/anglesgirl/bnet-workers)

> 一键部署后仍需在 Cloudflare 控制台里建 D1、跑迁移、填上面 4 个 secret（Deploy 按钮不会替你填）。

## 配置项说明

| 配置 | 位置 | 说明 |
|---|---|---|
| `ADMIN_PASSWORD` | secret | 管理员密码，控制台登录用。没设则登录接口直接报错 |
| `WECHAT_APPID` / `WECHAT_MCHID` / `WECHAT_APIKEY` | secret | 各店自己的微信支付商户信息；不填则充值接口返回 503，不影响上机/下机 |
| `SHOP_NAME` | `[vars]` 或 settings 表 | 网吧名；settings 表的 `shop_name` 优先 |
| 收费标准 | 控制台「收费标准」页 / `pricing` 表 | 计费取第一条启用的；三档价：标准价 / 会员价 / VIP 价（分/小时） |
| 网吧名、其他设置 | 控制台「设置」页 / `settings` 表 | `key/value` 键值对 |

## 免费额度说明（Cloudflare 免费版，按 2026 年公开额度估算，以官方页面为准）

- **Workers**：每天 10 万次请求。网吧场景下请求量很小（上下机、充值、心跳走 WebSocket 不经过 Worker 请求计数），一家店绰绰有余。
- **Durable Objects**：每天 10 万次请求 + 13000 GB-s 时长。**必须用 Hibernation API**（本项目已用）：
  WebSocket 空闲时 DO 休眠不计时长；不用休眠的话一个 DO 常驻就把时长烧光。
  注意免费版 DO 只支持 SQLite-backed（`new_sqlite_classes`），本项目已按此配置。
- **D1**：每天读 500 万行 / 写 10 万行。上下机、充值、账单都是小写入，够用。
- **注意**：免费额度是按整个 Cloudflare 账号共享的，不要把这套部署放到收过警告的大号上；
  建议用小号或新号单独部署。

## 广告位说明（商业模式：软件免费，锁屏/付款页留广告位赚钱）

- 管理控制台（`src/console.ts`）里留了两处广告位：顶部横幅、底部横幅（`.ad-slot` 的 div，
  注释标明了位置）。接广告时把对应 div 换成广告联盟代码即可，不用改逻辑。
- 客户端（锁屏页 / 付款页）同样要留广告位：锁屏页底部横幅、付款二维码页下方横幅，
  由客户端子代理按同一思路实现；服务端不管广告内容，只留位置。
- 广告不要挡住「上机 / 扫码付款 / 解锁」主流程，不要在锁屏页放会自动跳转的广告。

## 文件清单

```
server/
├── wrangler.toml          # Worker + DO + D1 绑定、secrets 说明
├── package.json / tsconfig.json
├── migrations/0001_init.sql   # D1 建表 + 种子数据
├── src/
│   ├── index.ts   # Worker 入口：HTTP API + 控制台 + WS 代理
│   ├── do.ts      # Durable Object：Hibernation WS + alarm 计费
│   ├── lib.ts     # 共用类型/鉴权/计费结算（endRental）
│   ├── wechat.ts  # 微信支付 v2：签名/下单/查单/回调验签
│   ├── md5.ts     # 纯 TS MD5（WebCrypto 没有 MD5）
│   └── console.ts # 管理控制台单页 HTML
└── README.md
```

## 已知简化（先跑通主流程，后续再补）

- 会员密码是 SHA-256（用户名加盐），不是 bcrypt；单店内网场景够用，介意可换。
- 计费只取第一条启用的 pricing；多档套餐（包夜、包天）还没做。
- 充值只支持微信 NATIVE 扫码；支付宝后加。
- 电脑首次出现靠客户端 hello 自动注册；控制台没有手动加电脑入口（调 `/api/admin/command` 任意指令也会自动建电脑行）。
