-- Prints (spec 22, ADR-0021): applied with wrangler d1 migrations apply, never execute --file
CREATE TABLE print_prices (
  tier TEXT NOT NULL CHECK (tier IN ('small', 'medium', 'large')),
  frame TEXT NOT NULL CHECK (frame IN ('unframed', 'oak')),
  amount INTEGER NOT NULL CHECK (amount > 0),   -- AUD cents, no GST
  PRIMARY KEY (tier, frame)
);
INSERT INTO print_prices (tier, frame, amount) VALUES
  ('small', 'unframed', 5900), ('small', 'oak', 13900),
  ('medium', 'unframed', 7900), ('medium', 'oak', 17900),
  ('large', 'unframed', 11900), ('large', 'oak', 25900);

CREATE TABLE print_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
INSERT INTO print_settings (key, value, updated_at) VALUES ('delivery_buffer', '0.08', 0);

CREATE TABLE print_orders (
  id TEXT PRIMARY KEY,                       -- lowercase ULID; Artelo's orderId and Stripe's client_reference_id
  country TEXT NOT NULL CHECK (length(country) = 2),
  print_total INTEGER NOT NULL,              -- AUD cents
  delivery_amount INTEGER NOT NULL,          -- AUD cents
  delivery_taxed INTEGER NOT NULL DEFAULT 0 CHECK (delivery_taxed IN (0, 1)),  -- the line reads "delivery and destination taxes"
  status TEXT NOT NULL CHECK (status IN ('checkout', 'expired', 'paid', 'needs_attention', 'placed',
    'in_production', 'shipped', 'delivered', 'cancelled', 'refunded')),
  attention_reason TEXT,
  livemode INTEGER NOT NULL CHECK (livemode IN (0, 1)),
  stripe_session_id TEXT UNIQUE,
  stripe_payment_intent TEXT UNIQUE,
  artelo_order_id TEXT UNIQUE,
  artelo_status TEXT,
  artelo_cost INTEGER,                       -- US cents, production plus shipping and any tax
  shipments TEXT CHECK (shipments IS NULL OR json_valid(shipments)),  -- [{ carrier, number, url }]
  refunded_amount INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER,
  retry_until INTEGER,
  lease_until INTEGER,
  created_at INTEGER NOT NULL,
  paid_at INTEGER,
  placed_at INTEGER,
  shipped_at INTEGER,
  refunded_at INTEGER,
  status_checked_at INTEGER,
  shipped_email_at INTEGER,
  attention_notified_at INTEGER,
  admin_notified_at INTEGER,                 -- 0 while an email to George is due (an artelo cancellation, a missed webhook), then when it went
  updated_at INTEGER NOT NULL
);
CREATE INDEX print_orders_due ON print_orders(status, next_attempt_at);
CREATE INDEX print_orders_recent ON print_orders(paid_at);

CREATE TABLE print_order_items (
  order_id TEXT NOT NULL REFERENCES print_orders(id) ON DELETE CASCADE,
  line INTEGER NOT NULL CHECK (line BETWEEN 1 AND 10),
  photo_id TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('small', 'medium', 'large')),
  size TEXT NOT NULL,                        -- Artelo ProductSize, e.g. x12x18
  frame TEXT NOT NULL CHECK (frame IN ('unframed', 'oak')),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10),
  unit_amount INTEGER NOT NULL,              -- AUD cents
  PRIMARY KEY (order_id, line)
);

CREATE TABLE stripe_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, received_at INTEGER NOT NULL);

ALTER TABLE photo_download_grants ADD COLUMN order_id TEXT;
CREATE INDEX photo_grants_order ON photo_download_grants(order_id);
