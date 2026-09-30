import { useEffect, useRef, useState } from 'react';

export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'closed';

/**
 * Subscribes to an authenticated SSE stream. Live events are only hints: on
 * every (re)connect `onSync` runs so the caller reloads authoritative state
 * from the API, which covers any alert missed while disconnected.
 */
export function useLiveStream(
  url: string | null,
  handlers: { onSync: () => void; onEvent?: (type: string, data: any) => void; onRevoked?: () => void },
): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!url) {
      setStatus('closed');
      return;
    }
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let attempts = 0;

    const connect = () => {
      es = new EventSource(url, { withCredentials: true });
      const on = (type: string) =>
        es!.addEventListener(type, (e) => {
          const data = JSON.parse((e as MessageEvent).data || '{}');
          if (type === 'hello') {
            attempts = 0;
            setStatus('live');
            ref.current.onSync();
            return;
          }
          if (type === 'session.revoked' || type === 'session.changed') {
            stopped = true;
            es?.close();
            setStatus('closed');
            ref.current.onRevoked?.();
            return;
          }
          ref.current.onEvent?.(type, data);
        });
      ['hello', 'session.revoked', 'session.changed', 'request.created', 'request.updated', 'request.callback', 'requests.changed', 'notice.created'].forEach(on);
      es.onerror = () => {
        es?.close();
        if (stopped) return;
        setStatus('reconnecting');
        attempts++;
        // Back off, then reconnect; an auth failure surfaces through the next API call.
        retry = setTimeout(connect, Math.min(15_000, 1000 * 2 ** Math.min(attempts, 4)));
      };
    };
    connect();
    const onOnline = () => {
      if (!stopped && status !== 'live') {
        es?.close();
        connect();
      }
    };
    window.addEventListener('online', onOnline);
    return () => {
      stopped = true;
      es?.close();
      if (retry) clearTimeout(retry);
      window.removeEventListener('online', onOnline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return status;
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}
