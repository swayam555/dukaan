-- Server-authored ops (bill.number) carry device_id 'server', which is not a uuid.
ALTER TABLE ops ALTER COLUMN device_id TYPE text;
-- Pull is "WHERE shop_id = ? AND server_seq > ? ORDER BY server_seq": the PK already serves it.
