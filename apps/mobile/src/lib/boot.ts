import { getDevice, getLock, getMeta, getShop, META } from '@dukaan/db';
import { reportError } from './monitoring';
import { detectLocale } from '@/i18n';
import type { Locale } from '@/i18n/strings';
import { useSession } from '@/state/session';
import { getDb } from './db';

/** Opens the DB and decides which gate the user lands on. Measured from JS entry for the cold-start budget. */
export async function boot(): Promise<void> {
  const set = useSession.getState().set;
  try {
    const db = await getDb();
    const [shop, device, lock, locale] = await Promise.all([getShop(db), getDevice(db), getLock(db), getMeta<Locale>(db, META.locale)]);
    if (!shop || !device || !lock) {
      set({ status: 'needs-setup', locale: locale ?? detectLocale() });
      return;
    }
    set({
      status: 'locked',
      shop: { id: shop.id, name: shop.name, gstin: shop.gstin, stateCode: shop.stateCode, upiVpa: shop.upiVpa },
      device: { id: device.id, prefix: device.prefix, role: device.role },
      locale: locale ?? detectLocale(),
    });
  } catch (err) {
    reportError(err, 'boot');
    set({ status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}
