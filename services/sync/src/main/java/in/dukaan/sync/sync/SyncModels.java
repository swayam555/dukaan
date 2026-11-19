package in.dukaan.sync.sync;

import com.fasterxml.jackson.annotation.JsonRawValue;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.List;
import java.util.Map;

public final class SyncModels {
    private SyncModels() {}

    /** An op as the device sends it (see packages/db/src/sync/ops.ts). */
    public record OpIn(@NotBlank String opId, @NotBlank String shopId, @NotBlank String deviceId,
                       @NotBlank String entity, @NotBlank String entityId, @NotBlank String type,
                       @NotBlank String hlc, String role, @NotNull Map<String, Object> payload) {}

    public record PushRequest(@NotNull List<@Valid OpIn> ops) {}

    public record Ack(String opId, long serverSeq) {}

    public record Reject(String opId, String reason) {}

    public record PushResult(List<Ack> acks, List<Reject> rejects, long maxSeq) {}

    /** An op as stored: payload is passed through as raw JSON, never re-parsed. */
    public record SeqOp(String opId, String shopId, String deviceId, String entity, String entityId, String type,
                        String hlc, String role, @JsonRawValue String payload, long serverSeq) {}

    public record PullResult(List<SeqOp> ops, long nextSeq, boolean hasMore) {}

    public record AckRequest(long seq) {}
}
