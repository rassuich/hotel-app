import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, get, onApiError, patch, post } from './api';
import { useI18n } from '../i18n';
import { useLiveStream, type LiveStatus } from './live';
import type { GuestMeDto } from '../../../shared/src/api';

interface GuestState {
  me: GuestMeDto | null;
  loading: boolean;
  /** True when the session could not be checked (offline, server error): not the same as "no session". */
  unavailable: boolean;
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
  const [unavailable, setUnavailable] = useState(false);
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
      setUnavailable(false);
    } catch (e) {
      const err = e as ApiError;
      // Only a definite 401 means "no session"; anything else keeps what we knew.
      if (err.status === 401) {
        setMe(null);
        setUnavailable(false);
      } else {
        setUnavailable(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const retry = () => void refresh();
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [refresh]);

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

  // Keep the session language (used for outside-app notifications) in step with the UI.
  // A device that never chose explicitly adopts the session's language instead of overwriting it.
  const { lang, chosen, setLang, setTimeZone } = useI18n();
  const ordering = me?.capability === 'order';
  useEffect(() => {
    if (me && !chosen) setLang(me.language);
  }, [me, chosen, setLang]);
  const synced = useRef<string | null>(null);
  useEffect(() => {
    if (!me) synced.current = null;
    else if (synced.current === null) synced.current = me.language;
    if (!ordering || !chosen || synced.current === lang) return;
    synced.current = lang;
    void patch('/api/guest/language', { language: lang }).catch(() => {
      synced.current = null;
    });
  }, [lang, ordering, chosen, me]);
  // Guest-facing times are shown in the hotel's time zone.
  useEffect(() => {
    setTimeZone(me?.property.timezone);
  }, [me?.property.timezone, setTimeZone]);

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
    () => ({ me, loading, unavailable, revoked, version, live, refresh, signOut, clearRevoked: () => setRevoked(false) }),
    [me, loading, unavailable, revoked, version, live, refresh, signOut, setRevoked],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGuest(): GuestState {
  const v = useContext(Ctx);
  if (!v) throw new Error('GuestProvider missing');
  return v;
}
