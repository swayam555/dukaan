package in.dukaan.sync.auth;

import java.util.UUID;

public record DevicePrincipal(UUID deviceId, UUID shopId, String role, String prefix) {
    public boolean isOwner() { return "owner".equals(role); }
}
