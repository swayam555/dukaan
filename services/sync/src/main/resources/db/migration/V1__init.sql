CREATE TABLE shop (
    id          uuid PRIMARY KEY,
    name        text NOT NULL,
    gstin       text NOT NULL DEFAULT '',
    state_code  text NOT NULL DEFAULT '',
    owner_phone text NOT NULL UNIQUE,
    next_seq    bigint NOT NULL DEFAULT 1,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE device (
    id          uuid PRIMARY KEY,
    shop_id     uuid NOT NULL REFERENCES shop(id),
    name        text NOT NULL,
    prefix      text NOT NULL,
    role        text NOT NULL CHECK (role IN ('owner', 'cashier')),
    ack_seq     bigint NOT NULL DEFAULT 0,
    fcm_token   text,
    revoked     boolean NOT NULL DEFAULT false,
    last_seen   timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (shop_id, prefix)
);

-- Op log: hash-partitioned by shop (pruning for pull), then range-partitioned by month (retention, vacuum).
CREATE TABLE ops (
    shop_id     uuid        NOT NULL,
    server_seq  bigint      NOT NULL,
    op_id       uuid        NOT NULL,
    device_id   uuid        NOT NULL,
    entity      text        NOT NULL,
    entity_id   text        NOT NULL,
    type        text        NOT NULL,
    hlc         text        NOT NULL,
    role        text        NOT NULL,
    payload     jsonb       NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (shop_id, server_seq, received_at)
) PARTITION BY HASH (shop_id);

DO $$
DECLARE i int;
BEGIN
  FOR i IN 0..15 LOOP
    EXECUTE format('CREATE TABLE ops_h%s PARTITION OF ops FOR VALUES WITH (MODULUS 16, REMAINDER %s) PARTITION BY RANGE (received_at)', i, i);
    EXECUTE format('CREATE TABLE ops_h%s_default PARTITION OF ops_h%s DEFAULT', i, i);
  END LOOP;
END $$;

-- Creates monthly sub-partitions [month, month+1) for every hash bucket; idempotent.
CREATE OR REPLACE FUNCTION ensure_ops_month(month date) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  i int;
  start_ts date := date_trunc('month', month)::date;
  end_ts date := (date_trunc('month', month) + interval '1 month')::date;
  suffix text := to_char(start_ts, 'YYYYMM');
BEGIN
  FOR i IN 0..15 LOOP
    IF to_regclass(format('ops_h%s_m%s', i, suffix)) IS NULL THEN
      EXECUTE format('CREATE TABLE ops_h%s_m%s PARTITION OF ops_h%s FOR VALUES FROM (%L) TO (%L)', i, suffix, i, start_ts, end_ts);
    END IF;
  END LOOP;
END $$;

SELECT ensure_ops_month(now()::date);
SELECT ensure_ops_month((now() + interval '1 month')::date);

-- Global idempotency across partitions.
CREATE TABLE op_ids (
    op_id      uuid PRIMARY KEY,
    shop_id    uuid NOT NULL,
    server_seq bigint NOT NULL
);

-- Gap-free GST invoice series per shop per financial year (e.g. "2026-27").
CREATE TABLE bill_number (
    shop_id  uuid NOT NULL,
    fy       text NOT NULL,
    next_no  bigint NOT NULL,
    PRIMARY KEY (shop_id, fy)
);

-- Outbox cursor per shop: how far the Kafka relay has published.
CREATE TABLE outbox_cursor (
    shop_id        uuid PRIMARY KEY,
    published_seq  bigint NOT NULL DEFAULT 0
);
