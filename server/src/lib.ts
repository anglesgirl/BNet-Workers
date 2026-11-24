// Worker 与 DO 共用的类型、鉴权、计费逻辑。

export interface Env {
  DB: D1Database;
  CAFE_ROOM: DurableObjectNamespace;
  ADMIN_PASSWORD?: string;
  WECHAT_APPID?: string;
  WECHAT_MCHID?: string;
  WECHAT_APIKEY?: string;
  SHOP_NAME?: string;
}

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  type: 'member' | 'vip' | 'admin';
  balance_cents: number;
  phone: string;
  created_at: string;
}

export interface PricingRow {
  id: number;
  name: string;
  price_per_hour_cents: number;
  member_price_cents: number;
  vip_price_cents: number;
  enabled: number;
}

export interface RentalRow {
  id: number;
  user_id: number | null;
  computer_id: string;
  start_time: string;
  end_time: string | null;
  amount_cents: number;
  status: 'active' | 'ended';
}

export interface ComputerRow {
  id: string;
  name: string;
  status: 'offline' | 'locked' | 'in_use' | 'paused';
  current_rental_id: number | null;
  last_seen: string | null;
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function err(message: string, status = 400): Response {
  return json({ ok: false, error: message }, status);
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** 北京时间（UTC+8，无夏令时）的 YYYY-MM-DD。报表按这个日期算。 */
export function shanghaiDate(d: Date): string {
  const sh = new Date(d.getTime() + 8 * 3600 * 1000);
  return sh.toISOString().slice(0, 10);
}

/** 当前班次开始时间：settings 的 shift_start，没交过班就取今天 0 点（北京时间）对应的 UTC。 */
export async function getShiftStart(env: Env): Promise<string> {
  const v = await getSetting(env, 'shift_start', '');
  if (v) return v;
  // 今天 0 点（北京时间）= 昨天 16:00 UTC
  const today = shanghaiDate(new Date());
  return `${today}T16:00:00.000Z`;
}

/** 班次/时段聚合：已支付充值（现金/微信分开）+ 已结束上机的消费与人次。时间是 UTC ISO。 */
export async function shiftAgg(env: Env, start: string, end: string): Promise<{
  topupCashCents: number; topupWechatCents: number; rentalCents: number; sessionCount: number;
}> {
  const top = await env.DB.prepare(
    `SELECT channel, COALESCE(SUM(amount_cents), 0) AS s FROM topups WHERE status = 'paid' AND paid_at >= ? AND paid_at < ? GROUP BY channel`,
  ).bind(start, end).all();
  let cash = 0, wechat = 0;
  for (const r of top.results as Array<{ channel: string; s: number }>) {
    if (r.channel === 'cash') cash = r.s; else wechat += r.s;
  }
  const rent = await env.DB.prepare(
    `SELECT COALESCE(SUM(amount_cents), 0) AS amt, COUNT(*) AS cnt FROM rentals WHERE status = 'ended' AND end_time >= ? AND end_time < ?`,
  ).bind(start, end).first<{ amt: number; cnt: number }>();
  return {
    topupCashCents: cash, topupWechatCents: wechat,
    rentalCents: rent?.amt ?? 0, sessionCount: rent?.cnt ?? 0,
  };
}

/** 会员密码哈希：SHA-256(username + ':' + password)，WebCrypto 可用，无需 MD5。 */
export async function hashPassword(username: string, password: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${username}:${password}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- 管理员 token：HMAC-SHA256(ADMIN_PASSWORD) over `admin:<exp>`，24 小时有效，无状态 ----------

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function makeAdminToken(env: Env): Promise<string | null> {
  if (!env.ADMIN_PASSWORD) return null;
  const exp = Math.floor(Date.now() / 1000) + 24 * 3600;
  const msg = `admin:${exp}`;
  const key = await hmacKey(env.ADMIN_PASSWORD);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return `${exp}.${toHex(sig)}`;
}

export async function verifyAdminToken(env: Env, req: Request): Promise<boolean> {
  if (!env.ADMIN_PASSWORD) return false;
  const auth = req.headers.get('Authorization') ?? '';
  const m = /^Bearer (.+)$/.exec(auth);
  if (!m) return false;
  const [expStr, sigHex] = m[1].split('.');
  const exp = Number(expStr);
  if (!expStr || !sigHex || Number.isNaN(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const key = await hmacKey(env.ADMIN_PASSWORD);
  const expected = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`admin:${exp}`));
  return toHex(expected) === sigHex.toLowerCase();
}

// ---------- D1 小帮手 ----------

export async function getSetting(env: Env, key: string, fallback = ''): Promise<string> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? fallback;
}

export async function getShopName(env: Env): Promise<string> {
  return getSetting(env, 'shop_name', env.SHOP_NAME ?? '我的网吧');
}

/** 计费用的默认价格：第一条 enabled 的 pricing。 */
export async function getDefaultPricing(env: Env): Promise<PricingRow | null> {
  return env.DB.prepare('SELECT * FROM pricing WHERE enabled = 1 ORDER BY id LIMIT 1').first<PricingRow>();
}

/** 按用户类型取每小时单价（分）。游客按标准价。 */
export function pricePerHour(p: PricingRow, userType: string | null): number {
  if (userType === 'vip') return p.vip_price_cents;
  if (userType === 'member') return p.member_price_cents;
  return p.price_per_hour_cents;
}

/** 按分钟向上取整计费：amount = ceil(分钟数 × 每小时价 / 60)。 */
export function calcAmountCents(durationSeconds: number, pricePerHourCents: number): number {
  const minutes = Math.ceil(durationSeconds / 60);
  return Math.ceil((minutes * pricePerHourCents) / 60);
}

export async function getUserByUsername(env: Env, username: string): Promise<UserRow | null> {
  return env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first<UserRow>();
}

export async function ensureComputer(env: Env, computerId: string, name = ''): Promise<ComputerRow> {
  await env.DB.prepare(
    'INSERT OR IGNORE INTO computers (id, name, status) VALUES (?, ?, ?)',
  ).bind(computerId, name || computerId, 'locked').run();
  if (name) {
    await env.DB.prepare('UPDATE computers SET name = ? WHERE id = ? AND (name = ? OR name = "")')
      .bind(name, computerId, computerId).run();
  }
  const row = await env.DB.prepare('SELECT * FROM computers WHERE id = ?').bind(computerId).first<ComputerRow>();
  if (!row) throw new Error(`computer ${computerId} not found after upsert`);
  return row;
}

// ---------- 下机结算（Worker 与 DO 共用） ----------

/**
 * 结束一笔 rental：按实际用时计费。
 * - 会员/ VIP（user_id 非空）：从余额扣费（余额不足时扣到 0 为止，多扣的部分记 0，不欠费）。
 * - 游客预付（user_id 为空）：amount_cents 保持下单时定的预付金额，不再另扣。
 * 返回 { amountCents, durationSeconds }。
 */
export async function endRental(
  env: Env,
  rentalId: number,
  endAt: Date = new Date(),
): Promise<{ amountCents: number; durationSeconds: number }> {
  const rental = await env.DB.prepare('SELECT * FROM rentals WHERE id = ?').bind(rentalId).first<RentalRow>();
  if (!rental) throw new Error(`rental ${rentalId} not found`);
  if (rental.status === 'ended') {
    return { amountCents: rental.amount_cents, durationSeconds: 0 };
  }
  const start = new Date(rental.start_time).getTime();
  const durationSeconds = Math.max(0, Math.floor((endAt.getTime() - start) / 1000));
  let amountCents = rental.amount_cents;
  if (rental.user_id != null) {
    const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(rental.user_id).first<UserRow>();
    const pricing = await getDefaultPricing(env);
    const rate = pricing ? pricePerHour(pricing, user?.type ?? 'member') : 0;
    amountCents = calcAmountCents(durationSeconds, rate);
    if (user) {
      const deduct = Math.min(user.balance_cents, amountCents);
      await env.DB.prepare('UPDATE users SET balance_cents = balance_cents - ? WHERE id = ?')
        .bind(deduct, user.id).run();
    }
  }
  await env.DB.prepare("UPDATE rentals SET status = 'ended', end_time = ?, amount_cents = ? WHERE id = ?")
    .bind(endAt.toISOString(), amountCents, rentalId).run();
  await env.DB.prepare("UPDATE computers SET status = 'locked', current_rental_id = NULL WHERE current_rental_id = ?")
    .bind(rentalId).run();
  return { amountCents, durationSeconds };
}

// ---------- DO 内部调用 ----------

export function doStub(env: Env): DurableObjectStub {
  return env.CAFE_ROOM.get(env.CAFE_ROOM.idFromName('main'));
}

export async function doFetch(env: Env, path: string, body?: unknown): Promise<Response> {
  return doStub(env).fetch(`https://do${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** 订单到账后的统一处理（回调与轮询共用，幂等：只有 unpaid 的订单会改状态）。 */
export async function markTopupPaid(env: Env, orderNo: string): Promise<{ ok: boolean; balanceCents?: number }> {
  const order = await env.DB.prepare('SELECT * FROM topups WHERE order_no = ?').bind(orderNo)
    .first<{ id: number; user_id: number | null; computer_id: string; amount_cents: number; status: string }>();
  if (!order) return { ok: false };
  if (order.status === 'paid') {
    const user = order.user_id
      ? await env.DB.prepare('SELECT balance_cents FROM users WHERE id = ?').bind(order.user_id).first<{ balance_cents: number }>()
      : null;
    return { ok: true, balanceCents: user?.balance_cents };
  }
  await env.DB.prepare("UPDATE topups SET status = 'paid', paid_at = ? WHERE order_no = ?")
    .bind(nowIso(), orderNo).run();
  let balanceCents: number | undefined;
  if (order.user_id != null) {
    await env.DB.prepare('UPDATE users SET balance_cents = balance_cents + ? WHERE id = ?')
      .bind(order.amount_cents, order.user_id).run();
    const user = await env.DB.prepare('SELECT balance_cents FROM users WHERE id = ?').bind(order.user_id).first<{ balance_cents: number }>();
    balanceCents = user?.balance_cents;
  }
  return { ok: true, balanceCents };
}
