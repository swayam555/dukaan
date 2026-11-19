package in.dukaan.sync;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;

import java.time.Duration;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.awaitility.Awaitility.await;

/** Owner web dashboard: OTP login → read-only token → summary built from the read models. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(Containers.class)
@SuppressWarnings("unchecked")
class DashboardTest {
    @LocalServerPort int port;
    @Autowired JdbcClient jdbc;

    UUID shopId = UUID.randomUUID();
    UUID ownerId = UUID.randomUUID();
    String phone = "93" + String.format("%08d", (int) (Math.random() * 1e8));
    long hlcMs = 1_790_000_000_000L;
    String today = LocalDate.now(ZoneId.of("Asia/Kolkata")).toString();

    RestClient http() { return RestClient.builder().baseUrl("http://localhost:" + port).build(); }

    Map<String, Object> post(String token, String path, Object body) {
        var r = http().post().uri(path).contentType(MediaType.APPLICATION_JSON);
        if (token != null) r = r.header("Authorization", "Bearer " + token);
        return r.body(body).retrieve().body(Map.class);
    }

    Map<String, Object> get(String token, String path) {
        return http().get().uri(path).header("Authorization", "Bearer " + token).retrieve().body(Map.class);
    }

    String otp() { return (String) post(null, "/v1/auth/otp/request", Map.of("phone", phone)).get("devOtp"); }

    Map<String, Object> op(String type, String entity, String entityId, Map<String, Object> payload) {
        var m = new LinkedHashMap<String, Object>();
        m.put("opId", UUID.randomUUID().toString());
        m.put("shopId", shopId.toString());
        m.put("deviceId", ownerId.toString());
        m.put("entity", entity);
        m.put("entityId", entityId);
        m.put("type", type);
        m.put("hlc", String.format("%015d:00000:%s", hlcMs++, ownerId));
        m.put("role", "owner");
        m.put("payload", payload);
        return m;
    }

    Map<String, Object> bill(String id, String item, String name, long total, String mode, String customer) {
        var line = Map.<String, Object>of("itemId", item, "name", name, "qtyMilli", 1000, "totalPaise", total, "costPaise", total * 8 / 10);
        var p = new HashMap<String, Object>(Map.of("id", id, "day", today, "totalPaise", total, "costPaise", total * 8 / 10,
                "cgstPaise", 50, "sgstPaise", 50, "igstPaise", 0, "cessPaise", 0, "lines", List.of(line),
                "payments", List.of(Map.of("mode", mode, "amountPaise", total))));
        p.put("customerId", customer);
        return op("bill.create", "bill", id, p);
    }

    @Test
    void ownerSeesTodayFromTheReadModelsWithAReadOnlyToken() {
        // A phone with no shop yet gets a clear error, not an empty dashboard.
        var noShop = otp();
        assertThatThrownBy(() -> post(null, "/v1/auth/dashboard", Map.of("phone", phone, "otp", noShop)))
                .isInstanceOfSatisfying(HttpClientErrorException.class, e -> assertThat(e.getResponseBodyAsString()).contains("no_shop"));

        var owner = (String) post(null, "/v1/auth/otp/verify", Map.of("phone", phone, "otp", otp(),
                "shop", Map.of("id", shopId, "name", "Sharma Kirana"),
                "device", Map.of("id", ownerId, "name", "Counter 1", "prefix", "A"))).get("token");
        post(owner, "/v1/sync/push", Map.of("ops", List.of(
                op("customer.upsert", "customer", "cust-ramesh", Map.of("name", "Ramesh")),
                bill("b1", "rice", "India Gate Basmati 1kg", 24_000, "credit", "cust-ramesh"),
                bill("b2", "soap", "Lux Soap 100g", 4_500, "cash", null),
                bill("b3", "soap", "Lux Soap 100g", 4_500, "upi", null))));
        // 4 ops + 3 server bill.number ops
        await().atMost(Duration.ofSeconds(30)).until(() ->
                jdbc.sql("SELECT seq FROM projector_cursor WHERE shop_id = ?").param(shopId).query(Long.class).optional().orElse(0L) == 7);

        var login = post(null, "/v1/auth/dashboard", Map.of("phone", phone, "otp", otp()));
        assertThat(login).containsEntry("shopName", "Sharma Kirana").containsEntry("expiresIn", 43_200);
        var web = (String) login.get("token");

        var s = get(web, "/v1/dashboard/summary?days=7");
        assertThat(s).containsEntry("shopName", "Sharma Kirana").containsEntry("totalPaise", 33_000).containsEntry("bills", 3)
                .containsEntry("taxPaise", 300).containsEntry("toCollectPaise", 24_000).containsEntry("customersWithDues", 1)
                .containsEntry("lastServerSeq", 7).containsEntry("projectedSeq", 7);
        assertThat((List<Map<String, Object>>) s.get("days")).hasSize(7).last().satisfies(d -> assertThat(d).containsEntry("day", today).containsEntry("bills", 3));
        var top = (List<Map<String, Object>>) s.get("topItems");
        assertThat(top).extracting(m -> m.get("name")).containsExactly("India Gate Basmati 1kg", "Lux Soap 100g");
        assertThat((List<Map<String, Object>>) s.get("topDues")).singleElement().satisfies(d -> assertThat(d).containsEntry("name", "Ramesh").containsEntry("balancePaise", 24_000));
        assertThat((List<Map<String, Object>>) s.get("devices")).singleElement().satisfies(d -> assertThat(d).containsEntry("prefix", "A"));

        // The web token is read-only: no push, no pull, no pairing codes.
        for (var path : List.of("/v1/sync/push", "/v1/pairing/token")) {
            assertThatThrownBy(() -> post(web, path, Map.of("ops", List.of())))
                    .isInstanceOfSatisfying(HttpClientErrorException.class, e -> assertThat(e.getStatusCode().value()).isEqualTo(403));
        }
        assertThatThrownBy(() -> get(web, "/v1/sync/pull?since=0"))
                .isInstanceOfSatisfying(HttpClientErrorException.class, e -> assertThat(e.getStatusCode().value()).isEqualTo(403));

        // A cashier device can't read it either; the owner's phone token can.
        var pairing = (String) post(owner, "/v1/pairing/token", Map.of()).get("token");
        var cashier = (String) post(null, "/v1/pairing/claim", Map.of("token", pairing, "device", Map.of("id", UUID.randomUUID(), "name", "Counter 2", "prefix", "B"))).get("token");
        assertThatThrownBy(() -> get(cashier, "/v1/dashboard/summary"))
                .isInstanceOfSatisfying(HttpClientErrorException.class, e -> assertThat(e.getStatusCode().value()).isEqualTo(403));
        assertThat(get(owner, "/v1/dashboard/summary?days=1")).containsEntry("bills", 3);
    }
}
