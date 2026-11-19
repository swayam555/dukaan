package in.dukaan.sync.auth;

import in.dukaan.sync.common.ApiException;
import in.dukaan.sync.common.DukaanProperties;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.UUID;

@Service
public class JwtService {
    private final SecretKey key;
    private final DukaanProperties props;

    public JwtService(DukaanProperties props) {
        if (props.jwtSecret() == null || props.jwtSecret().length() < 32) {
            throw new IllegalStateException("dukaan.jwt-secret must be at least 32 characters");
        }
        this.key = Keys.hmacShaKeyFor(props.jwtSecret().getBytes(StandardCharsets.UTF_8));
        this.props = props;
    }

    public String issue(DevicePrincipal p) {
        return issue(p, props.jwtTtl());
    }

    public String issue(DevicePrincipal p, java.time.Duration ttl) {
        var now = Instant.now();
        return Jwts.builder()
                .subject(p.deviceId().toString())
                .claim("shop", p.shopId().toString())
                .claim("role", p.role())
                .claim("prefix", p.prefix())
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(ttl)))
                .signWith(key)
                .compact();
    }

    public DevicePrincipal verify(String token) {
        try {
            var claims = Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload();
            return new DevicePrincipal(
                    UUID.fromString(claims.getSubject()),
                    UUID.fromString(claims.get("shop", String.class)),
                    claims.get("role", String.class),
                    claims.get("prefix", String.class));
        } catch (JwtException | IllegalArgumentException e) {
            throw ApiException.unauthorized("invalid token");
        }
    }
}
