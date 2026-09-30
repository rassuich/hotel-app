import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, get } from './api';

export interface Query<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => Promise<void>;
}

/** Minimal GET hook. `deps` changes (e.g. a live-update version) trigger a refetch. */
export function useQuery<T>(url: string | null, deps: unknown[] = []): Query<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!url);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!url) {
      setLoading(false);
      return;
    }
    const n = ++seq.current;
    setLoading(true);
    try {
      const d = await get<T>(url);
      if (n === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (n === seq.current) setError(e as ApiError);
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [url]);
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, ...deps]);
  return { data, error, loading, reload: load };
}

const PROPERTY_KEY = 'pa.property';

export function getSelectedProperty(): string | null {
  try {
    return localStorage.getItem(PROPERTY_KEY);
  } catch {
    return null;
  }
}

export function setSelectedProperty(id: string) {
  try {
    localStorage.setItem(PROPERTY_KEY, id);
  } catch {
    /* ignore */
  }
}
