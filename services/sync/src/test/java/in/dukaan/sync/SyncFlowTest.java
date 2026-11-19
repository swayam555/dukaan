package in.dukaan.sync;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import tools.jackson.databind.json.JsonMapper;

import java.io.ByteArrayOutputStream;
import java.util.*;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.zip.GZIPOutputStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(Containers.class)
@SuppressWarnings("unchecked")
class SyncFlowTest {
    @LocalServerPort int port;
    @Autowired JdbcClient jdbc;
    @Autowired JsonMapper json;

    UUID shopId;
    UUID ownerId;
    String owner;
    long hlcMs = 1_790_000_000_000L;

    RestClient http() {
        return RestClient.builder().baseUrl("http://localhost:" + port).build();
    }

    Map<String, Object> post(String token, String path, Object body) {
        var r = http().post().uri(path).contentType(MediaType.APPLICATION_JSON);
        if (token != null) r = r.header("Authorization", "Bearer " + token);
        return r.body(body).retrieve().body(Map.class);
    }

    Map<String, Object> get(String token, String path) {
        return http().get().uri(path).header("Authorization", "Bearer " + token).retrieve().body(Map.class);
    }

    @BeforeEach
    void registerOwner() {
        var phone = "96" + String.format("%08d", (int) (Math.random() * 1e8));
        var otp = (String) post(null, "/v1/auth/otp/request", Map.of("phone", phone)).get("devOtp");
        shopId = UUID.randomUUID();
        ownerId = UUID.randomUUID();
        owner = (String) post(null, "/v1/auth/otp/verify", Map.of("phone", phone, "otp", otp,
                "shop", Map.of("id", shopId, "name", "Sharma Kirana"),
                "device", Map.of("id", ownerId, "name", "Counter 1", "prefix", "C1"))).get("token");
    }

    record Paired(UUID id, String token) {}

    Paired pairCashier(String prefix) {
        var token = (String) post(owner, "/v1/pairing/token", Map.of()).get("token");
        var id = UUID.randomUUID();
        var res = post(null, "/v1/pairing/claim", Map.of("token", token, "device", Map.of("id", id, "name", "Counter " + prefix, "prefix", prefix)));
        assertThat(res).containsEntry("role", "cashier").containsEntry("shopName", "Sharma Kirana");
        return new Paired(id, (String) res.get("token"));
    }

    Map<String, Object> op(UUID device, String type, String entity, String entityId, Map<String, Object> payload) {
        var hlc = String.format("%015d:%05d:%s", hlcMs++, 0, device);
        var m = new LinkedHashMap<String, Object>();
        m.put("opId", UUID.randomUUID().toString());
        m.put("shopId", shopId.toString());
        m.put("deviceId", device.toString());
        m.put("entity", entity);
        m.put("entityId", entityId);
        m.put("type", type);
        m.put("hlc", hlc);
        m.put("role", "owner"); // a device can claim anything; the server stamps its real role
        m.put("payload", payload);
        return m;
    }

    Map<String, Object> bill(UUID device, String day) {
        var id = UUID.randomUUID().toString();
        return op(device, "bill.create", "bill", id, Map.of("id", id, "day", day, "grossPaise", 2800, "lines", List.of()));
    }

    Map<String, Object> push(String token, List<Map<String, Object>> ops) {
        return post(token, "/v1/sync/push", Map.of("ops", ops));
    }

    List<Map<String, Object>> pullAll(String token, int limit) {
        var all = new ArrayList<Map<String, Object>>();
        long since = 0;
        while (true) {
            var page = get(token, "/v1/sync/pull?since=" + since + "&limit=" + limit);
            all.addAll((List<Map<String, Object>>) page.get("ops"));
            since = ((Number) page.get("nextSeq")).longValue();
            if (!(Boolean) page.get("hasMore")) return all;
        }
    }

    @Test
    void pushIsIdempotentAndPullReturnsTheShopsTotalOrder() {
        var ops = List.of(
                op(ownerId, "item.upsert", "item", "salt", Map.of("name", "Tata Salt 1kg", "salePaise", 2800)),
                op(ownerId, "customer.upsert", "customer", "c1", Map.of("name", "Ramesh")));
        var first = push(owner, ops);
        assertThat((List<Map<String, Object>>) first.get("acks")).extracting(a -> ((Number) a.get("serverSeq")).longValue()).containsExactly(1L, 2L);
        assertThat(first.get("maxSeq")).isEqualTo(2);

        // Response lost, device re-sends the same batch: same seqs, nothing appended.
        var again = push(owner, ops);
        assertThat(again.get("acks")).isEqualTo(first.get("acks"));
        assertThat(again.get("maxSeq")).isEqualTo(2);

        var pulled = pullAll(owner, 1000);
        assertThat(pulled).hasSize(2);
        assertThat(pulled.getFirst()).containsEntry("type", "item.upsert").containsEntry("serverSeq", 1).containsEntry("role", "owner");
        assertThat((Map<String, Object>) pulled.getFirst().get("payload")).containsEntry("name", "Tata Salt 1kg");
    }

    @Test
    void everyBillGetsAGapFreeNumberPerFinancialYear() {
        push(owner, List.of(bill(ownerId, "2027-03-31"), bill(ownerId, "2027-04-01")));
        var cashier = pairCashier("C2");
        push(cashier.token(), List.of(bill(cashier.id(), "2027-04-02"), bill(cashier.id(), "2027-03-30")));

        var numbers = pullAll(owner, 3).stream().filter(o -> o.get("type").equals("bill.number"))
                .map(o -> (Map<String, Object>) o.get("payload")).map(p -> p.get("fy") + "#" + p.get("globalNo")).toList();
        assertThat(numbers).containsExactly("2026-27#1", "2027-28#1", "2027-28#2", "2026-27#2");

        var ops = pullAll(owner, 1000);
        var create = ops.get(0);
        var number = ops.get(1);
        assertThat(number).containsEntry("deviceId", "server").containsEntry("entityId", create.get("entityId"));
        assertThat((String) number.get("hlc")).isGreaterThan((String) create.get("hlc"));
    }

    @Test
    void cashierCannotAuthorOwnerOnlyOpsAndItsRoleIsStamped() {
        var cashier = pairCashier("C3");
        var res = push(cashier.token(), List.of(
                op(cashier.id(), "bill.void", "bill", "b1", Map.of("at", 1)),
                op(cashier.id(), "stock.adjust", "stock", "s1", Map.of("itemId", "salt", "deltaMilli", -1000)),
                op(cashier.id(), "ledger.add", "ledger", "l1", Map.of("id", "l1", "amountPaise", 500)),
                op(ownerId, "item.upsert", "item", "x", Map.of()),       // impersonating another device
                op(cashier.id(), "bill.number", "bill", "b1", Map.of("globalNo", 1)))); // server-only
        assertThat((List<Map<String, Object>>) res.get("rejects")).extracting(r -> r.get("reason"))
                .containsExactly("bill.void needs owner role", "stock.adjust needs owner role", "wrong shop or device", "unknown op type bill.number");
        var stored = pullAll(owner, 1000);
        assertThat(stored).hasSize(1);
        assertThat(stored.getFirst()).containsEntry("type", "ledger.add").containsEntry("role", "cashier");
    }

    @Test
    void pairingTokenIsSingleUseAndOwnerOnly() {
        var token = (String) post(owner, "/v1/pairing/token", Map.of()).get("token");
        post(null, "/v1/pairing/claim", Map.of("token", token, "device", Map.of("id", UUID.randomUUID(), "name", "C", "prefix", "C4")));
        assertThatThrownBy(() -> post(null, "/v1/pairing/claim", Map.of("token", token, "device", Map.of("id", UUID.randomUUID(), "name", "C", "prefix", "C5"))))
                .isInstanceOf(HttpClientErrorException.Unauthorized.class);
        var cashier = pairCashier("C6");
        assertThatThrownBy(() -> post(cashier.token(), "/v1/pairing/token", Map.of())).isInstanceOf(HttpClientErrorException.Forbidden.class);
    }

    @Test
    void concurrentPushesFromManyDevicesKeepTheSequenceGapFree() throws Exception {
        var devices = new ArrayList<Paired>();
        devices.add(new Paired(ownerId, owner));
        for (int i = 0; i < 3; i++) devices.add(pairCashier("D" + i));
        int perDevice = 40;
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            var futures = new ArrayList<Future<?>>();
            for (var d : devices) {
                futures.add(pool.submit(() -> {
                    for (int b = 0; b < perDevice / 4; b++) {
                        var batch = new ArrayList<Map<String, Object>>();
                        for (int k = 0; k < 4; k++) batch.add(k == 0 ? bill(d.id(), "2027-05-01") : op(d.id(), "ledger.add", "ledger", UUID.randomUUID().toString(), Map.of("amountPaise", 1)));
                        push(d.token(), batch);
                    }
                    return null;
                }));
            }
            for (var f : futures) f.get();
        }
        int bills = devices.size() * perDevice / 4;
        int expected = devices.size() * perDevice + bills; // + one bill.number per bill
        var seqs = pullAll(owner, 37).stream().map(o -> ((Number) o.get("serverSeq")).longValue()).toList();
        assertThat(seqs).hasSize(expected);
        for (int i = 0; i < expected; i++) assertThat(seqs.get(i)).isEqualTo(i + 1L);
        var nos = pullAll(owner, 1000).stream().filter(o -> o.get("type").equals("bill.number"))
                .map(o -> ((Number) ((Map<String, Object>) o.get("payload")).get("globalNo")).intValue()).sorted().toList();
        assertThat(nos).hasSize(bills);
        for (int i = 0; i < bills; i++) assertThat(nos.get(i)).isEqualTo(i + 1);
    }

    @Test
    void gzipPushAndAckMovesTheDeviceCursor() throws Exception {
        var bytes = new ByteArrayOutputStream();
        try (var gz = new GZIPOutputStream(bytes)) {
            gz.write(json.writeValueAsBytes(Map.of("ops", List.of(op(ownerId, "item.upsert", "item", "a", Map.of("name", "A"))))));
        }
        var res = http().post().uri("/v1/sync/push").header("Authorization", "Bearer " + owner).header("Content-Encoding", "gzip")
                .contentType(MediaType.APPLICATION_JSON).body(bytes.toByteArray()).retrieve().body(Map.class);
        assertThat(res.get("maxSeq")).isEqualTo(1);

        post(owner, "/v1/sync/ack", Map.of("seq", 99)); // clamped to what exists
        assertThat(jdbc.sql("SELECT ack_seq FROM device WHERE id = ?").param(ownerId).query(Long.class).single()).isEqualTo(1L);
    }

    @Test
    void oversizedBatchIsRefused() {
        var ops = new ArrayList<Map<String, Object>>();
        for (int i = 0; i < 501; i++) ops.add(op(ownerId, "ledger.add", "ledger", "l" + i, Map.of()));
        assertThatThrownBy(() -> push(owner, ops)).isInstanceOf(HttpClientErrorException.BadRequest.class);
    }
}
