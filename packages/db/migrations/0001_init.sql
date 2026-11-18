-- Dukaan device schema v1. Money = INTEGER paise, quantity = INTEGER milli-units, rates = basis points.

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE item (
  rowid           INTEGER PRIMARY KEY,
  id              TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  name_hi         TEXT NOT NULL DEFAULT '',
  translit        TEXT NOT NULL DEFAULT '',
  name_key        TEXT NOT NULL DEFAULT '',
  barcode         TEXT,
  hsn             TEXT NOT NULL DEFAULT '',
  category        TEXT NOT NULL DEFAULT '',
  unit            TEXT NOT NULL DEFAULT 'pcs',
  mrp_paise       INTEGER NOT NULL DEFAULT 0,
  sale_paise      INTEGER NOT NULL DEFAULT 0,
  cost_paise      INTEGER NOT NULL DEFAULT 0,
  gst_bp          INTEGER NOT NULL DEFAULT 0,
  cess_bp         INTEGER NOT NULL DEFAULT 0,
  price_incl_tax  INTEGER NOT NULL DEFAULT 1,
  track_batches   INTEGER NOT NULL DEFAULT 0,
  low_stock_milli INTEGER NOT NULL DEFAULT 0,
  image_uri       TEXT,
  deleted         INTEGER NOT NULL DEFAULT 0,
  updated_hlc     TEXT NOT NULL DEFAULT ''
);
CREATE INDEX item_barcode ON item(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX item_name_key ON item(name_key) WHERE deleted = 0;
CREATE INDEX item_category ON item(category, name_key) WHERE deleted = 0;

-- Per-field LWW clocks for item / customer / supplier master data.
CREATE TABLE field_clock (
  entity    TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  field     TEXT NOT NULL,
  hlc       TEXT NOT NULL,
  owner     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (entity, entity_id, field)
) WITHOUT ROWID;

CREATE VIRTUAL TABLE item_search USING fts5(
  name, name_hi, translit, barcode,
  content = 'item', content_rowid = 'rowid',
  tokenize = 'trigram'
);
CREATE TRIGGER item_ai AFTER INSERT ON item WHEN new.deleted = 0 BEGIN
  INSERT INTO item_search(rowid, name, name_hi, translit, barcode)
  VALUES (new.rowid, new.name, new.name_hi, new.translit, coalesce(new.barcode, ''));
END;
CREATE TRIGGER item_ad AFTER DELETE ON item WHEN old.deleted = 0 BEGIN
  INSERT INTO item_search(item_search, rowid, name, name_hi, translit, barcode)
  VALUES ('delete', old.rowid, old.name, old.name_hi, old.translit, coalesce(old.barcode, ''));
END;
CREATE TRIGGER item_au AFTER UPDATE OF name, name_hi, translit, barcode, deleted ON item BEGIN
  INSERT INTO item_search(item_search, rowid, name, name_hi, translit, barcode)
  SELECT 'delete', old.rowid, old.name, old.name_hi, old.translit, coalesce(old.barcode, '') WHERE old.deleted = 0;
  INSERT INTO item_search(rowid, name, name_hi, translit, barcode)
  SELECT new.rowid, new.name, new.name_hi, new.translit, coalesce(new.barcode, '') WHERE new.deleted = 0;
END;

CREATE TABLE item_batch (
  id          TEXT PRIMARY KEY,
  item_id     TEXT NOT NULL,
  batch_no    TEXT NOT NULL,
  expiry      TEXT,            -- YYYY-MM-DD
  mrp_paise   INTEGER NOT NULL DEFAULT 0,
  cost_paise  INTEGER NOT NULL DEFAULT 0,
  deleted     INTEGER NOT NULL DEFAULT 0,
  updated_hlc TEXT NOT NULL DEFAULT ''
) WITHOUT ROWID;
CREATE INDEX item_batch_item ON item_batch(item_id);
CREATE INDEX item_batch_expiry ON item_batch(expiry) WHERE deleted = 0;

-- Op-based PN-counter: one cell per (item, batch, device). Value = Σ(inc - dec).
CREATE TABLE stock_cell (
  item_id   TEXT NOT NULL,
  batch_id  TEXT NOT NULL DEFAULT '',
  device_id TEXT NOT NULL,
  inc_milli INTEGER NOT NULL DEFAULT 0,
  dec_milli INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, batch_id, device_id)
) WITHOUT ROWID;

-- Materialised Σ over stock_cell, maintained in the same transaction.
CREATE TABLE item_stock (
  item_id   TEXT PRIMARY KEY,
  qty_milli INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
CREATE INDEX item_stock_qty ON item_stock(qty_milli);

-- Search ranking signal: exponentially-decayed sales count.
CREATE TABLE item_rank (
  item_id   TEXT PRIMARY KEY,
  score     REAL NOT NULL DEFAULT 0,
  last_sold INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;

CREATE TABLE customer (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL DEFAULT '',
  gstin       TEXT NOT NULL DEFAULT '',
  state_code  TEXT NOT NULL DEFAULT '',
  address     TEXT NOT NULL DEFAULT '',
  credit_limit_paise INTEGER NOT NULL DEFAULT 0,
  deleted     INTEGER NOT NULL DEFAULT 0,
  updated_hlc TEXT NOT NULL DEFAULT ''
) WITHOUT ROWID;
CREATE INDEX customer_name ON customer(name COLLATE NOCASE) WHERE deleted = 0;
CREATE INDEX customer_phone ON customer(phone) WHERE deleted = 0;

CREATE TABLE supplier (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL DEFAULT '',
  gstin       TEXT NOT NULL DEFAULT '',
  state_code  TEXT NOT NULL DEFAULT '',
  deleted     INTEGER NOT NULL DEFAULT 0,
  updated_hlc TEXT NOT NULL DEFAULT ''
) WITHOUT ROWID;

-- Bills are immutable once written; amendments are separate rows.
CREATE TABLE bill (
  id              TEXT PRIMARY KEY,
  local_no        TEXT NOT NULL UNIQUE,
  global_no       INTEGER,
  device_id       TEXT NOT NULL,
  created_at      INTEGER NOT NULL,   -- unix ms (device wall clock, for reports)
  day             TEXT NOT NULL,      -- YYYY-MM-DD local date, for report grouping
  hlc             TEXT NOT NULL,
  customer_id     TEXT,
  place_of_supply TEXT NOT NULL,
  interstate      INTEGER NOT NULL DEFAULT 0,
  gross_paise     INTEGER NOT NULL,
  discount_paise  INTEGER NOT NULL,
  taxable_paise   INTEGER NOT NULL,
  cgst_paise      INTEGER NOT NULL,
  sgst_paise      INTEGER NOT NULL,
  igst_paise      INTEGER NOT NULL,
  cess_paise      INTEGER NOT NULL,
  round_off_paise INTEGER NOT NULL,
  total_paise     INTEGER NOT NULL,
  cost_paise      INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'final',  -- effective status after amendments
  status_hlc      TEXT NOT NULL DEFAULT '',
  cashier         TEXT NOT NULL DEFAULT ''
) WITHOUT ROWID;
CREATE INDEX bill_day ON bill(day, status);
CREATE INDEX bill_created ON bill(created_at DESC, id);
CREATE INDEX bill_customer ON bill(customer_id, created_at DESC) WHERE customer_id IS NOT NULL;

CREATE TABLE bill_line (
  bill_id        TEXT NOT NULL,
  line_no        INTEGER NOT NULL,
  item_id        TEXT NOT NULL,
  batch_id       TEXT NOT NULL DEFAULT '',
  name           TEXT NOT NULL,
  hsn            TEXT NOT NULL,
  unit           TEXT NOT NULL,
  qty_milli      INTEGER NOT NULL,
  unit_paise     INTEGER NOT NULL,
  mrp_paise      INTEGER NOT NULL,
  discount_paise INTEGER NOT NULL,
  taxable_paise  INTEGER NOT NULL,
  gst_bp         INTEGER NOT NULL,
  cgst_paise     INTEGER NOT NULL,
  sgst_paise     INTEGER NOT NULL,
  igst_paise     INTEGER NOT NULL,
  cess_paise     INTEGER NOT NULL,
  total_paise    INTEGER NOT NULL,
  cost_paise     INTEGER NOT NULL,
  day            TEXT NOT NULL,
  PRIMARY KEY (bill_id, line_no)
) WITHOUT ROWID;
CREATE INDEX bill_line_item_day ON bill_line(item_id, day);
CREATE INDEX bill_line_day ON bill_line(day);

CREATE TABLE bill_payment (
  bill_id      TEXT NOT NULL,
  seq          INTEGER NOT NULL,
  mode         TEXT NOT NULL,  -- cash | upi | card | credit
  amount_paise INTEGER NOT NULL,
  ref          TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (bill_id, seq)
) WITHOUT ROWID;

CREATE TABLE bill_amendment (
  id         TEXT PRIMARY KEY,
  bill_id    TEXT NOT NULL,
  hlc        TEXT NOT NULL,
  kind       TEXT NOT NULL,     -- void | note | customer
  payload    TEXT NOT NULL,
  device_id  TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX bill_amendment_bill ON bill_amendment(bill_id, hlc);

-- Parked bills never leave the device.
CREATE TABLE held_bill (
  id         TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  payload    TEXT NOT NULL,
  created_at INTEGER NOT NULL
) WITHOUT ROWID;

-- Khata: balance is SUM(amount_paise); positive = customer owes the shop.
CREATE TABLE ledger_entry (
  id           TEXT PRIMARY KEY,
  customer_id  TEXT NOT NULL,
  amount_paise INTEGER NOT NULL,
  kind         TEXT NOT NULL,  -- credit_sale | payment | adjust | opening
  bill_id      TEXT,
  note         TEXT NOT NULL DEFAULT '',
  mode         TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL,
  hlc          TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX ledger_customer ON ledger_entry(customer_id, created_at DESC, id);

CREATE TABLE purchase (
  id          TEXT PRIMARY KEY,
  supplier_id TEXT,
  invoice_no  TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  day         TEXT NOT NULL,
  total_paise INTEGER NOT NULL,
  tax_paise   INTEGER NOT NULL,
  hlc         TEXT NOT NULL,
  device_id   TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX purchase_day ON purchase(day);

CREATE TABLE purchase_line (
  purchase_id TEXT NOT NULL,
  line_no     INTEGER NOT NULL,
  item_id     TEXT NOT NULL,
  batch_id    TEXT NOT NULL DEFAULT '',
  qty_milli   INTEGER NOT NULL,
  cost_paise  INTEGER NOT NULL,
  gst_bp      INTEGER NOT NULL,
  PRIMARY KEY (purchase_id, line_no)
) WITHOUT ROWID;

CREATE TABLE stock_adjustment (
  id         TEXT PRIMARY KEY,
  item_id    TEXT NOT NULL,
  batch_id   TEXT NOT NULL DEFAULT '',
  delta_milli INTEGER NOT NULL,
  reason     TEXT NOT NULL,   -- damage | expiry | count | theft | opening | other
  note       TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  hlc        TEXT NOT NULL,
  device_id  TEXT NOT NULL
) WITHOUT ROWID;

-- The op log is also the audit log.
CREATE TABLE op_log (
  op_id      TEXT PRIMARY KEY,
  device_id  TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  TEXT NOT NULL,
  type       TEXT NOT NULL,
  payload    TEXT NOT NULL,
  hlc        TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'cashier',
  server_seq INTEGER,
  local      INTEGER NOT NULL,     -- 1 = authored here, 0 = pulled
  applied_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX op_log_pending ON op_log(hlc) WHERE server_seq IS NULL AND local = 1;
CREATE INDEX op_log_entity ON op_log(entity, entity_id, hlc);
CREATE INDEX op_log_hlc ON op_log(hlc);

-- Ops that could not be applied (clock drift, unknown type from a newer app version).
CREATE TABLE op_quarantine (
  op_id   TEXT PRIMARY KEY,
  raw     TEXT NOT NULL,
  reason  TEXT NOT NULL,
  at      INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE sync_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;

-- Per-device bill series: no collisions while offline.
CREATE TABLE bill_series (
  prefix   TEXT PRIMARY KEY,
  next_seq INTEGER NOT NULL
) WITHOUT ROWID;

-- CSV import checkpoints (resumable).
CREATE TABLE import_job (
  id          TEXT PRIMARY KEY,
  source      TEXT NOT NULL,
  byte_offset INTEGER NOT NULL DEFAULT 0,
  rows_done   INTEGER NOT NULL DEFAULT 0,
  rows_failed INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL,
  mapping     TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
) WITHOUT ROWID;

-- Printer retry queue.
CREATE TABLE print_job (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  ref_id     TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL,    -- queued | printing | done | failed
  last_error TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
) WITHOUT ROWID;
