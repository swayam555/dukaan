package in.dukaan.sync.pipeline;

import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Stand-in for FCM: no Firebase project is configured in this repo, so nudges are logged and counted
 * (and kept in memory for tests). Swapping in firebase-admin's Messaging.sendEach is a one-class change.
 */
@Component
public class LoggingPushSender implements PushSender {
    private static final Logger log = LoggerFactory.getLogger(LoggingPushSender.class);
    public record Sent(List<String> tokens, String shopId, long maxSeq) {}
    public final List<Sent> sent = new CopyOnWriteArrayList<>();
    private final MeterRegistry metrics;

    public LoggingPushSender(MeterRegistry metrics) {
        this.metrics = metrics;
    }

    @Override
    public void opsAvailable(List<String> tokens, String shopId, long maxSeq) {
        sent.add(new Sent(tokens, shopId, maxSeq));
        if (sent.size() > 1000) sent.removeFirst();
        metrics.counter("dukaan.notifier.pushes").increment(tokens.size());
        log.debug("nudge shop {} maxSeq {} -> {} device(s)", shopId, maxSeq, tokens.size());
    }
}
