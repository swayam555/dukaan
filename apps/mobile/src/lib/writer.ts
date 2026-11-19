import { loadClock, OpWriter } from '@dukaan/db';
import { useSession } from '@/state/session';
import { getDb } from './db';

let writer: Promise<OpWriter> | null = null;

/** One op writer per process; its HLC is restored from SQLite so timestamps never go backwards across restarts. */
export function getWriter(): Promise<OpWriter> {
  writer ??= (async () => {
    const { shop, device } = useSession.getState();
    if (!shop || !device) throw new Error('device not set up');
    const db = await getDb();
    return new OpWriter({ shopId: shop.id, deviceId: device.id, role: device.role }, await loadClock(db, device.id));
  })();
  return writer;
}

/** Drop the cached writer (tests; a different shop/device identity on this process). */
export function resetWriter(): void {
  writer = null;
}
