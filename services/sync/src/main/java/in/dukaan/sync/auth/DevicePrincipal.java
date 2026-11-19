package in.dukaan.sync.auth;

import java.util.UUID;

public record DevicePrincipal(UUID deviceId, UUID shopId, String role, String prefix) {
    /** Read-only owner web dashboard session (no device behind it). */
    public static final String DASHBOARD = "dashboard";

    public boolean isOwner() { return "owner".equals(role); }
    public boolean isDashboard() { return DASHBOARD.equals(role); }
}
