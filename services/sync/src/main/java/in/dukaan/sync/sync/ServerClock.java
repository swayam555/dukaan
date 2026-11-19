package in.dukaan.sync.sync;

import org.springframework.stereotype.Component;

/**
 * Server-side hybrid logical clock, same encoding as @dukaan/core ("ms15:counter5:node"), so that
 * server-authored ops (bill.number) sort after the device op that caused them.
 */
@Component
public class ServerClock {
    static final long MAX_DRIFT_MS = 24L * 60 * 60 * 1000;
    private static final int MAX_COUNTER = 99_999;
    private long ms;
    private int counter;

    public synchronized String now() {
        long wall = System.currentTimeMillis();
        if (wall > ms) { ms = wall; counter = 0; } else bump(ms, counter + 1);
        return encode();
    }

    /** Merges a device timestamp; a device more than 24 h ahead is ignored (peers quarantine its ops). */
    public synchronized void receive(String hlc) {
        long remoteMs;
        int remoteCounter;
        try {
            int a = hlc.indexOf(':'), b = hlc.indexOf(':', a + 1);
            remoteMs = Long.parseLong(hlc.substring(0, a));
            remoteCounter = Integer.parseInt(hlc.substring(a + 1, b));
        } catch (RuntimeException e) {
            return;
        }
        long wall = System.currentTimeMillis();
        if (remoteMs - wall > MAX_DRIFT_MS) return;
        long m = Math.max(Math.max(ms, remoteMs), wall);
        int c;
        if (m == ms && m == remoteMs) c = Math.max(counter, remoteCounter) + 1;
        else if (m == ms) c = counter + 1;
        else if (m == remoteMs) c = remoteCounter + 1;
        else c = 0;
        bump(m, c);
    }

    private void bump(long m, int c) {
        if (c > MAX_COUNTER) { ms = m + 1; counter = 0; } else { ms = m; counter = c; }
    }

    private String encode() {
        return String.format("%015d:%05d:server", ms, counter);
    }

    /** Indian financial year of a "YYYY-MM-DD" day: April–March, e.g. "2026-27". */
    static String financialYear(String day) {
        int y = Integer.parseInt(day.substring(0, 4));
        int m = Integer.parseInt(day.substring(5, 7));
        int start = m >= 4 ? y : y - 1;
        return start + "-" + String.format("%02d", (start + 1) % 100);
    }
}
