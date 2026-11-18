package in.dukaan.sync.auth;

import in.dukaan.sync.common.ApiException;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/** Bearer device JWT on /v1/** except auth endpoints; rejects revoked devices. */
@Component
public class AuthFilter extends OncePerRequestFilter {
    public static final String PRINCIPAL = "dukaan.principal";
    private final JwtService jwt;
    private final JdbcClient jdbc;

    public AuthFilter(JwtService jwt, JdbcClient jdbc) {
        this.jwt = jwt;
        this.jdbc = jdbc;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        var path = request.getRequestURI();
        return !path.startsWith("/v1/") || path.startsWith("/v1/auth/") || path.equals("/v1/pairing/claim");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain) throws ServletException, IOException {
        var header = req.getHeader("Authorization");
        try {
            if (header == null || !header.startsWith("Bearer ")) throw ApiException.unauthorized("missing bearer token");
            var principal = jwt.verify(header.substring(7));
            var revoked = jdbc.sql("SELECT revoked FROM device WHERE id = ?").param(principal.deviceId())
                    .query(Boolean.class).optional().orElse(true);
            if (revoked) throw ApiException.unauthorized("device revoked or unknown");
            req.setAttribute(PRINCIPAL, principal);
            chain.doFilter(req, res);
        } catch (ApiException e) {
            res.setStatus(e.status().value());
            res.setContentType("application/json");
            res.getWriter().write("{\"error\":\"" + e.code() + "\",\"message\":\"" + e.getMessage() + "\"}");
        }
    }
}
