package in.dukaan.sync.pipeline;

import java.util.List;

/** Sends a data-only "ops available" message. FCM in production; the default logs and counts. */
public interface PushSender {
    void opsAvailable(List<String> fcmTokens, String shopId, long maxSeq);
}
