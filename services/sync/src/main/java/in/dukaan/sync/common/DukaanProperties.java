package in.dukaan.sync.common;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

@ConfigurationProperties("dukaan")
public record DukaanProperties(
        String jwtSecret,
        Duration jwtTtl,
        Duration otpTtl,
        int otpMaxAttempts,
        boolean devOtpInResponse,
        int maxPushOps,
        int maxPullOps) {
}
