package in.dukaan.sync.pipeline;

import in.dukaan.sync.sync.SyncModels.SeqOp;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Transactional outbox: the ops table is the outbox. The relay publishes each shop's ops past its
 * outbox_cursor to Kafka (key = shop_id), waits for the broker acks, then advances the cursor in the
 * same Postgres transaction. Kafka can be down for hours without losing an op; delivery is
 * at-least-once and consumers dedupe by server_seq. A transaction-scoped advisory lock keeps exactly
 * one relay active when several sync-service replicas run.
 */
@Component
@ConditionalOnProperty(name = "dukaan.outbox.enabled", havingValue = "true", matchIfMissing = true)
public class OutboxRelay {
    private static final Logger log = LoggerFactory.getLogger(OutboxRelay.class);
    private static final long LOCK_KEY = 0x6475_6b61_616eL;
    private final JdbcClient jdbc;
    private final TransactionTemplate tx;
    private final KafkaTemplate<String, String> kafka;
    private final JsonMapper json;
    private final AtomicLong lag = new AtomicLong();

    public OutboxRelay(JdbcClient jdbc, TransactionTemplate tx, KafkaTemplate<String, String> kafka, JsonMapper json, MeterRegistry metrics) {
        this.jdbc = jdbc;
        this.tx = tx;
        this.kafka = kafka;
        this.json = json;
        metrics.gauge("dukaan.outbox.lag.ops", lag);
    }

    @Scheduled(fixedDelayString = "${dukaan.outbox.interval:200ms}")
    public void tick() {
        try {
            tx.executeWithoutResult(s -> relayOnce());
        } catch (RuntimeException e) {
            log.warn("outbox relay: {} (will retry)", e.getMessage());
        }
    }

    /** One pass: up to 200 shops with a backlog, up to 1000 ops each. Returns ops published. */
    int relayOnce() {
        if (!jdbc.sql("SELECT pg_try_advisory_xact_lock(?)").param(LOCK_KEY).query(Boolean.class).single()) return 0;
        record Backlog(UUID shop, long published, long max) {}
        var shops = jdbc.sql("""
                SELECT s.id, COALESCE(c.published_seq, 0), s.next_seq - 1 FROM shop s
                LEFT JOIN outbox_cursor c ON c.shop_id = s.id
                WHERE s.next_seq - 1 > COALESCE(c.published_seq, 0) LIMIT 200""")
                .query((rs, i) -> new Backlog(rs.getObject(1, UUID.class), rs.getLong(2), rs.getLong(3))).list();
        lag.set(shops.stream().mapToLong(b -> b.max() - b.published()).sum());
        int sent = 0;
        for (var b : shops) {
            var ops = jdbc.sql("""
                    SELECT op_id::text, shop_id::text, device_id, entity, entity_id, type, hlc, role, payload::text, server_seq
                    FROM ops WHERE shop_id = ? AND server_seq > ? ORDER BY server_seq LIMIT 1000""")
                    .params(b.shop(), b.published())
                    .query((rs, i) -> new SeqOp(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5),
                            rs.getString(6), rs.getString(7), rs.getString(8), rs.getString(9), rs.getLong(10)))
                    .list();
            if (ops.isEmpty()) continue;
            var futures = new ArrayList<CompletableFuture<?>>();
            for (var op : ops) futures.add(kafka.send(KafkaTopics.SHOP_OPS, op.shopId(), json.writeValueAsString(op)));
            kafka.flush();
            try {
                CompletableFuture.allOf(futures.toArray(CompletableFuture[]::new)).get(10, TimeUnit.SECONDS);
            } catch (Exception e) {
                throw new IllegalStateException("kafka publish failed for shop " + b.shop() + ": " + e.getMessage(), e);
            }
            jdbc.sql("""
                    INSERT INTO outbox_cursor(shop_id, published_seq) VALUES (?, ?)
                    ON CONFLICT (shop_id) DO UPDATE SET published_seq = EXCLUDED.published_seq""")
                    .params(b.shop(), ops.getLast().serverSeq()).update();
            sent += ops.size();
        }
        return sent;
    }
}
