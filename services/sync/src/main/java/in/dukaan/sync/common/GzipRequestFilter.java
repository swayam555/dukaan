package in.dukaan.sync.common;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.zip.GZIPInputStream;

/** Push bodies may be gzip-compressed (Content-Encoding: gzip); a 500-op batch shrinks ~8×. Inflated size is capped. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class GzipRequestFilter extends OncePerRequestFilter {
    static final long MAX_INFLATED = 8L * 1024 * 1024;

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !"gzip".equalsIgnoreCase(request.getHeader("Content-Encoding"));
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain) throws ServletException, IOException {
        var inflated = new GZIPInputStream(req.getInputStream());
        chain.doFilter(new HttpServletRequestWrapper(req) {
            final ServletInputStream in = new Capped(inflated);

            @Override public ServletInputStream getInputStream() { return in; }
            @Override public BufferedReader getReader() { return new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8)); }
            @Override public String getHeader(String name) { return "Content-Encoding".equalsIgnoreCase(name) ? null : super.getHeader(name); }
            @Override public int getContentLength() { return -1; }
            @Override public long getContentLengthLong() { return -1; }
        }, res);
    }

    private static final class Capped extends ServletInputStream {
        private final InputStream in;
        private long read;
        private boolean eof;

        Capped(InputStream in) { this.in = in; }

        @Override public int read() throws IOException {
            int b = in.read();
            if (b < 0) eof = true; else count(1);
            return b;
        }

        @Override public int read(byte[] buf, int off, int len) throws IOException {
            int n = in.read(buf, off, len);
            if (n < 0) eof = true; else count(n);
            return n;
        }

        private void count(int n) throws IOException {
            read += n;
            if (read > MAX_INFLATED) throw new IOException("inflated body over " + MAX_INFLATED + " bytes");
        }

        @Override public boolean isFinished() { return eof; }
        @Override public boolean isReady() { return true; }
        @Override public void setReadListener(ReadListener l) { throw new UnsupportedOperationException(); }
    }
}
