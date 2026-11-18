package in.dukaan.sync.auth;

import in.dukaan.sync.common.ApiException;
import in.dukaan.sync.common.DukaanProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.HexFormat;

/**
 * Phone OTP for the shop owner. OTPs are stored hashed in Redis with a TTL and an attempt counter.
 * No SMS provider is wired in this repo: in the dev profile the OTP is returned in the response.
 */
@Service
public class OtpService {
    private static final Logger log = LoggerFactory.getLogger(OtpService.class);
    private static final SecureRandom RANDOM = new SecureRandom();
    private final StringRedisTemplate redis;
    private final DukaanProperties props;

    public OtpService(StringRedisTemplate redis, DukaanProperties props) {
        this.redis = redis;
        this.props = props;
    }

    public static String normalisePhone(String phone) {
        var digits = phone.replaceAll("[^0-9]", "");
        if (digits.length() == 12 && digits.startsWith("91")) digits = digits.substring(2);
        if (!digits.matches("[6-9]\\d{9}")) throw ApiException.badRequest("invalid_phone", "Indian mobile number expected");
        return "+91" + digits;
    }

    public String request(String phone) {
        var rateKey = "otp:rate:" + phone;
        var count = redis.opsForValue().increment(rateKey);
        if (count != null && count == 1) redis.expire(rateKey, Duration.ofHours(1));
        if (count != null && count > 5) throw ApiException.tooMany("too many OTP requests, try later");
        var otp = String.format("%06d", RANDOM.nextInt(1_000_000));
        redis.opsForValue().set("otp:" + phone, sha256(phone + ":" + otp), props.otpTtl());
        redis.delete("otp:tries:" + phone);
        log.info("OTP issued for {}******", phone.substring(0, 6));
        return otp;
    }

    public void verify(String phone, String otp) {
        var triesKey = "otp:tries:" + phone;
        var tries = redis.opsForValue().increment(triesKey);
        if (tries != null && tries == 1) redis.expire(triesKey, props.otpTtl());
        if (tries != null && tries > props.otpMaxAttempts()) throw ApiException.tooMany("too many attempts, request a new OTP");
        var stored = redis.opsForValue().get("otp:" + phone);
        if (stored == null || !MessageDigest.isEqual(stored.getBytes(), sha256(phone + ":" + otp).getBytes())) {
            throw ApiException.unauthorized("wrong or expired OTP");
        }
        redis.delete("otp:" + phone);
        redis.delete(triesKey);
    }

    static String sha256(String s) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
