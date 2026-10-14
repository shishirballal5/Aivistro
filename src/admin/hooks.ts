import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/http";

export const errorMessage = (e: unknown, fallback = "Something went wrong. Please try again.") => (e instanceof ApiError || e instanceof Error ? e.message || fallback : fallback);

/** Loads data from the API. `reload()` refetches; a stale response from an older `deps` set is ignored. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data: T | null; error: string; loading: boolean }>({ data: null, error: "", loading: true });
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const run = useCallback(() => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: "" }));
    fnRef.current().then((data) => { if (id === seq.current) setState({ data, error: "", loading: false }); }, (e) => { if (id === seq.current) setState((s) => ({ ...s, error: errorMessage(e, "Couldn't load this page."), loading: false })); });
  }, []);
  useEffect(() => { run(); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, reload: run, setData: (data: T) => setState((s) => ({ ...s, data })) };
}
