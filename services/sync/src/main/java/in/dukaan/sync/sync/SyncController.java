package in.dukaan.sync.sync;

import in.dukaan.sync.auth.AuthFilter;
import in.dukaan.sync.auth.DevicePrincipal;
import in.dukaan.sync.sync.SyncModels.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/v1/sync")
public class SyncController {
    private final SyncService sync;

    public SyncController(SyncService sync) {
        this.sync = sync;
    }

    private static DevicePrincipal me(HttpServletRequest req) {
        return (DevicePrincipal) req.getAttribute(AuthFilter.PRINCIPAL);
    }

    @PostMapping("/push")
    public PushResult push(HttpServletRequest req, @Valid @RequestBody PushRequest body) {
        return sync.push(me(req), body.ops());
    }

    @GetMapping("/pull")
    public PullResult pull(HttpServletRequest req, @RequestParam(defaultValue = "0") long since, @RequestParam(defaultValue = "1000") int limit) {
        return sync.pull(me(req), since, limit);
    }

    @PostMapping("/ack")
    public Map<String, Object> ack(HttpServletRequest req, @RequestBody AckRequest body) {
        sync.ack(me(req), body.seq());
        return Map.of("ok", true);
    }
}
