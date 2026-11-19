import type { DayRange } from '@dukaan/db';

export type Preset = 'today' | '7d' | '30d' | 'month' | 'lastMonth';

/** Day arithmetic on YYYY-MM-DD strings at UTC noon (no DST/zone drift). */
export const shiftDay = (day: string, days: number) => new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export function rangeFor(p: Preset, today: string): DayRange {
  const monthStart = `${today.slice(0, 8)}01`;
  switch (p) {
    case 'today': return { from: today, to: today };
    case '7d': return { from: shiftDay(today, -6), to: today };
    case '30d': return { from: shiftDay(today, -29), to: today };
    case 'month': return { from: monthStart, to: today };
    case 'lastMonth': {
      const end = shiftDay(monthStart, -1);
      return { from: `${end.slice(0, 8)}01`, to: end };
    }
  }
}
