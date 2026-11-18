package in.dukaan.sync.auth;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class MeController {
    @GetMapping("/v1/me")
    public DevicePrincipal me(HttpServletRequest req) {
        return (DevicePrincipal) req.getAttribute(AuthFilter.PRINCIPAL);
    }
}
