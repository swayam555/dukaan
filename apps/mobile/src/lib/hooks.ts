import { useEffect, useRef, useState } from 'react';
import { searchItems, subscribeTables, type SearchHit, type Table } from '@dukaan/db';
import { getDb, type DeviceDb } from './db';

/** Runs `query` and re-runs it whenever one of `tables` changes. DB is the source of truth. */
export function useLiveQuery<T>(tables: readonly Table[], query: (db: DeviceDb) => Promise<T>, deps: readonly unknown[] = []): { data: T | undefined; loading: boolean } {
  const [state, setState] = useState<{ data: T | undefined; loading: boolean }>({ data: undefined, loading: true });
  const generation = useRef(0);
  useEffect(() => {
    let alive = true;
    const run = async () => {
      const gen = ++generation.current;
      const data = await query(await getDb());
      if (alive && gen === generation.current) setState({ data, loading: false });
    };
    void run();
    const unsubscribe = subscribeTables(tables, () => void run());
    return () => {
      alive = false;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables.join(','), ...deps]);
  return state;
}

export type SearchState = { hits: SearchHit[]; ms: number | null; searching: boolean };

/**
 * Debounced, cancellable catalogue search. Every keystroke bumps a generation number; results from an
 * older generation are dropped, so a slow query for "b" can never overwrite the results for "bas".
 */
export function useItemSearch(query: string, debounceMs = 80, limit = 30): SearchState {
  // Results remember the query they answer; "searching" is derived (no setState inside the effect body).
  const [done, setDone] = useState<{ query: string; hits: SearchHit[]; ms: number | null }>({ query: '', hits: [], ms: null });
  const generation = useRef(0);
  const blank = !query.trim();
  useEffect(() => {
    const gen = ++generation.current;
    if (blank) return;
    const timer = setTimeout(async () => {
      const db = await getDb();
      const started = performance.now();
      const hits = await searchItems(db, query, limit);
      if (gen === generation.current) setDone({ query, hits, ms: performance.now() - started });
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [query, blank, debounceMs, limit]);
  if (blank) return { hits: [], ms: null, searching: false };
  // While a new query is pending, keep showing the previous hits (no flash of empty list).
  return { hits: done.hits, ms: done.ms, searching: done.query !== query };
}
