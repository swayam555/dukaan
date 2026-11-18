import { getLocales } from 'expo-localization';
import { useCallback } from 'react';
import { useSession } from '@/state/session';
import { DICTIONARIES, en, type Locale, type StringKey } from './strings';

export function detectLocale(): Locale {
  const code = getLocales()[0]?.languageCode ?? 'en';
  return code in DICTIONARIES ? (code as Locale) : 'en';
}

export function translate(locale: Locale, key: StringKey, vars?: Record<string, string | number>): string {
  const raw = DICTIONARIES[locale][key] ?? en[key];
  return vars ? raw.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? '')) : raw;
}

export function useT() {
  const locale = useSession((s) => s.locale);
  return useCallback((key: StringKey, vars?: Record<string, string | number>) => translate(locale, key, vars), [locale]);
}

export type { Locale, StringKey };
