import { create } from 'zustand';
import type { Locale } from '@/i18n/strings';

export type Role = 'owner' | 'cashier';

export type Shop = {
  id: string;
  name: string;
  gstin: string;
  stateCode: string;
  upiVpa: string;
};

export type Device = { id: string; prefix: string; role: Role };

type SessionState = {
  status: 'booting' | 'needs-setup' | 'locked' | 'ready' | 'error';
  error: string | null;
  shop: Shop | null;
  device: Device | null;
  locale: Locale;
  unlockedAt: number | null;
  set: (patch: Partial<Omit<SessionState, 'set'>>) => void;
};

/** UI/session state only — business data lives in SQLite and is read via reactive queries. */
export const useSession = create<SessionState>((set) => ({
  status: 'booting',
  error: null,
  shop: null,
  device: null,
  locale: 'en',
  unlockedAt: null,
  set: (patch) => set(patch),
}));
