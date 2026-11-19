package in.dukaan.sync.pipeline;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Keeps next month's ops partitions ready (rows landing early go to each hash bucket's default partition). */
@Component
public class PartitionMaintenance {
    private final JdbcClient jdbc;

    public PartitionMaintenance(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Scheduled(cron = "0 0 3 * * *")
    public void ensureNextMonth() {
        jdbc.sql("SELECT ensure_ops_month((now() + interval '1 month')::date)").query().singleValue();
    }
}
