package in.dukaan.sync.sync;

import in.dukaan.sync.auth.DevicePrincipal;
import in.dukaan.sync.common.ApiException;
import in.dukaan.sync.common.DukaanProperties;
import in.dukaan.sync.sync.SyncModels.*;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

import java.util.*;

/**
 * The server half of the sync contract. Mirrors packages/db/src/sync/memory-server.ts, which the
 * device engine is fault-tested against:
 *  - op_id is idempotent: a re-push returns the original server_seq;
 *  - one gap-free sequence per shop (shop.next_seq, locked FOR UPDATE for the push transaction);
 *  - ops a cashier may not author (roleViolation) are rejected, and the device's real role is stamped;
 *  - every new bill.create gets a server-authored bill.number op with a gap-free number per FY.
 */
@Service
public class SyncService {
    static final Set<String> OWNER_ONLY = Set.of("bill.void", "stock.adjust", "purchase.create", "supplier.upsert", "item.bulk");
    static final Set<String> KNOWN_TYPES = Set.of("item.upsert", "item.bulk", "customer.upsert", "supplier.upsert", "batch.upsert",
            "stock.adjust", "bill.create", "bill.void", "ledger.add", "purchase.create");
    /** Mirrors roleViolation() in packages/db/src/sync/ops.ts. */
    static final List<String> OWNER_ITEM_FIELDS = List.of("mrpPaise", "salePaise", "costPaise", "gstBp", "cessBp", "priceInclTax", "deleted");
    static final Set<String> OWNER_LEDGER_KINDS = Set.of("opening", "adjust");

    static String roleViolation(String type, boolean owner, Map<String, Object> payload) {
        if (owner) return null;
        if (OWNER_ONLY.contains(type)) return type + " needs the owner role";
        if ("item.upsert".equals(type)) {
            for (var f : OWNER_ITEM_FIELDS) if (payload.containsKey(f)) return "changing item " + f + " needs the owner role";
        }
        if ("ledger.add".equals(type) && OWNER_LEDGER_KINDS.contains(String.valueOf(payload.get("kind")))) {
            return "ledger " + payload.get("kind") + " needs the owner role";
        }
        return null;
    }
    private static final String INSERT_OP = """
            INSERT INTO ops(shop_id, server_seq, op_id, device_id, entity, entity_id, type, hlc, role, payload)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb)""";

    private final JdbcClient jdbc;
    private final JdbcTemplate batch;
    private final JsonMapper json;
    private final ServerClock clock;
    private final DukaanProperties props;
    private final MeterRegistry metrics;

    public SyncService(JdbcClient jdbc, JdbcTemplate batch, JsonMapper json, ServerClock clock, DukaanProperties props, MeterRegistry metrics) {
        this.jdbc = jdbc;
        this.batch = batch;
        this.json = json;
        this.clock = clock;
        this.props = props;
        this.metrics = metrics;
    }

    @Transactional
    public PushResult push(DevicePrincipal device, List<OpIn> ops) {
        if (ops.size() > props.maxPushOps()) throw ApiException.badRequest("batch_too_large", "at most " + props.maxPushOps() + " ops per push");
        var shopId = device.shopId();
        var deviceId = device.deviceId().toString();
        // Row lock = the shop's critical section: pushes from one shop serialise, other shops don't wait.
        long next = jdbc.sql("SELECT next_seq FROM shop WHERE id = ? FOR UPDATE").param(shopId).query(Long.class).single();

        var ids = new ArrayList<UUID>();
        for (var op : ops) parseUuid(op.opId()).ifPresent(ids::add);
        var known = new HashMap<String, long[]>(); // opId -> [serverSeq, sameShop]
        if (!ids.isEmpty()) {
            jdbc.sql("SELECT op_id::text, shop_id, server_seq FROM op_ids WHERE op_id = ANY(?)")
                    .param(ids.toArray(UUID[]::new))
                    .query((rs, i) -> known.put(rs.getString(1), new long[]{rs.getLong(3), shopId.equals(rs.getObject(2, UUID.class)) ? 1 : 0}))
                    .list();
        }

        var acks = new ArrayList<Ack>();
        var rejects = new ArrayList<Reject>();
        var opRows = new ArrayList<Object[]>();
        var idRows = new ArrayList<Object[]>();
        for (var op : ops) {
            var uuid = parseUuid(op.opId());
            if (uuid.isEmpty()) { rejects.add(new Reject(op.opId(), "op id is not a uuid")); continue; }
            var key = uuid.get().toString();
            var seen = known.get(key);
            if (seen != null) {
                if (seen[1] == 1) acks.add(new Ack(op.opId(), seen[0]));
                else rejects.add(new Reject(op.opId(), "op id belongs to another shop"));
                continue;
            }
            String reason = !shopId.toString().equalsIgnoreCase(op.shopId()) || !deviceId.equalsIgnoreCase(op.deviceId()) ? "wrong shop or device"
                    : !KNOWN_TYPES.contains(op.type()) ? "unknown op type " + op.type()
                    : roleViolation(op.type(), device.isOwner(), op.payload());
            if (reason != null) { rejects.add(new Reject(op.opId(), reason)); continue; }

            long seq = next++;
            // The role on the op is what peers check; the server stamps the device's real role.
            opRows.add(new Object[]{shopId, seq, uuid.get(), deviceId, op.entity(), op.entityId(), op.type(), op.hlc(), device.role(), json.writeValueAsString(op.payload())});
            idRows.add(new Object[]{uuid.get(), shopId, seq});
            known.put(key, new long[]{seq, 1});
            acks.add(new Ack(op.opId(), seq));
            clock.receive(op.hlc());

            if (op.type().equals("bill.create") && op.payload().get("day") instanceof String day) {
                var fy = ServerClock.financialYear(day);
                long no = jdbc.sql("""
                        INSERT INTO bill_number(shop_id, fy, next_no) VALUES (?, ?, 2)
                        ON CONFLICT (shop_id, fy) DO UPDATE SET next_no = bill_number.next_no + 1
                        RETURNING next_no - 1""").params(shopId, fy).query(Long.class).single();
                long numSeq = next++;
                var numId = UUID.randomUUID();
                opRows.add(new Object[]{shopId, numSeq, numId, "server", "bill", op.entityId(), "bill.number", clock.now(), "owner",
                        json.writeValueAsString(Map.of("globalNo", no, "fy", fy))});
                idRows.add(new Object[]{numId, shopId, numSeq});
            }
        }
        if (!opRows.isEmpty()) {
            batch.batchUpdate(INSERT_OP, opRows);
            batch.batchUpdate("INSERT INTO op_ids(op_id, shop_id, server_seq) VALUES (?, ?, ?)", idRows);
            jdbc.sql("UPDATE shop SET next_seq = ? WHERE id = ?").params(next, shopId).update();
        }
        jdbc.sql("UPDATE device SET last_seen = now() WHERE id = ?").param(device.deviceId()).update();
        metrics.counter("dukaan.sync.ops", "result", "stored").increment(opRows.size());
        metrics.counter("dukaan.sync.ops", "result", "rejected").increment(rejects.size());
        return new PushResult(acks, rejects, next - 1);
    }

    public PullResult pull(DevicePrincipal device, long since, int limit) {
        int n = Math.max(1, Math.min(limit, props.maxPullOps()));
        var rows = jdbc.sql("""
                SELECT op_id::text, shop_id::text, device_id, entity, entity_id, type, hlc, role, payload::text, server_seq
                FROM ops WHERE shop_id = ? AND server_seq > ? ORDER BY server_seq LIMIT ?""")
                .params(device.shopId(), since, n + 1)
                .query((rs, i) -> new SeqOp(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5),
                        rs.getString(6), rs.getString(7), rs.getString(8), rs.getString(9), rs.getLong(10)))
                .list();
        boolean hasMore = rows.size() > n;
        var page = hasMore ? rows.subList(0, n) : rows;
        long nextSeq = page.isEmpty() ? since : page.getLast().serverSeq();
        metrics.counter("dukaan.sync.pulled").increment(page.size());
        return new PullResult(page, nextSeq, hasMore);
    }

    /** The device has applied everything up to seq; the minimum over a shop's devices bounds tombstone GC. */
    public void ack(DevicePrincipal device, long seq) {
        jdbc.sql("""
                UPDATE device SET ack_seq = GREATEST(ack_seq, LEAST(?, (SELECT next_seq - 1 FROM shop WHERE id = device.shop_id))), last_seen = now()
                WHERE id = ?""").params(seq, device.deviceId()).update();
    }

    private static Optional<UUID> parseUuid(String s) {
        try {
            return Optional.of(UUID.fromString(s));
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
    }
}
