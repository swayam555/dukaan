package in.dukaan.sync.pipeline;

import io.micrometer.core.instrument.MeterRegistry;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Builds the owner's server-side read models (daily sales, item sales, stock, khata) from shop.ops.
 * Exactly-once effect on top of at-least-once delivery: each record is applied in one Postgres
 * transaction that also advances projector_cursor(shop), and records at or below the cursor are skipped.
 */
@Component
@ConditionalOnProperty(name = "dukaan.projector.enabled", havingValue = "true", matchIfMissing = true)
public class Projector {
    private static final Logger log = LoggerFactory.getLogger(Projector.class);
    private final JdbcClient jdbc;
    private final TransactionTemplate tx;
    private final JsonMapper json;
    private final MeterRegistry metrics;

    public Projector(JdbcClient jdbc, TransactionTemplate tx, JsonMapper json, MeterRegistry metrics) {
        this.jdbc = jdbc;
        this.tx = tx;
        this.json = json;
        this.metrics = metrics;
    }

    @KafkaListener(topics = KafkaTopics.SHOP_OPS, groupId = "projector")
    public void onOp(ConsumerRecord<String, String> rec) {
        Map<String, Object> op = json.readValue(rec.value(), Map.class);
        var shop = UUID.fromString((String) op.get("shopId"));
        long seq = num(op.get("serverSeq"));
        boolean applied = Boolean.TRUE.equals(tx.execute(s -> {
            var cursor = jdbc.sql("SELECT seq FROM projector_cursor WHERE shop_id = ? FOR UPDATE").param(shop).query(Long.class).optional();
            if (cursor.isPresent() && seq <= cursor.get()) return false;
            if (cursor.isPresent() && seq != cursor.get() + 1) log.warn("projector gap for shop {}: {} -> {}", shop, cursor.get(), seq);
            apply(shop, (String) op.get("type"), (String) op.get("entityId"), (Map<String, Object>) op.get("payload"));
            jdbc.sql("INSERT INTO projector_cursor(shop_id, seq) VALUES (?, ?) ON CONFLICT (shop_id) DO UPDATE SET seq = EXCLUDED.seq")
                    .params(shop, seq).update();
            return true;
        }));
        metrics.counter("dukaan.projector.ops", "result", applied ? "applied" : "duplicate").increment();
    }

    @SuppressWarnings("unchecked")
    void apply(UUID shop, String type, String entityId, Map<String, Object> p) {
        switch (type) {
            case "bill.create" -> {
                var day = LocalDate.parse((String) p.get("day"));
                long tax = num(p.get("cgstPaise")) + num(p.get("sgstPaise")) + num(p.get("igstPaise")) + num(p.get("cessPaise"));
                long credit = ((List<Map<String, Object>>) p.getOrDefault("payments", List.of())).stream()
                        .filter(x -> "credit".equals(x.get("mode"))).mapToLong(x -> num(x.get("amountPaise"))).sum();
                var lines = (List<Map<String, Object>>) p.getOrDefault("lines", List.of());
                var slim = lines.stream().map(l -> Map.of("itemId", l.get("itemId"), "qtyMilli", num(l.get("qtyMilli")),
                        "totalPaise", num(l.get("totalPaise")), "costPaise", num(l.get("costPaise")))).toList();
                int inserted = jdbc.sql("""
                        INSERT INTO rm_bill(shop_id, bill_id, day, total_paise, tax_paise, cost_paise, credit_paise, customer_id, lines)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb) ON CONFLICT DO NOTHING""")
                        .params(shop, entityId, day, num(p.get("totalPaise")), tax, num(p.get("costPaise")), credit, p.get("customerId"), json.writeValueAsString(slim))
                        .update();
                if (inserted == 0) return;
                daily(shop, day, 1, 0, num(p.get("totalPaise")), tax, num(p.get("costPaise")));
                for (var l : slim) {
                    itemSales(shop, day, (String) l.get("itemId"), num(l.get("qtyMilli")), num(l.get("totalPaise")), num(l.get("costPaise")));
                    stock(shop, (String) l.get("itemId"), -num(l.get("qtyMilli")));
                }
                if (credit > 0 && p.get("customerId") instanceof String c) khata(shop, c, credit);
            }
            case "bill.void" -> {
                record B(LocalDate day, long total, long tax, long cost, long credit, String customer, String lines) {}
                var b = jdbc.sql("""
                        UPDATE rm_bill SET status = 'void' WHERE shop_id = ? AND bill_id = ? AND status = 'final'
                        RETURNING day, total_paise, tax_paise, cost_paise, credit_paise, customer_id, lines::text""")
                        .params(shop, entityId)
                        .query((rs, i) -> new B(rs.getObject(1, LocalDate.class), rs.getLong(2), rs.getLong(3), rs.getLong(4), rs.getLong(5), rs.getString(6), rs.getString(7)))
                        .optional();
                if (b.isEmpty()) return; // already void (two devices voided it) or unknown
                var v = b.get();
                daily(shop, v.day(), -1, 1, -v.total(), -v.tax(), -v.cost());
                for (Map<String, Object> l : (List<Map<String, Object>>) json.readValue(v.lines(), List.class)) {
                    itemSales(shop, v.day(), (String) l.get("itemId"), -num(l.get("qtyMilli")), -num(l.get("totalPaise")), -num(l.get("costPaise")));
                    stock(shop, (String) l.get("itemId"), num(l.get("qtyMilli")));
                }
                if (v.credit() > 0 && v.customer() != null) khata(shop, v.customer(), -v.credit());
            }
            case "bill.number" -> jdbc.sql("UPDATE rm_bill SET global_no = ?, fy = ? WHERE shop_id = ? AND bill_id = ?")
                    .params(num(p.get("globalNo")), p.get("fy"), shop, entityId).update();
            case "ledger.add" -> khata(shop, (String) p.get("customerId"), num(p.get("amountPaise")));
            case "stock.adjust" -> stock(shop, (String) p.get("itemId"), num(p.get("deltaMilli")));
            case "purchase.create" -> {
                for (var l : (List<Map<String, Object>>) p.getOrDefault("lines", List.of())) stock(shop, (String) l.get("itemId"), num(l.get("qtyMilli")));
            }
            case "item.bulk" -> {
                for (var l : (List<Map<String, Object>>) p.getOrDefault("stock", List.of())) stock(shop, (String) l.get("itemId"), num(l.get("deltaMilli")));
            }
            default -> { /* master data (items, customers, suppliers, batches) lives on devices */ }
        }
    }

    private void daily(UUID shop, LocalDate day, int bills, int voids, long total, long tax, long cost) {
        jdbc.sql("""
                INSERT INTO rm_daily_sales AS r (shop_id, day, bills, voids, total_paise, tax_paise, cost_paise) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (shop_id, day) DO UPDATE SET bills = r.bills + EXCLUDED.bills, voids = r.voids + EXCLUDED.voids,
                  total_paise = r.total_paise + EXCLUDED.total_paise, tax_paise = r.tax_paise + EXCLUDED.tax_paise, cost_paise = r.cost_paise + EXCLUDED.cost_paise""")
                .params(shop, day, bills, voids, total, tax, cost).update();
    }

    private void itemSales(UUID shop, LocalDate day, String item, long qty, long total, long cost) {
        jdbc.sql("""
                INSERT INTO rm_item_sales AS r (shop_id, day, item_id, qty_milli, total_paise, cost_paise) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT (shop_id, day, item_id) DO UPDATE SET qty_milli = r.qty_milli + EXCLUDED.qty_milli,
                  total_paise = r.total_paise + EXCLUDED.total_paise, cost_paise = r.cost_paise + EXCLUDED.cost_paise""")
                .params(shop, day, item, qty, total, cost).update();
    }

    private void stock(UUID shop, String item, long delta) {
        if (item == null || delta == 0) return;
        jdbc.sql("""
                INSERT INTO rm_stock AS r (shop_id, item_id, qty_milli) VALUES (?, ?, ?)
                ON CONFLICT (shop_id, item_id) DO UPDATE SET qty_milli = r.qty_milli + EXCLUDED.qty_milli""")
                .params(shop, item, delta).update();
    }

    private void khata(UUID shop, String customer, long delta) {
        if (customer == null) return;
        jdbc.sql("""
                INSERT INTO rm_khata AS r (shop_id, customer_id, balance_paise) VALUES (?, ?, ?)
                ON CONFLICT (shop_id, customer_id) DO UPDATE SET balance_paise = r.balance_paise + EXCLUDED.balance_paise""")
                .params(shop, customer, delta).update();
    }

    static long num(Object o) {
        return o instanceof Number n ? n.longValue() : 0L;
    }
}
