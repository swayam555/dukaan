package in.dukaan.sync.pipeline;

import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.List;
import java.util.UUID;

/**
 * Tells a shop's other devices to pull. Debounced per shop in Redis (one nudge per window, however
 * many ops arrive): a 300-line rush hour on one counter must not become 300 pushes to the others.
 * Only devices that are behind (ack_seq < seq) and have an FCM token are nudged. The nudge carries no
 * data: devices pull over the authenticated sync API.
 */
@Component
@ConditionalOnProperty(name = "dukaan.notifier.enabled", havingValue = "true", matchIfMissing = true)
public class Notifier {
    static final Duration WINDOW = Duration.ofSeconds(2);
    private final StringRedisTemplate redis;
    private final JdbcClient jdbc;
    private final PushSender sender;

    public Notifier(StringRedisTemplate redis, JdbcClient jdbc, PushSender sender) {
        this.redis = redis;
        this.jdbc = jdbc;
        this.sender = sender;
    }

    @KafkaListener(topics = KafkaTopics.SHOP_OPS, groupId = "notifier")
    public void onOp(ConsumerRecord<String, String> rec) {
        var shop = rec.key();
        if (!Boolean.TRUE.equals(redis.opsForValue().setIfAbsent("nudge:" + shop, "1", WINDOW))) return;
        var maxSeq = jdbc.sql("SELECT next_seq - 1 FROM shop WHERE id = ?").param(UUID.fromString(shop)).query(Long.class).single();
        List<String> tokens = jdbc.sql("""
                SELECT fcm_token FROM device WHERE shop_id = ? AND NOT revoked AND fcm_token IS NOT NULL AND ack_seq < ?""")
                .params(UUID.fromString(shop), maxSeq).query(String.class).list();
        if (!tokens.isEmpty()) sender.opsAvailable(tokens, shop, maxSeq);
    }
}
