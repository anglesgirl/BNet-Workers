-- 0002: 营业报表 / 交班
-- topups 加 channel：wechat（微信扫码充值）/ cash（前台现金手动充值）。
-- 之前的前台充值只改 users.balance_cents，没留记录，报表算不到；从此往后
-- 前台充值也写一条 topups（channel='cash'，status='paid'）。
ALTER TABLE topups ADD COLUMN channel TEXT NOT NULL DEFAULT 'wechat';

-- 交班记录：一次交班一张，快照该班次的收款与消费。
CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_time TEXT NOT NULL,   -- 本班开始（UTC ISO）
  end_time TEXT NOT NULL,     -- 交班时间（UTC ISO）
  operator TEXT NOT NULL DEFAULT '',
  topup_cash_cents INTEGER NOT NULL DEFAULT 0,   -- 现金充值
  topup_wechat_cents INTEGER NOT NULL DEFAULT 0, -- 微信充值
  rental_cents INTEGER NOT NULL DEFAULT 0,       -- 上机消费
  session_count INTEGER NOT NULL DEFAULT 0,      -- 上机人次
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
