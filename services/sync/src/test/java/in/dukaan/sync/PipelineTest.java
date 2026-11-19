package in.dukaan.sync;

import in.dukaan.sync.pipeline.LoggingPushSender;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.client.RestClient;

import java.time.Duration;
import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

/** push → ops (outbox) → relay → Kafka shop.ops → projector read models + notifier nudges. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(Containers.class)
@SuppressWarnings("unchecked")
class PipelineTest {
    @LocalServerPort int port;
    @Autowired JdbcClient jdbc;
    @Autowired LoggingPushSender pushes;

    UUID shopId = UUID.randomUUID();
    UUID ownerId = UUID.randomUUID();
    long hlcMs = 1_790_000_000_000L;

    Map<String, Object> post(String token, String path, Object body) {
        var r = RestClient.builder().baseUrl("http://localhost:" + port).build().post().uri(path).contentType(MediaType.APPLICATION_JSON);
        if (token != null) r = r.header("Authorization", "Bearer " + token);
        return r.body(body).retrieve().body(Map.class);
    }

    String register() {
        var phone = "95" + String.format("%08d", (int) (Math.random() * 1e8));
        var otp = (String) post(null, "/v1/auth/otp/request", Map.of("phone", phone)).get("devOtp");
        return (String) post(null, "/v1/auth/otp/verify", Map.of("phone", phone, "otp", otp,
                "shop", Map.of("id", shopId, "name", "Gupta General Store"),
                "device", Map.of("id", ownerId, "name", "Counter 1", "prefix", "C1"))).get("token");
    }

    Map<String, Object> op(UUID device, String type, String entity, String entityId, Map<String, Object> payload) {
        var m = new LinkedHashMap<String, Object>();
        m.put("opId", UUID.randomUUID().toString());
        m.put("shopId", shopId.toString());
        m.put("deviceId", device.toString());
        m.put("entity", entity);
        m.put("entityId", entityId);
        m.put("type", type);
        m.put("hlc", String.format("%015d:00000:%s", hlcMs++, device));
        m.put("role", "owner");
        m.put("payload", payload);
        return m;
    }

    Map<String, Object> bill(String id, String day, long qtyMilli, long total, List<Map<String, Object>> payments, String customer) {
        var line = Map.<String, Object>of("itemId", "salt", "qtyMilli", qtyMilli, "totalPaise", total, "costPaise", total * 8 / 10);
        var p = new HashMap<String, Object>(Map.of("id", id, "day", day, "totalPaise", total, "costPaise", total * 8 / 10,
                "cgstPaise", 50, "sgstPaise", 50, "igstPaise", 0, "cessPaise", 0, "lines", List.of(line), "payments", payments));
        p.put("customerId", customer);
        return op(ownerId, "bill.create", "bill", id, p);
    }

    long q(String sql, Object... params) {
        return jdbc.sql(sql).params(params).query(Long.class).optional().orElse(-1L);
    }

    @Test
    void readModelsFollowTheOpLogExactlyOnceAndOtherDevicesAreNudged() {
        var owner = register();
        var pairing = (String) post(owner, "/v1/pairing/token", Map.of()).get("token");
        var cashierId = UUID.randomUUID();
        var cashier = (String) post(null, "/v1/pairing/claim", Map.of("token", pairing, "device", Map.of("id", cashierId, "name", "Counter 2", "prefix", "C2"))).get("token");
        RestClient.builder().baseUrl("http://localhost:" + port).build().put().uri("/v1/me/fcm").header("Authorization", "Bearer " + cashier)
                .contentType(MediaType.APPLICATION_JSON).body(Map.of("token", "fcm-cashier-1")).retrieve().toBodilessEntity();

        post(owner, "/v1/sync/push", Map.of("ops", List.of(
                op(ownerId, "stock.adjust", "stock", "adj1", Map.of("itemId", "salt", "batchId", "", "deltaMilli", 50_000, "reason", "opening")),
                bill("b1", "2027-05-01", 2000, 5600, List.of(Map.of("mode", "cash", "amountPaise", 5600)), null),
                bill("b2", "2027-05-01", 1000, 2800, List.of(Map.of("mode", "credit", "amountPaise", 2800)), "cust-ramesh"),
                bill("b3", "2027-05-02", 3000, 8400, List.of(Map.of("mode", "upi", "amountPaise", 8400)), null),
                op(ownerId, "ledger.add", "ledger", "l1", Map.of("id", "l1", "customerId", "cust-ramesh", "amountPaise", -1000, "kind", "payment")),
                op(ownerId, "bill.void", "bill", "b3", Map.of("reason", "wrong item", "at", 1)))));

        await().atMost(Duration.ofSeconds(30)).until(() -> q("SELECT seq FROM projector_cursor WHERE shop_id = ?", shopId) == 9);
        assertState();
        assertThat(q("SELECT global_no FROM rm_bill WHERE shop_id = ? AND bill_id = 'b2'", shopId)).isEqualTo(2);
        await().atMost(Duration.ofSeconds(30)).until(() -> pushes.sent.stream().anyMatch(s -> s.tokens().contains("fcm-cashier-1") && s.shopId().equals(shopId.toString())));

        // Redelivery: rewind the outbox so the relay republishes the whole shop; the projector must not double count.
        jdbc.sql("UPDATE outbox_cursor SET published_seq = 0 WHERE shop_id = ?").param(shopId).update();
        await().atMost(Duration.ofSeconds(30)).until(() -> q("SELECT published_seq FROM outbox_cursor WHERE shop_id = ?", shopId) == 9);
        post(owner, "/v1/sync/push", Map.of("ops", List.of(op(ownerId, "ledger.add", "ledger", "l2", Map.of("id", "l2", "customerId", "cust-ramesh", "amountPaise", 0)))));
        await().atMost(Duration.ofSeconds(30)).until(() -> q("SELECT seq FROM projector_cursor WHERE shop_id = ?", shopId) == 10);
        assertState();
    }

    void assertState() {
        var may1 = jdbc.sql("SELECT bills, voids, total_paise, tax_paise FROM rm_daily_sales WHERE shop_id = ? AND day = '2027-05-01'")
                .param(shopId).query((rs, i) -> List.of(rs.getLong(1), rs.getLong(2), rs.getLong(3), rs.getLong(4))).single();
        assertThat(may1).containsExactly(2L, 0L, 8400L, 200L);
        var may2 = jdbc.sql("SELECT bills, voids, total_paise FROM rm_daily_sales WHERE shop_id = ? AND day = '2027-05-02'")
                .param(shopId).query((rs, i) -> List.of(rs.getLong(1), rs.getLong(2), rs.getLong(3))).single();
        assertThat(may2).containsExactly(0L, 1L, 0L);
        assertThat(q("SELECT qty_milli FROM rm_stock WHERE shop_id = ? AND item_id = 'salt'", shopId)).isEqualTo(47_000L);
        assertThat(q("SELECT qty_milli FROM rm_item_sales WHERE shop_id = ? AND day = '2027-05-01' AND item_id = 'salt'", shopId)).isEqualTo(3000L);
        assertThat(q("SELECT balance_paise FROM rm_khata WHERE shop_id = ? AND customer_id = 'cust-ramesh'", shopId)).isEqualTo(1800L);
    }
}
