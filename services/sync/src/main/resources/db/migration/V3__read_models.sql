-- Read models owned by the projector (Kafka consumer group "projector"). Rebuildable from ops at any time:
-- TRUNCATE them + projector_cursor and replay the topic / table.
CREATE TABLE projector_cursor (
    shop_id uuid PRIMARY KEY,
    seq     bigint NOT NULL
);

CREATE TABLE rm_bill (
    shop_id      uuid   NOT NULL,
    bill_id      text   NOT NULL,
    day          date   NOT NULL,
    total_paise  bigint NOT NULL,
    tax_paise    bigint NOT NULL,
    cost_paise   bigint NOT NULL,
    credit_paise bigint NOT NULL,
    customer_id  text,
    global_no    bigint,
    fy           text,
    status       text   NOT NULL DEFAULT 'final',
    lines        jsonb  NOT NULL,
    PRIMARY KEY (shop_id, bill_id)
);

CREATE TABLE rm_daily_sales (
    shop_id     uuid   NOT NULL,
    day         date   NOT NULL,
    bills       int    NOT NULL DEFAULT 0,
    voids       int    NOT NULL DEFAULT 0,
    total_paise bigint NOT NULL DEFAULT 0,
    tax_paise   bigint NOT NULL DEFAULT 0,
    cost_paise  bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (shop_id, day)
);

CREATE TABLE rm_item_sales (
    shop_id     uuid   NOT NULL,
    day         date   NOT NULL,
    item_id     text   NOT NULL,
    qty_milli   bigint NOT NULL DEFAULT 0,
    total_paise bigint NOT NULL DEFAULT 0,
    cost_paise  bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (shop_id, day, item_id)
);

CREATE TABLE rm_stock (
    shop_id   uuid   NOT NULL,
    item_id   text   NOT NULL,
    qty_milli bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (shop_id, item_id)
);

CREATE TABLE rm_khata (
    shop_id       uuid   NOT NULL,
    customer_id   text   NOT NULL,
    balance_paise bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (shop_id, customer_id)
);
