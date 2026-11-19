package in.dukaan.sync.auth;

import in.dukaan.sync.common.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;

/**
 * Adds a cashier device to a shop. The owner device asks for a single-use token (5 min, kept hashed in
 * Redis) and shows it as a QR; the new device claims it and gets its own device JWT with role cashier.
 */
@RestController
@RequestMapping("/v1/pairing")
public class PairingController {
    static final Duration TTL = Duration.ofMinutes(5);
    private static final SecureRandom RANDOM = new SecureRandom();
    private final StringRedisTemplate redis;
    private final JdbcClient jdbc;
    private final JwtService jwt;

    public PairingController(StringRedisTemplate redis, JdbcClient jdbc, JwtService jwt) {
        this.redis = redis;
        this.jdbc = jdbc;
        this.jwt = jwt;
    }

    public record ClaimRequest(@NotBlank String token, @Valid @NotNull AuthController.DeviceInfo device) {}

    @PostMapping("/token")
    public Map<String, Object> token(HttpServletRequest req) {
        var me = (DevicePrincipal) req.getAttribute(AuthFilter.PRINCIPAL);
        if (!me.isOwner()) throw ApiException.forbidden("only the owner device can pair new devices");
        var bytes = new byte[18];
        RANDOM.nextBytes(bytes);
        var token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        redis.opsForValue().set(key(token), me.shopId().toString(), TTL);
        return Map.of("token", token, "shopId", me.shopId(), "expiresInSec", TTL.toSeconds());
    }

    @PostMapping("/claim")
    @Transactional
    public Map<String, Object> claim(@Valid @RequestBody ClaimRequest body) {
        var shop = redis.opsForValue().getAndDelete(key(body.token()));
        if (shop == null) throw ApiException.unauthorized("pairing token expired or already used");
        var shopId = UUID.fromString(shop);
        try {
            jdbc.sql("INSERT INTO device(id, shop_id, name, prefix, role) VALUES (?, ?, ?, ?, 'cashier')")
                    .params(body.device().id(), shopId, body.device().name(), body.device().prefix()).update();
        } catch (DuplicateKeyException e) {
            throw ApiException.conflict("device_exists", "device id or bill prefix " + body.device().prefix() + " already used in this shop");
        }
        var principal = new DevicePrincipal(body.device().id(), shopId, "cashier", body.device().prefix());
        var name = jdbc.sql("SELECT name FROM shop WHERE id = ?").param(shopId).query(String.class).single();
        return Map.of("token", jwt.issue(principal), "shopId", shopId, "shopName", name, "role", "cashier");
    }

    private static String key(String token) {
        return "pair:" + OtpService.sha256(token);
    }
}
