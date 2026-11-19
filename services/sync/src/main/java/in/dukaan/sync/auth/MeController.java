package in.dukaan.sync.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
public class MeController {
    private final JdbcClient jdbc;

    public MeController(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public record FcmToken(@NotBlank @Size(max = 4096) String token) {}

    @GetMapping("/v1/me")
    public DevicePrincipal me(HttpServletRequest req) {
        return (DevicePrincipal) req.getAttribute(AuthFilter.PRINCIPAL);
    }

    /** The device's FCM registration token, for "ops available" nudges. */
    @PutMapping("/v1/me/fcm")
    public Map<String, Object> fcm(HttpServletRequest req, @Valid @RequestBody FcmToken body) {
        var me = (DevicePrincipal) req.getAttribute(AuthFilter.PRINCIPAL);
        jdbc.sql("UPDATE device SET fcm_token = ? WHERE id = ?").params(body.token(), me.deviceId()).update();
        return Map.of("ok", true);
    }
}
