import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, get, onApiError, patch, post } from './api';
import { useI18n } from '../i18n';
import { useLiveStream, type LiveStatus } from './live';
import type { GuestMeDto } from '../../../shared/src/api';

interface GuestState {
  me: GuestMeDto | null;
  loading: boolean;
  /** Set when the server revoked this device (room move, rotation, checkout expiry). */
  revoked: boolean;
  /** Increments whenever live updates say stay data changed; pages refetch on it. */
  version: number;
  live: LiveStatus;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  clearRevoked: () => void;
}

const Ctx = createContext<GuestState | null>(null);

// Device-local flag so "you were signed out" survives a reload until dismissed or re-activated.
const REVOKED_KEY = 'pa.revoked';
const storeRevoked = (on: boolean) => {
  try {
    if (on) localStorage.setItem(REVOKED_KEY, '1');
    else localStorage.removeItem(REVOKED_KEY);
  } catch {
    /* storage unavailable */
  }
};
const readRevoked = () => {
  try {
    return localStorage.getItem(REVOKED_KEY) === '1';
  } catch {
    return false;
  }
};

export function GuestProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<GuestMeDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [revoked, setRevokedState] = useState(readRevoked);
  const setRevoked = useCallback((on: boolean) => {
    storeRevoked(on);
    setRevokedState(on);
  }, []);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const r = await get<{ me: GuestMeDto }>('/api/guest/me');
      setMe(r.me);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return onApiError((err) => {
      if (err.code === 'session_revoked') {
        setMe(null);
        setRevoked(true);
      } else if (err.code === 'post_stay_only' || err.code === 'stay_checked_out' || err.code === 'room_changed') {
        void refresh();
      }
    });
  }, [refresh, setRevoked]);

  // Keep the session's language (used for outside-app notifications) in step with the UI.
  const { lang } = useI18n();
  const ordering = me?.capability === 'order';
  useEffect(() => {
    if (ordering) void patch('/api/guest/language', { language: lang }).catch(() => undefined);
  }, [lang, ordering]);

  const streamUrl = me?.capability === 'order' ? '/api/guest/stream' : null;
  const live = useLiveStream(streamUrl, {
    onSync: () => setVersion((v) => v + 1),
    onEvent: () => setVersion((v) => v + 1),
    onRevoked: () => void refresh().then(() => setVersion((v) => v + 1)),
  });

  const signOut = useCallback(async () => {
    await post('/api/guest/logout').catch(() => undefined);
    setMe(null);
  }, []);

  const value = useMemo(
    () => ({ me, loading, revoked, version, live, refresh, signOut, clearRevoked: () => setRevoked(false) }),
    [me, loading, revoked, version, live, refresh, signOut, setRevoked],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGuest(): GuestState {
  const v = useContext(Ctx);
  if (!v) throw new Error('GuestProvider missing');
  return v;
}
