import { AppState, type AppStateStatus } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { AuthError, getMeta, HttpTransport, one, setMeta, subscribeTables, SyncApi, SyncEngine, type SyncState } from '@dukaan/db';
import { create } from 'zustand';
import { getDb } from './db';
import { getWriter } from './writer';

/** Where the sync service lives. Debug builds allow cleartext (adb reverse tcp:4780 tcp:4780); release must be https. */
export const DEFAULT_SYNC_URL = process.env.EXPO_PUBLIC_SYNC_URL ?? 'http://localhost:4780';

const META_SYNC = 'sync';
const TOKEN_KEY = 'dukaan.sync.jwt';
const PERIOD_MS = 60_000;
const DEBOUNCE_MS = 1_500;

/** Non-secret part lives in the (encrypted) DB; the device JWT in the Keystore-backed SecureStore. */
export type SyncConfig = { url: string; phone: string | null; connectedAt: number };

type SyncUi = {
  config: SyncConfig | null;
  state: SyncState | 'off';
  lastOkAt: number | null;
  lastError: string | null;
  pending: number;
  set: (p: Partial<Omit<SyncUi, 'set'>>) => void;
};

export const useSync = create<SyncUi>((set) => ({
  config: null, state: 'off', lastOkAt: null, lastError: null, pending: 0, set: (p) => set(p),
}));

export const getSyncToken = () => SecureStore.getItemAsync(TOKEN_KEY);

export const loadSyncConfig = async () => getMeta<SyncConfig>(await getDb(), META_SYNC);

export function apiFor(url: string, token: () => string | null = () => null) {
  return new SyncApi({ baseUrl: url, token });
}

/** Store credentials only (joining phone: the layout starts sync once the session is ready). */
export async function persistConnection(input: Omit<SyncConfig, 'connectedAt'>, jwt: string): Promise<void> {
  const config: SyncConfig = { ...input, connectedAt: Date.now() };
  await SecureStore.setItemAsync(TOKEN_KEY, jwt);
  await setMeta(await getDb(), META_SYNC, config);
  useSync.getState().set({ config, lastError: null });
}

/** Called after OTP verify on an already-running shop: persist credentials and start syncing. */
export async function saveConnection(input: Omit<SyncConfig, 'connectedAt'>, jwt: string): Promise<void> {
  await persistConnection(input, jwt);
  await startSync();
}

export async function disconnect(): Promise<void> {
  stopSync();
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await (await getDb()).execute('DELETE FROM meta WHERE key = ?', [META_SYNC]);
  useSync.getState().set({ config: null, state: 'off' });
}

let engine: SyncEngine | null = null;
let cleanup: (() => void) | null = null;
let debounce: ReturnType<typeof setTimeout> | null = null;

async function countPending(): Promise<number> {
  const r = await one<{ n: number }>(await getDb(), 'SELECT count(*) AS n FROM op_log WHERE local = 1 AND server_seq IS NULL');
  return r?.n ?? 0;
}

/** Runs one sync; never throws (the engine schedules its own backoff retry). */
export async function syncNow(): Promise<void> {
  if (!engine) return;
  const ui = useSync.getState();
  try {
    await engine.sync();
    ui.set({ lastOkAt: Date.now(), lastError: null, pending: await countPending() });
  } catch (e) {
    if (e instanceof AuthError) {
      // revoked or expired: stop hammering the server, the owner has to reconnect this phone
      stopSync();
      ui.set({ state: 'off', lastError: 'This phone was signed out of the shop. Reconnect in Settings.' });
      return;
    }
    ui.set({ lastError: e instanceof Error ? e.message : String(e), pending: await countPending() });
  }
}

/**
 * Starts the sync loop if this shop is connected: on start, every minute, on app foreground, and
 * 1.5 s after any local write (debounced, so a burst of bills is one push).
 */
export async function startSync(): Promise<void> {
  stopSync();
  const config = await loadSyncConfig();
  const ui = useSync.getState();
  ui.set({ config });
  if (!config) return;
  const jwt = await getSyncToken();
  if (!jwt) {
    ui.set({ state: 'off', lastError: 'Sign-in missing on this phone. Reconnect in Settings.' });
    return;
  }
  const writer = await getWriter();
  const transport = new HttpTransport({ baseUrl: config.url, token: () => jwt });
  engine = new SyncEngine(await getDb(), transport, writer.clock, { shopId: writer.ctx.shopId, deviceId: writer.ctx.deviceId }, {
    onState: (state) => useSync.getState().set({ state }),
  });

  const kick = () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => { debounce = null; void syncNow(); }, DEBOUNCE_MS);
  };
  // local writes always touch 'sync' (op_log); pulls also emit it, so only kick when something is unpushed
  const unsub = subscribeTables(['sync'], () => {
    void countPending().then((pending) => {
      useSync.getState().set({ pending });
      if (pending > 0) kick();
    });
  });
  const timer = setInterval(() => void syncNow(), PERIOD_MS);
  const app = AppState.addEventListener('change', (s: AppStateStatus) => { if (s === 'active') void syncNow(); });
  cleanup = () => { unsub(); clearInterval(timer); app.remove(); };
  void syncNow();
}

export function stopSync(): void {
  cleanup?.();
  cleanup = null;
  if (debounce) clearTimeout(debounce);
  debounce = null;
  engine?.stop();
  engine = null;
}
