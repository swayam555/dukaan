package in.dukaan.sync.dashboard;

import in.dukaan.sync.auth.AuthFilter;
import in.dukaan.sync.auth.DevicePrincipal;
import in.dukaan.sync.common.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.*;

/**
 * Owner web dashboard: read-only numbers from the projector's read models. They trail the phones by the
 * pipeline lag (push → outbox → Kafka → projector), and show only what phones have synced.
 */
@RestController
public class DashboardController {
    static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private final JdbcClient jdbc;

    public DashboardController(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public record Day(LocalDate day, int bills, int voids, long totalPaise, long taxPaise, long costPaise) {}
    public record TopItem(String itemId, String name, long qtyMilli, long totalPaise) {}
    public record Due(String customerId, String name, long balancePaise) {}
    public record Device(String name, String prefix, String role, boolean revoked, java.time.OffsetDateTime lastSeen) {}
    public record Summary(String shopName, LocalDate from, LocalDate to, long totalPaise, int bills, int voids, long taxPaise,
                          long profitPaise, long toCollectPaise, int customersWithDues, List<Day> days, List<TopItem> topItems,
                          List<Due> topDues, List<Device> devices, long lastServerSeq, long projectedSeq) {}

    @GetMapping("/v1/dashboard/summary")
    public Summary summary(HttpServletRequest req, @RequestParam(defaultValue = "30") int days) {
        var me = (DevicePrincipal) req.getAttribute(AuthFilter.PRINCIPAL);
        if (!me.isDashboard() && !me.isOwner()) throw ApiException.forbidden("only the owner can see the dashboard");
        if (days < 1 || days > 366) throw ApiException.badRequest("bad_range", "days must be 1..366");
        var shop = me.shopId();
        var to = LocalDate.now(IST);
        var from = to.minusDays(days - 1L);

        var shopRow = jdbc.sql("SELECT name, next_seq FROM shop WHERE id = ?").param(shop)
                .query((rs, i) -> Map.entry(rs.getString(1), rs.getLong(2))).single();
        var series = jdbc.sql("""
                SELECT day, bills, voids, total_paise, tax_paise, cost_paise FROM rm_daily_sales
                WHERE shop_id = ? AND day BETWEEN ? AND ? ORDER BY day""").params(shop, from, to).query(Day.class).list();
        // Fill empty days so the chart has one bar per day.
        var byDay = new HashMap<LocalDate, Day>();
        for (var d : series) byDay.put(d.day(), d);
        var filled = new ArrayList<Day>();
        for (var d = from; !d.isAfter(to); d = d.plusDays(1)) filled.add(byDay.getOrDefault(d, new Day(d, 0, 0, 0, 0, 0)));

        long total = 0, tax = 0, cost = 0;
        int bills = 0, voids = 0;
        for (var d : series) { total += d.totalPaise(); tax += d.taxPaise(); cost += d.costPaise(); bills += d.bills(); voids += d.voids(); }

        var top = jdbc.sql("""
                SELECT s.item_id, COALESCE(n.name, s.item_id) AS name, s.qty, s.total FROM (
                  SELECT item_id, sum(qty_milli) AS qty, sum(total_paise) AS total FROM rm_item_sales
                  WHERE shop_id = :shop AND day BETWEEN :from AND :to GROUP BY item_id ORDER BY total DESC LIMIT 10) s
                LEFT JOIN LATERAL (
                  SELECT l->>'name' AS name FROM rm_bill b, jsonb_array_elements(b.lines) l
                  WHERE b.shop_id = :shop AND l->>'itemId' = s.item_id AND COALESCE(l->>'name', '') <> '' LIMIT 1) n ON true
                ORDER BY s.total DESC""").param("shop", shop).param("from", from).param("to", to)
                .query((rs, i) -> new TopItem(rs.getString(1), rs.getString(2), rs.getLong(3), rs.getLong(4))).list();

        var dues = jdbc.sql("""
                SELECT k.customer_id, COALESCE(c.name, 'Customer'), k.balance_paise FROM rm_khata k
                LEFT JOIN LATERAL (
                  SELECT payload->>'name' AS name FROM ops o
                  WHERE o.shop_id = k.shop_id AND o.type = 'customer.upsert' AND o.entity_id = k.customer_id AND payload->>'name' IS NOT NULL
                  ORDER BY o.hlc DESC LIMIT 1) c ON true
                WHERE k.shop_id = ? AND k.balance_paise > 0 ORDER BY k.balance_paise DESC LIMIT 10""").param(shop)
                .query((rs, i) -> new Due(rs.getString(1), rs.getString(2), rs.getLong(3))).list();
        var owed = jdbc.sql("SELECT COALESCE(sum(balance_paise), 0), count(*) FROM rm_khata WHERE shop_id = ? AND balance_paise > 0")
                .param(shop).query((rs, i) -> Map.entry(rs.getLong(1), rs.getInt(2))).single();

        var devices = jdbc.sql("SELECT name, prefix, role, revoked, last_seen FROM device WHERE shop_id = ? ORDER BY created_at")
                .param(shop).query(Device.class).list();
        long projected = jdbc.sql("SELECT COALESCE(max(seq), 0) FROM projector_cursor WHERE shop_id = ?").param(shop).query(Long.class).single();

        return new Summary(shopRow.getKey(), from, to, total, bills, voids, tax, total - tax - cost, owed.getKey(), owed.getValue(),
                filled, top, dues, devices, shopRow.getValue() - 1, projected);
    }
}
