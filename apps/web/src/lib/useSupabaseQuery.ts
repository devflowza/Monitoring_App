import { useCallback, useEffect, useRef, useState } from 'react';
import { isConfigured } from './supabase';

/** Shape every Supabase read resolves to. */
export interface QueryLike<T> {
  data: T | null;
  error: { message: string } | null;
}

export interface QueryState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Runs a Supabase query (or a composed set of queries) and exposes the full
 * tri-state — loading / error / data — instead of collapsing everything to an
 * empty dataset. This is what lets pages distinguish "no results" from "the
 * query failed / the session expired", which on a monitoring product is the
 * difference between a real all-clear and a silently broken dashboard.
 *
 * When Supabase is unconfigured (dev/preview) it resolves to a non-loading,
 * empty, error-free state so the UI still renders.
 *
 * Note: RLS-denied *reads* are silently filtered by PostgREST (they return rows,
 * not an error), so `error` reflects transport/query failures, not row-level
 * permission denials.
 */
export function useSupabaseQuery<T>(
  run: () => PromiseLike<QueryLike<T>>,
  deps: unknown[] = [],
): QueryState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(isConfigured);
  const [tick, setTick] = useState(0);
  const runRef = useRef(run);
  runRef.current = run;

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!isConfigured) { setLoading(false); setData(null); setError(null); return; }
    let active = true;
    setLoading(true);
    Promise.resolve(runRef.current())
      .then(({ data, error }) => {
        if (!active) return;
        if (error) { setError(error.message); setData(null); }
        else { setData(data); setError(null); }
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => { active = false; };
    // deps are the caller's declared dependencies; `run` is read via ref so a new
    // closure each render doesn't retrigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { data, error, loading, reload };
}
