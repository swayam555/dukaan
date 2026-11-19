-- Phase 5: sync engine.
-- Bulk-imported items get one clock for the whole row (base_hlc) instead of a field_clock row per field:
-- 100k imported SKUs would otherwise mean ~1.3M clock rows. A field without its own clock falls back to it.
ALTER TABLE item ADD COLUMN base_hlc TEXT NOT NULL DEFAULT '';
ALTER TABLE item ADD COLUMN base_owner INTEGER NOT NULL DEFAULT 0;
-- Pulled-op cursor and push bookkeeping live in sync_state; rejected local ops are kept with server_seq = -1.
CREATE INDEX op_log_seq ON op_log(server_seq) WHERE server_seq IS NOT NULL;
