-- BNet SaaS 初始建表（D1）。一个部署 = 一家网吧，单租户。
-- 金额一律用分（cents）存整数，避免浮点误差。

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'member' CHECK (type IN ('member', 'vip', 'admin')),
  balance_cents INTEGER NOT NULL DEFAULT 0,
  phone TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS computers (
  id TEXT PRIMARY KEY,               -- 如 PC01
  name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('offline', 'locked', 'in_use', 'paused')),
  current_rental_id INTEGER,
  last_seen TEXT
);

CREATE TABLE IF NOT EXISTS pricing (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '标准',
  price_per_hour_cents INTEGER NOT NULL DEFAULT 500,
  member_price_cents INTEGER NOT NULL DEFAULT 400,
  vip_price_cents INTEGER NOT NULL DEFAULT 300,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS rentals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  computer_id TEXT NOT NULL REFERENCES computers(id),
  start_time TEXT NOT NULL DEFAULT (datetime('now')),
  end_time TEXT,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended'))
);

CREATE TABLE IF NOT EXISTS topups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,    -- 微信 out_trade_no，BN + 时间 + 随机
  user_id INTEGER REFERENCES users(id),
  computer_id TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

-- 种子数据：默认收费标准 + 网吧名
INSERT OR IGNORE INTO pricing (id, name, price_per_hour_cents, member_price_cents, vip_price_cents, enabled)
  VALUES (1, '标准', 500, 400, 300, 1);
INSERT OR IGNORE INTO settings (key, value) VALUES ('shop_name', '我的网吧');
