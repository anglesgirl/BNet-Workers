// CafeRoom：本店唯一的 Durable Object，拿着所有客户端的 WebSocket。
// SQLite-backed（new_sqlite_classes），状态存在 DO 自带的 SQLite 里；
// WebSocket 用 Hibernation API（acceptWebSocket），不占 DO 时长；
// 计费用 alarm 驱动：余额耗尽 / 预付时间到就推 LOCK 并下机结算。

import { endRental, nowIso, type Env } from './lib';

interface SessionRow {
  computerId: string;
  computerName: string;
  status: string; // locked | in_use | paused | offline
  rentalId: number | null;
  userId: number | null;
  username: string;
  expiresAt: string | null; // ISO，余额模式 = 余额耗尽时刻，预付模式 = 到期时刻
  pricePerHourCents: number;
  mode: string; // balance | prepaid
  lastSeen: number;
}

export class CafeRoom implements DurableObject {
  private ctx: DurableObjectState;
  private env: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
    // DO 自带 SQLite（new_sqlite_classes）：会话/上机状态放这里，账单放 D1。
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        computerId TEXT PRIMARY KEY,
        computerName TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'locked',
        rentalId INTEGER,
        userId INTEGER,
        username TEXT NOT NULL DEFAULT '',
        expiresAt TEXT,
        pricePerHourCents INTEGER NOT NULL DEFAULT 0,
        mode TEXT NOT NULL DEFAULT 'balance',
        lastSeen INTEGER NOT NULL DEFAULT 0
      )`);
  }

  // ---------- 对外入口：WS 升级 + Worker 的内部调用 ----------

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/ws') return this.handleWs(request, url);
    if (url.pathname === '/status' && request.method === 'GET') return this.status();
    if (request.method !== 'POST') return new Response('Not found', { status: 404 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    switch (url.pathname) {
      case '/unlock': return this.unlock(body);
      case '/lock': return this.lock(body);
      case '/command': return this.command(body);
      case '/end': return this.endSession(body);
      case '/balance': return this.pushBalance(body);
      default: return new Response('Not found', { status: 404 });
    }
  }

  // ---------- WebSocket（Hibernation） ----------

  private async handleWs(request: Request, url: URL): Promise<Response> {
    const computerId = url.searchParams.get('computerId');
    if (!computerId) return new Response('missing computerId', { status: 400 });
    const upgrade = request.headers.get('Upgrade');
    if (upgrade !== 'websocket') return new Response('expected websocket', { status: 426 });
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // Hibernation：把 socket 交给运行时托管，DO 不用为等待消息烧时长。
    // tag = computerId，之后用 getWebSockets(computerId) 精准推送。
    this.ctx.acceptWebSocket(server, [computerId]);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
    } catch {
      return;
    }
    const computerId = String(data.computerId ?? '');
    if (!computerId) return;
    if (data.type === 'hello') {
      const name = String(data.computerName ?? computerId);
      await this.upsertComputer(computerId, name);
      const s = this.getSession(computerId);
      const remaining = s?.expiresAt
        ? Math.max(0, Math.floor((new Date(s.expiresAt).getTime() - Date.now()) / 1000))
        : 0;
      ws.send(JSON.stringify({
        type: 'welcome',
        computerId,
        status: s?.rentalId ? (s.status === 'paused' ? 'paused' : 'in_use') : 'locked',
        rentalId: s?.rentalId ?? null,
        remainingSeconds: remaining,
      }));
    } else if (data.type === 'heartbeat') {
      this.touch(computerId);
      // 兜底：会话若卡在 offline（旧 bug 的残留：重连时 hello 没把状态写回去），
      // 心跳把它纠回在线状态，免得已在线的机器在控制台一直显示离线。
      const cur = this.getSession(computerId);
      if (cur && cur.status === 'offline') {
        const st = cur.rentalId ? 'in_use' : 'locked';
        this.ctx.storage.sql.exec(
          "UPDATE sessions SET status = ? WHERE computerId = ?", st, computerId,
        );
        await this.env.DB.prepare("UPDATE computers SET status = ? WHERE id = ?")
          .bind(st, computerId).run().catch(() => undefined);
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    void ws; void code; void reason; void wasClean;
    // 断线只记 offline，不结束上机：客户端重连后 welcome 会恢复状态。
    const tags = this.ctx.getTags(ws);
    const computerId = tags[0];
    if (!computerId) return;
    // 客户端重连会先开新 socket 再关旧 socket（或旧 socket 的 close 回调晚到）：
    // 还有活着的连接就别把状态打回 offline，否则在线的机器在控制台永远显示离线。
    // 注意：close 回调里 getWebSockets 仍可能含正在关闭的这条，须把它排除再数。
    const others = this.ctx.getWebSockets(computerId).filter((s) => s !== ws);
    if (others.length > 0) return;
    this.ctx.storage.sql.exec(
      "UPDATE sessions SET status = 'offline', lastSeen = ? WHERE computerId = ?",
      Date.now(), computerId,
    );
    await this.env.DB.prepare("UPDATE computers SET status = 'offline', last_seen = ? WHERE id = ?")
      .bind(nowIso(), computerId).run().catch(() => undefined);
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    void ws; void error;
  }

  // ---------- alarm：余额耗尽 / 预付到期 → 锁定下机 ----------

  async alarm(): Promise<void> {
    const now = Date.now();
    const expired = this.ctx.storage.sql
      .exec("SELECT * FROM sessions WHERE rentalId IS NOT NULL AND expiresAt IS NOT NULL AND expiresAt <= ?",
        new Date(now).toISOString())
      .toArray() as unknown as SessionRow[];
    for (const s of expired) {
      try {
        await endRental(this.env, s.rentalId as number, new Date());
      } catch {
        // 结算失败也不卡住后面的电脑：先锁屏，账单留待管理员核对。
      }
      this.sendTo(s.computerId, { type: 'command', command: 'LOCK', reason: 'time_expired' });
      this.ctx.storage.sql.exec(
        "UPDATE sessions SET status = 'locked', rentalId = NULL, userId = NULL, username = '', expiresAt = NULL WHERE computerId = ?",
        s.computerId,
      );
    }
    await this.scheduleNextAlarm();
  }

  // ---------- 内部调用（Worker 调） ----------

  private async unlock(body: Record<string, unknown>): Promise<Response> {
    const computerId = String(body.computerId ?? '');
    if (!computerId) return new Response('missing computerId', { status: 400 });
    const expiresAt = String(body.expiresAt ?? '');
    this.ctx.storage.sql.exec(
      `INSERT INTO sessions (computerId, computerName, status, rentalId, userId, username, expiresAt, pricePerHourCents, mode, lastSeen)
       VALUES (?, ?, 'in_use', ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(computerId) DO UPDATE SET status = 'in_use', rentalId = excluded.rentalId,
         userId = excluded.userId, username = excluded.username, expiresAt = excluded.expiresAt,
         pricePerHourCents = excluded.pricePerHourCents, mode = excluded.mode, lastSeen = excluded.lastSeen`,
      computerId, String(body.computerName ?? computerId),
      (body.rentalId as number | null) ?? null,
      (body.userId as number | null) ?? null,
      String(body.username ?? '游客'),
      expiresAt || null,
      (body.pricePerHourCents as number) ?? 0,
      String(body.mode ?? 'balance'),
      Date.now(),
    );
    await this.env.DB.prepare("UPDATE computers SET status = 'in_use', current_rental_id = ? WHERE id = ?")
      .bind((body.rentalId as number | null) ?? null, computerId).run().catch(() => undefined);
    this.sendTo(computerId, {
      type: 'command', command: 'UNLOCK',
      rentalId: body.rentalId ?? null, userId: body.userId ?? null,
      username: body.username ?? '游客', expiresAt: expiresAt || null,
    });
    await this.scheduleNextAlarm();
    return Response.json({ ok: true });
  }

  private async lock(body: Record<string, unknown>): Promise<Response> {
    const computerId = String(body.computerId ?? '');
    const reason = String(body.reason ?? 'admin');
    this.sendTo(computerId, { type: 'command', command: 'LOCK', reason });
    return Response.json({ ok: true });
  }

  private async command(body: Record<string, unknown>): Promise<Response> {
    const computerId = String(body.computerId ?? '');
    const command = String(body.command ?? '');
    if (!computerId || !command) return new Response('missing fields', { status: 400 });
    if (command === 'PAUSE') {
      this.ctx.storage.sql.exec("UPDATE sessions SET status = 'paused' WHERE computerId = ?", computerId);
      await this.env.DB.prepare("UPDATE computers SET status = 'paused' WHERE id = ?").bind(computerId).run().catch(() => undefined);
    } else if (command === 'RESUME') {
      this.ctx.storage.sql.exec("UPDATE sessions SET status = 'in_use' WHERE computerId = ? AND rentalId IS NOT NULL", computerId);
      await this.env.DB.prepare("UPDATE computers SET status = 'in_use' WHERE id = ? AND current_rental_id IS NOT NULL").bind(computerId).run().catch(() => undefined);
    }
    this.sendTo(computerId, {
      type: 'command', command,
      ...(body.message !== undefined ? { message: String(body.message) } : {}),
    });
    return Response.json({ ok: true });
  }

  private async endSession(body: Record<string, unknown>): Promise<Response> {
    const computerId = String(body.computerId ?? '');
    const s = this.getSession(computerId);
    if (!s?.rentalId) return Response.json({ ok: false, error: 'no active rental' });
    const result = await endRental(this.env, s.rentalId);
    this.sendTo(computerId, { type: 'command', command: 'LOCK', reason: 'admin' });
    this.ctx.storage.sql.exec(
      "UPDATE sessions SET status = 'locked', rentalId = NULL, userId = NULL, username = '', expiresAt = NULL WHERE computerId = ?",
      computerId,
    );
    await this.scheduleNextAlarm();
    return Response.json({ ok: true, ...result });
  }

  private async pushBalance(body: Record<string, unknown>): Promise<Response> {
    const computerId = String(body.computerId ?? '');
    this.sendTo(computerId, { type: 'balance', balanceCents: (body.balanceCents as number) ?? 0 });
    return Response.json({ ok: true });
  }

  private async status(): Promise<Response> {
    const rows = this.ctx.storage.sql.exec('SELECT * FROM sessions').toArray() as unknown as SessionRow[];
    const now = Date.now();
    return Response.json({
      ok: true,
      sessions: rows.map((s) => ({
        computerId: s.computerId,
        computerName: s.computerName,
        status: s.status,
        rentalId: s.rentalId,
        username: s.username,
        remainingSeconds: s.expiresAt
          ? Math.max(0, Math.floor((new Date(s.expiresAt).getTime() - now) / 1000))
          : null,
        online: this.ctx.getWebSockets(s.computerId).length > 0,
      })),
    });
  }

  // ---------- 内部帮手 ----------

  private sendTo(computerId: string, msg: unknown): void {
    const payload = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets(computerId)) {
      try { ws.send(payload); } catch { /* 断开的 socket 由运行时清理 */ }
    }
  }

  private getSession(computerId: string): SessionRow | null {
    const rows = this.ctx.storage.sql
      .exec('SELECT * FROM sessions WHERE computerId = ?', computerId)
      .toArray() as unknown as SessionRow[];
    return rows[0] ?? null;
  }

  private touch(computerId: string): void {
    this.ctx.storage.sql.exec(
      'UPDATE sessions SET lastSeen = ? WHERE computerId = ?', Date.now(), computerId,
    );
    this.env.DB.prepare('UPDATE computers SET last_seen = ? WHERE id = ?')
      .bind(nowIso(), computerId).run().catch(() => undefined);
  }

  private async upsertComputer(computerId: string, name: string): Promise<void> {
    // hello = 机器在线：有在用订单保持 in_use/paused，否则 locked。
    // 根因：旧写法 D1 只在 INSERT 时给 'locked'（冲突只改名），DO 用 INSERT OR IGNORE
    // （会话已存在就整行跳过），所以机器断线重连后状态永远卡在 offline，控制台
    // 看起来像没登记。改成每次 hello 都按当前会话状态显式回写。
    const s = this.getSession(computerId);
    const status = s?.rentalId ? (s.status === 'paused' ? 'paused' : 'in_use') : 'locked';
    await this.env.DB.prepare(
      "INSERT INTO computers (id, name, status) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, status = excluded.status",
    ).bind(computerId, name, status).run().catch(() => undefined);
    this.ctx.storage.sql.exec(
      `INSERT INTO sessions (computerId, computerName, status, lastSeen) VALUES (?, ?, ?, ?)
       ON CONFLICT(computerId) DO UPDATE SET computerName = excluded.computerName, status = excluded.status, lastSeen = excluded.lastSeen`,
      computerId, name, status, Date.now(),
    );
    await this.env.DB.prepare('UPDATE computers SET last_seen = ? WHERE id = ?')
      .bind(nowIso(), computerId).run().catch(() => undefined);
  }

  /** 把 alarm 设到最近一个到期时刻；没有在用电脑就不设。 */
  private async scheduleNextAlarm(): Promise<void> {
    const rows = this.ctx.storage.sql
      .exec('SELECT MIN(expiresAt) AS next FROM sessions WHERE rentalId IS NOT NULL AND expiresAt IS NOT NULL')
      .toArray() as unknown as { next: string | null }[];
    const next = rows[0]?.next;
    if (!next) return;
    const at = new Date(next).getTime();
    if (at > Date.now()) await this.ctx.storage.setAlarm(new Date(at));
    else await this.ctx.storage.setAlarm(new Date(Date.now() + 1000));
  }
}
