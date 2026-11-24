// BNet SaaS 服务端入口：HTTP API + 管理控制台（GET /）+ WebSocket 代理到 DO。
// 部署模型：单租户，一个 Worker = 一家网吧。配置走 secrets / 环境变量。

import { CONSOLE_HTML } from './console';
import { doFetch, doStub, endRental, ensureComputer, err, getDefaultPricing, getSetting, getShopName, getUserByUsername, hashPassword, json, makeAdminToken, markTopupPaid, nowIso, pricePerHour, verifyAdminToken, type Env } from './lib';
import { createNativeOrder, generateOutTradeNo, notifyFailXml, notifySuccessXml, parseXml, queryOrderTradeState, verifyNotifySign } from './wechat';

export { CafeRoom } from './do';

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/' && request.method === 'GET') {
      return new Response(CONSOLE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    // WebSocket：客户端直连 Worker，Worker 转给本店唯一的 DO。
    if (path === '/ws') {
      const computerId = url.searchParams.get('computerId');
      if (!computerId) return err('missing computerId', 400);
      const doUrl = `https://do/ws?computerId=${encodeURIComponent(computerId)}`;
      return doStub(env).fetch(new Request(doUrl, request));
    }

    if (path.startsWith('/api/client/')) return this.clientApi(request, env, url);
    if (path === '/api/wechat/notify') return this.wechatNotify(request, env, url);
    if (path.startsWith('/api/admin/')) return this.adminApi(request, env, url);
    return err('not found', 404);
  },

  // ---------------- 客户端 API ----------------

  async clientApi(request: Request, env: Env, url: URL): Promise<Response> {
    const path = url.pathname;

    // GET /api/client/config?computerId=PC01
    if (path === '/api/client/config' && request.method === 'GET') {
      const pricing = await env.DB.prepare('SELECT * FROM pricing WHERE enabled = 1 ORDER BY id').all();
      const idleRaw = await getSetting(env, 'idle_shutdown_minutes', '0');
      return json({
        shopName: await getShopName(env),
        // D1 列是 snake_case，客户端要 camelCase：直接返原行会让价格全变 0
        // （name 能对上所以只剩“标准：0 元/小时”）。这里显式映射。
        pricing: (pricing.results as Array<Record<string, unknown>>).map((p) => ({
          id: p.id,
          name: p.name,
          pricePerHourCents: p.price_per_hour_cents,
          memberPriceCents: p.member_price_cents,
          vipPriceCents: p.vip_price_cents,
        })),
        // 无人使用多久后自动关机（分钟，0=关闭），控制台“设置”里改。
        idleShutdownMinutes: Math.max(0, parseInt(idleRaw, 10) || 0),
        serverTime: nowIso(),
      });
    }

    // POST /api/client/login {computerId, username, password}
    if (path === '/api/client/login' && request.method === 'POST') {
      const b = await readJson(request);
      const computerId = String(b.computerId ?? '');
      const username = String(b.username ?? '');
      const password = String(b.password ?? '');
      if (!computerId || !username || !password) return err('computerId、username、password 必填');
      const user = await getUserByUsername(env, username);
      if (!user) return err('会员不存在，请先到前台开卡', 404);
      if (user.password_hash !== (await hashPassword(username, password))) {
        return err('密码错误', 401);
      }
      const computer = await ensureComputer(env, computerId);
      if (computer.status === 'in_use' && computer.current_rental_id) {
        return err('这台电脑正在使用中', 409);
      }
      const pricing = await getDefaultPricing(env);
      if (!pricing) return err('未配置收费标准', 500);
      const rate = pricePerHour(pricing, user.type);
      if (rate <= 0) return err('收费标准无效', 500);
      if (user.balance_cents <= 0) return err('余额不足，请先充值', 402);
      const remainingSeconds = Math.floor((user.balance_cents / rate) * 3600);
      const start = new Date();
      const expiresAt = new Date(start.getTime() + remainingSeconds * 1000).toISOString();
      const ins = await env.DB.prepare(
        "INSERT INTO rentals (user_id, computer_id, start_time, amount_cents, status) VALUES (?, ?, ?, 0, 'active')",
      ).bind(user.id, computerId, start.toISOString()).run();
      const rentalId = Number(ins.meta.last_row_id);
      await env.DB.prepare('UPDATE computers SET status = ?, current_rental_id = ? WHERE id = ?')
        .bind('in_use', rentalId, computerId).run();
      await doFetch(env, '/unlock', {
        computerId, computerName: computer.name, rentalId,
        userId: user.id, username: user.username, expiresAt,
        pricePerHourCents: rate, mode: 'balance',
      });
      return json({ ok: true, rentalId, username: user.username, balanceCents: user.balance_cents, expiresAt });
    }

    // POST /api/client/logout {computerId, rentalId}
    if (path === '/api/client/logout' && request.method === 'POST') {
      const b = await readJson(request);
      const computerId = String(b.computerId ?? '');
      const rentalId = Number(b.rentalId ?? 0);
      if (!computerId || !rentalId) return err('computerId、rentalId 必填');
      // DO 内部做结算（endRental）+ 推 LOCK + 清会话，幂等。
      const res = await doFetch(env, '/end', { computerId, rentalId });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!data.ok) {
        // DO 里没有会话（例如已过期自动下机），直接按 D1 结算一次。
        const settled = await endRental(env, rentalId);
        return json({ ok: true, ...settled });
      }
      return json({ ok: true, amountCents: data.amountCents, durationSeconds: data.durationSeconds });
    }

    // POST /api/client/topup {computerId, username, amountCents} → 微信 NATIVE 下单
    if (path === '/api/client/topup' && request.method === 'POST') {
      const b = await readJson(request);
      const computerId = String(b.computerId ?? '');
      const username = String(b.username ?? '');
      const amountCents = Math.floor(Number(b.amountCents ?? 0));
      if (!computerId || !username || amountCents < 100) {
        return err('computerId、username 必填，充值金额至少 100 分（1 元）');
      }
      const user = await getUserByUsername(env, username);
      if (!user) return err('会员不存在，请先到前台开卡', 404);
      if (!env.WECHAT_APPID || !env.WECHAT_MCHID || !env.WECHAT_APIKEY) {
        return err('本店未配置微信支付，请联系网管', 503);
      }
      const orderNo = generateOutTradeNo();
      await env.DB.prepare(
        "INSERT INTO topups (order_no, user_id, computer_id, amount_cents, status) VALUES (?, ?, ?, ?, 'unpaid')",
      ).bind(orderNo, user.id, computerId, amountCents).run();
      const notifyUrl = `${url.origin}/api/wechat/notify`;
      const clientIp = request.headers.get('CF-Connecting-IP') ?? '127.0.0.1';
      try {
        const codeUrl = await createNativeOrder(
          { appId: env.WECHAT_APPID, mchId: env.WECHAT_MCHID, apiKey: env.WECHAT_APIKEY },
          `网吧充值 ${username}`, orderNo, amountCents, notifyUrl, clientIp,
        );
        return json({ ok: true, orderNo, codeUrl });
      } catch (e) {
        return err(`微信下单失败：${e instanceof Error ? e.message : String(e)}`, 502);
      }
    }

    // GET /api/client/order/:orderNo（轮询查单，只当回调的备用）
    const orderMatch = /^\/api\/client\/order\/([A-Za-z0-9]+)$/.exec(path);
    if (orderMatch && request.method === 'GET') {
      const orderNo = orderMatch[1];
      const order = await env.DB.prepare('SELECT * FROM topups WHERE order_no = ?').bind(orderNo)
        .first<{ status: string; user_id: number | null; computer_id: string }>();
      if (!order) return err('订单不存在', 404);
      if (order.status === 'unpaid' && env.WECHAT_APPID && env.WECHAT_MCHID && env.WECHAT_APIKEY) {
        const state = await queryOrderTradeState(
          { appId: env.WECHAT_APPID, mchId: env.WECHAT_MCHID, apiKey: env.WECHAT_APIKEY }, orderNo,
        );
        if (state === 'SUCCESS') {
          const paid = await markTopupPaid(env, orderNo);
          if (order.computer_id) {
            await doFetch(env, '/balance', { computerId: order.computer_id, balanceCents: paid.balanceCents ?? 0 });
          }
        }
      }
      const fresh = await env.DB.prepare('SELECT * FROM topups WHERE order_no = ?').bind(orderNo)
        .first<{ status: string; user_id: number | null }>();
      let balanceCents: number | undefined;
      if (fresh?.user_id != null) {
        const u = await env.DB.prepare('SELECT balance_cents FROM users WHERE id = ?').bind(fresh.user_id)
          .first<{ balance_cents: number }>();
        balanceCents = u?.balance_cents;
      }
      return json({ ok: true, status: fresh?.status ?? 'unpaid', balanceCents });
    }

    return err('not found', 404);
  },

  // ---------------- 微信回调 ----------------

  async wechatNotify(request: Request, env: Env, url: URL): Promise<Response> {
    void url;
    if (request.method !== 'POST') return new Response(notifyFailXml('method not allowed'), { headers: { 'Content-Type': 'text/xml' } });
    const xmlText = await request.text();
    const params = parseXml(xmlText);
    if (!env.WECHAT_APIKEY) {
      return new Response(notifyFailXml('wechat not configured'), { headers: { 'Content-Type': 'text/xml' } });
    }
    if (!verifyNotifySign(params, env.WECHAT_APIKEY)) {
      return new Response(notifyFailXml('sign error'), { headers: { 'Content-Type': 'text/xml' } });
    }
    if (params.return_code !== 'SUCCESS' || params.result_code !== 'SUCCESS') {
      return new Response(notifyFailXml('result not success'), { headers: { 'Content-Type': 'text/xml' } });
    }
    const orderNo = params.out_trade_no ?? '';
    if (!orderNo) return new Response(notifyFailXml('missing out_trade_no'), { headers: { 'Content-Type': 'text/xml' } });
    const paid = await markTopupPaid(env, orderNo);
    if (!paid.ok) return new Response(notifyFailXml('order not found'), { headers: { 'Content-Type': 'text/xml' } });
    const order = await env.DB.prepare('SELECT computer_id FROM topups WHERE order_no = ?').bind(orderNo)
      .first<{ computer_id: string }>();
    if (order?.computer_id) {
      await doFetch(env, '/balance', { computerId: order.computer_id, balanceCents: paid.balanceCents ?? 0 });
    }
    return new Response(notifySuccessXml(), { headers: { 'Content-Type': 'text/xml' } });
  },

  // ---------------- 管理后台 API ----------------

  async adminApi(request: Request, env: Env, url: URL): Promise<Response> {
    const path = url.pathname;

    // POST /api/admin/login {password} → {ok, token}
    if (path === '/api/admin/login' && request.method === 'POST') {
      const b = await readJson(request);
      if (!env.ADMIN_PASSWORD) return err('服务端未设置 ADMIN_PASSWORD', 500);
      if (String(b.password ?? '') !== env.ADMIN_PASSWORD) return err('密码错误', 401);
      const token = await makeAdminToken(env);
      return json({ ok: true, token });
    }

    if (!(await verifyAdminToken(env, request))) return err('未登录或登录已过期', 401);

    // GET /api/admin/computers（D1 电脑表 + DO 实时在线/剩余时间）
    if (path === '/api/admin/computers' && request.method === 'GET') {
      const computers = await env.DB.prepare('SELECT * FROM computers ORDER BY id').all();
      let live: Record<string, { status: string; username: string; remainingSeconds: number | null; online: boolean }> = {};
      try {
        const res = await doFetch(env, '/status');
        const data = (await res.json()) as { sessions?: Array<{ computerId: string; status: string; username: string; remainingSeconds: number | null; online: boolean }> };
        for (const s of data.sessions ?? []) live[s.computerId] = s;
      } catch { /* DO 暂不可用时只返回 D1 数据 */ }
      return json({
        ok: true,
        computers: (computers.results as Array<Record<string, unknown>>).map((c) => ({
          ...c,
          live: live[String(c.id)] ?? null,
        })),
      });
    }

    // POST /api/admin/command {computerId, command, message?, minutes?, amountCents?}
    if (path === '/api/admin/command' && request.method === 'POST') {
      const b = await readJson(request);
      const computerId = String(b.computerId ?? '');
      const command = String(b.command ?? '').toUpperCase();
      if (!computerId || !command) return err('computerId、command 必填');
      await ensureComputer(env, computerId);
      if (command === 'CREATE') {
        // 游客预付开卡：与 /api/admin/rental 同一路
        return this.adminPrepaidRental(env, computerId, Number(b.minutes ?? 0), Math.floor(Number(b.amountCents ?? 0)));
      }
      if (command === 'LOGOUT') {
        const res = await doFetch(env, '/end', { computerId });
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        return json({ ok: true, ...data });
      }
      if (command === 'LOCK') {
        await doFetch(env, '/lock', { computerId, reason: 'admin' });
        return json({ ok: true });
      }
      if (['SHUTDOWN', 'RESTART', 'PAUSE', 'RESUME', 'REFRESH', 'MESSAGE'].includes(command)) {
        await doFetch(env, '/command', { computerId, command, message: b.message });
        return json({ ok: true });
      }
      return err(`未知指令：${command}`);
    }

    // POST /api/admin/rental {computerId, minutes, amountCents} 游客预付上机
    if (path === '/api/admin/rental' && request.method === 'POST') {
      const b = await readJson(request);
      return this.adminPrepaidRental(env, String(b.computerId ?? ''), Number(b.minutes ?? 0), Math.floor(Number(b.amountCents ?? 0)));
    }

    // GET /api/admin/members | POST /api/admin/members（新建或按 id 更新）
    if (path === '/api/admin/members' && request.method === 'GET') {
      const rows = await env.DB.prepare(
        'SELECT id, username, type, balance_cents, phone, created_at FROM users ORDER BY id DESC LIMIT 200',
      ).all();
      return json({ ok: true, members: rows.results });
    }
    if (path === '/api/admin/members' && request.method === 'POST') {
      const b = await readJson(request);
      const id = Number(b.id ?? 0);
      if (id) {
        const cur = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<{ username: string }>();
        if (!cur) return err('会员不存在', 404);
        if (b.password) {
          await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
            .bind(await hashPassword(cur.username, String(b.password)), id).run();
        }
        await env.DB.prepare('UPDATE users SET type = COALESCE(?, type), phone = COALESCE(?, phone), balance_cents = COALESCE(?, balance_cents) WHERE id = ?')
          .bind(b.type ?? null, b.phone ?? null, b.balanceCents ?? null, id).run();
        return json({ ok: true });
      }
      const username = String(b.username ?? '').trim();
      const password = String(b.password ?? '');
      if (!username || !password) return err('username、password 必填');
      if (await getUserByUsername(env, username)) return err('用户名已存在', 409);
      const ins = await env.DB.prepare(
        'INSERT INTO users (username, password_hash, type, balance_cents, phone) VALUES (?, ?, ?, ?, ?)',
      ).bind(username, await hashPassword(username, password), String(b.type ?? 'member'),
        Math.floor(Number(b.balanceCents ?? 0)), String(b.phone ?? '')).run();
      return json({ ok: true, id: Number(ins.meta.last_row_id) });
    }

    // GET /api/admin/rentals | GET /api/admin/topups
    if (path === '/api/admin/rentals' && request.method === 'GET') {
      const rows = await env.DB.prepare(
        `SELECT r.*, u.username FROM rentals r LEFT JOIN users u ON u.id = r.user_id ORDER BY r.id DESC LIMIT 200`,
      ).all();
      return json({ ok: true, rentals: rows.results });
    }
    if (path === '/api/admin/topups' && request.method === 'GET') {
      const rows = await env.DB.prepare(
        `SELECT t.*, u.username FROM topups t LEFT JOIN users u ON u.id = t.user_id ORDER BY t.id DESC LIMIT 200`,
      ).all();
      return json({ ok: true, topups: rows.results });
    }

    // GET/POST /api/admin/pricing
    if (path === '/api/admin/pricing' && request.method === 'GET') {
      const rows = await env.DB.prepare('SELECT * FROM pricing ORDER BY id').all();
      return json({ ok: true, pricing: rows.results });
    }
    if (path === '/api/admin/pricing' && request.method === 'POST') {
      const b = await readJson(request);
      const id = Number(b.id ?? 0);
      const name = String(b.name ?? '标准');
      const pph = Math.floor(Number(b.price_per_hour_cents ?? 500));
      const mp = Math.floor(Number(b.member_price_cents ?? 400));
      const vp = Math.floor(Number(b.vip_price_cents ?? 300));
      const enabled = b.enabled === undefined ? 1 : (b.enabled ? 1 : 0);
      if (id) {
        await env.DB.prepare(
          'UPDATE pricing SET name = ?, price_per_hour_cents = ?, member_price_cents = ?, vip_price_cents = ?, enabled = ? WHERE id = ?',
        ).bind(name, pph, mp, vp, enabled, id).run();
        return json({ ok: true });
      }
      const ins = await env.DB.prepare(
        'INSERT INTO pricing (name, price_per_hour_cents, member_price_cents, vip_price_cents, enabled) VALUES (?, ?, ?, ?, ?)',
      ).bind(name, pph, mp, vp, enabled).run();
      return json({ ok: true, id: Number(ins.meta.last_row_id) });
    }

    // GET/POST /api/admin/settings
    if (path === '/api/admin/settings' && request.method === 'GET') {
      const rows = await env.DB.prepare('SELECT key, value FROM settings').all();
      const settings: Record<string, string> = {};
      for (const r of rows.results as Array<{ key: string; value: string }>) settings[r.key] = r.value;
      return json({ ok: true, settings });
    }
    if (path === '/api/admin/settings' && request.method === 'POST') {
      const b = await readJson(request);
      const pairs: Record<string, string> = b.settings && typeof b.settings === 'object'
        ? (b.settings as Record<string, string>)
        : (b.key ? { [String(b.key)]: String(b.value ?? '') } : {});
      for (const [k, v] of Object.entries(pairs)) {
        await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
          .bind(k, String(v)).run();
      }
      return json({ ok: true });
    }

    return err('not found', 404);
  },

  // 游客预付上机（控制台 CREATE / /api/admin/rental 共用）
  async adminPrepaidRental(env: Env, computerId: string, minutes: number, amountCents: number): Promise<Response> {
    if (!computerId) return err('computerId 必填');
    if (!minutes || minutes <= 0) return err('minutes 必须大于 0');
    if (!amountCents || amountCents < 0) return err('amountCents 无效');
    const computer = await ensureComputer(env, computerId);
    if (computer.status === 'in_use' && computer.current_rental_id) {
      return err('这台电脑正在使用中', 409);
    }
    const start = new Date();
    const expiresAt = new Date(start.getTime() + minutes * 60 * 1000).toISOString();
    const ins = await env.DB.prepare(
      "INSERT INTO rentals (user_id, computer_id, start_time, amount_cents, status) VALUES (NULL, ?, ?, ?, 'active')",
    ).bind(computerId, start.toISOString(), amountCents).run();
    const rentalId = Number(ins.meta.last_row_id);
    await env.DB.prepare('UPDATE computers SET status = ?, current_rental_id = ? WHERE id = ?')
      .bind('in_use', rentalId, computerId).run();
    await doFetch(env, '/unlock', {
      computerId, computerName: computer.name, rentalId,
      userId: null, username: '游客', expiresAt,
      pricePerHourCents: 0, mode: 'prepaid',
    });
    return json({ ok: true, rentalId, expiresAt });
  },
};
