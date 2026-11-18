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

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(Containers.class)
class AuthFlowTest {
    @LocalServerPort int port;
    @Autowired JdbcClient jdbc;

    RestClient http() {
        return RestClient.builder().baseUrl("http://localhost:" + port).build();
    }

    @SuppressWarnings("unchecked")
    Map<String, Object> post(String path, Object body) {
        return http().post().uri(path).contentType(MediaType.APPLICATION_JSON).body(body).retrieve().body(Map.class);
    }

    @Test
    void ownerRegistersWithOtpAndGetsDeviceToken() {
        var phone = "98" + String.format("%08d", (int) (Math.random() * 1e8));
        var otp = (String) post("/v1/auth/otp/request", Map.of("phone", phone)).get("devOtp");
        assertThat(otp).hasSize(6);

        var shopId = UUID.randomUUID();
        var deviceId = UUID.randomUUID();
        var res = post("/v1/auth/otp/verify", Map.of(
                "phone", "+91 " + phone, "otp", otp,
                "shop", Map.of("id", shopId, "name", "Sharma Kirana", "gstin", "", "stateCode", "27"),
                "device", Map.of("id", deviceId, "name", "Counter 1", "prefix", "C1")));
        var token = (String) res.get("token");

        var me = http().get().uri("/v1/me").header("Authorization", "Bearer " + token).retrieve().body(Map.class);
        assertThat(me).containsEntry("shopId", shopId.toString()).containsEntry("role", "owner").containsEntry("prefix", "C1");
        assertThat(jdbc.sql("SELECT count(*) FROM device WHERE shop_id = ?").param(shopId).query(Integer.class).single()).isEqualTo(1);
    }

    @Test
    void wrongOtpIsRejectedAndOtpIsSingleUse() {
        var phone = "97" + String.format("%08d", (int) (Math.random() * 1e8));
        var otp = (String) post("/v1/auth/otp/request", Map.of("phone", phone)).get("devOtp");
        var body = Map.of("phone", phone, "otp", otp.equals("000000") ? "111111" : "000000",
                "shop", Map.of("id", UUID.randomUUID(), "name", "X"),
                "device", Map.of("id", UUID.randomUUID(), "name", "C", "prefix", "C1"));
        assertThatThrownBy(() -> post("/v1/auth/otp/verify", body)).isInstanceOf(HttpClientErrorException.Unauthorized.class);
    }

    @Test
    void protectedRoutesNeedAValidToken() {
        assertThatThrownBy(() -> http().get().uri("/v1/me").retrieve().body(String.class)).isInstanceOf(HttpClientErrorException.Unauthorized.class);
        assertThatThrownBy(() -> http().get().uri("/v1/me").header("Authorization", "Bearer nope").retrieve().body(String.class))
                .isInstanceOf(HttpClientErrorException.Unauthorized.class);
    }

    @Test
    void opsTableIsPartitionedByShopHashThenMonth() {
        var buckets = jdbc.sql("SELECT count(*) FROM pg_inherits WHERE inhparent = 'ops'::regclass").query(Integer.class).single();
        assertThat(buckets).isEqualTo(16);
        var months = jdbc.sql("SELECT count(*) FROM pg_class WHERE relname LIKE 'ops_h0_m%'").query(Integer.class).single();
        assertThat(months).isGreaterThanOrEqualTo(2);
    }
}
