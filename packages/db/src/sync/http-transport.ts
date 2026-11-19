import type { Op } from './ops';
import { TransportError, type PullResult, type PushResult, type SyncTransport } from './transport';

/** The server refused our credentials (revoked device, expired token): re-pair, don't retry blindly. */
export class AuthError extends Error {}

/** A 4xx other than auth: our request is wrong, so retrying the same bytes will not help. */
export class RequestError extends Error {
  constructor(readonly status: number, readonly code: string, detail = '') {
    super(detail || `HTTP ${status}: ${code}`);
  }
}

export type HttpTransportOptions = {
  baseUrl: string;
  /** Device JWT; a function so a refreshed token is picked up without rebuilding the engine. */
  token: () => string | null | Promise<string | null>;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

/**
 * SyncTransport over the Spring service (services/sync, SyncController):
 *   POST /v1/sync/push {ops} → {acks, rejects, maxSeq}
 *   GET  /v1/sync/pull?since&limit → {ops, nextSeq, hasMore}
 *   POST /v1/sync/ack {seq}
 * Network failures, timeouts and 5xx/429 become TransportError (the engine backs off and retries);
 * 401/403 become AuthError; other 4xx RequestError.
 */
export class HttpTransport implements SyncTransport {
  private readonly base: string;
  private readonly timeoutMs: number;
  private readonly doFetch: typeof fetch;

  constructor(private readonly opts: HttpTransportOptions) {
    this.base = opts.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.doFetch = opts.fetch ?? ((...a) => fetch(...a));
  }

  async push(ops: readonly Op[]): Promise<PushResult> {
    const r = await this.call<PushResult>('POST', '/v1/sync/push', { ops });
    return { acks: r.acks ?? [], rejects: r.rejects ?? [], maxSeq: Number(r.maxSeq ?? 0) };
  }

  async pull(since: number, limit: number): Promise<PullResult> {
    const r = await this.call<PullResult>('GET', `/v1/sync/pull?since=${since}&limit=${limit}`);
    return { ops: r.ops ?? [], nextSeq: Number(r.nextSeq), hasMore: Boolean(r.hasMore) };
  }

  async ack(seq: number): Promise<void> {
    await this.call('POST', '/v1/sync/ack', { seq });
  }

  private call<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
    return this.request<T>(method, path, body, true);
  }

  /** One JSON request with the error mapping above. `auth=false` for OTP login and pairing claim. */
  async request<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, auth = true): Promise<T> {
    const token = auth ? await this.opts.token() : null;
    if (auth && !token) throw new AuthError('device not paired');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.doFetch(this.base + path, {
        method,
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctl.signal,
      });
    } catch (e) {
      throw new TransportError(ctl.signal.aborted ? `timeout after ${this.timeoutMs} ms` : `network: ${(e as Error)?.message ?? e}`);
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 500 || res.status === 429 || res.status === 408) throw new TransportError(`HTTP ${res.status}`);
    if (!res.ok) {
      let code = 'bad_request';
      let message = '';
      try {
        const j = (await res.json()) as { error?: string; code?: string; message?: string };
        code = j.error ?? j.code ?? code;
        message = j.message ?? '';
      } catch { /* non-JSON error body */ }
      if (res.status === 401 || res.status === 403) throw new AuthError(message || `HTTP ${res.status}`);
      throw new RequestError(res.status, code, message);
    }
    if (res.status === 204) return {} as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }
}
