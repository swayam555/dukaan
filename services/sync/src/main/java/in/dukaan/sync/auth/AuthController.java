package in.dukaan.sync.auth;

import in.dukaan.sync.common.ApiException;
import in.dukaan.sync.common.DukaanProperties;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/v1/auth")
public class AuthController {
    private final OtpService otp;
    private final JwtService jwt;
    private final JdbcClient jdbc;
    private final DukaanProperties props;

    public AuthController(OtpService otp, JwtService jwt, JdbcClient jdbc, DukaanProperties props) {
        this.otp = otp;
        this.jwt = jwt;
        this.jdbc = jdbc;
        this.props = props;
    }

    public record OtpRequest(@NotBlank String phone) {}

    public record ShopInfo(@NotNull UUID id, @NotBlank String name, String gstin, String stateCode) {}

    public record DeviceInfo(@NotNull UUID id, @NotBlank String name, @Pattern(regexp = "[A-Z][A-Z0-9]{0,3}") String prefix) {}

    public record VerifyRequest(@NotBlank String phone, @NotBlank String otp, @Valid @NotNull ShopInfo shop, @Valid @NotNull DeviceInfo device) {}

    @PostMapping("/otp/request")
    public Map<String, Object> request(@Valid @RequestBody OtpRequest body) {
        var phone = OtpService.normalisePhone(body.phone());
        var code = otp.request(phone);
        var res = new HashMap<String, Object>();
        res.put("sent", true);
        if (props.devOtpInResponse()) res.put("devOtp", code);
        return res;
    }

    /**
     * Verifies the OTP and registers the owner device. The shop id is generated on the device (it works
     * offline before ever talking to us), so the first verify creates the shop with that id.
     */
    @PostMapping("/otp/verify")
    @Transactional
    public Map<String, Object> verify(@Valid @RequestBody VerifyRequest body) {
        var phone = OtpService.normalisePhone(body.phone());
        otp.verify(phone, body.otp());
        var existing = jdbc.sql("SELECT id FROM shop WHERE owner_phone = ?").param(phone).query(UUID.class).optional();
        if (existing.isPresent() && !existing.get().equals(body.shop().id())) {
            throw ApiException.conflict("shop_exists", "this phone already owns shop " + existing.get() + "; restore it on this device");
        }
        if (existing.isEmpty()) {
            jdbc.sql("INSERT INTO shop(id, name, gstin, state_code, owner_phone) VALUES (?, ?, ?, ?, ?)")
                    .params(body.shop().id(), body.shop().name(), nz(body.shop().gstin()), nz(body.shop().stateCode()), phone)
                    .update();
        }
        jdbc.sql("""
                INSERT INTO device(id, shop_id, name, prefix, role) VALUES (?, ?, ?, ?, 'owner')
                ON CONFLICT (id) DO UPDATE SET revoked = false, last_seen = now()
                """).params(body.device().id(), body.shop().id(), body.device().name(), body.device().prefix()).update();
        var principal = new DevicePrincipal(body.device().id(), body.shop().id(), "owner", body.device().prefix());
        return Map.of("token", jwt.issue(principal), "shopId", body.shop().id(), "role", "owner");
    }

    private static String nz(String s) { return s == null ? "" : s; }
}
