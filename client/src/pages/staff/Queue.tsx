import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { get } from '../../lib/api';
import { useLiveStream } from '../../lib/live';
import { ErrorNotice, Notice, Loading } from '../../components/ui';
import TicketCard from './TicketCard';
import { useStaff } from './staffContext';
import type { StaffRequestDto } from '../../../../shared/src/api';

/** Short two-tone chime via Web Audio (needs one user tap to unlock, per browser policy). */
function useChime() {
  const ctxRef = useRef<AudioContext | null>(null);
  const [enabled, setEnabled] = useState(false);
  const enable = () => {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    ctxRef.current = new Ctx();
    void ctxRef.current.resume();
    setEnabled(true);
  };
  const play = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    [0, 0.22].forEach((offset, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = i === 0 ? 880 : 1175;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
      g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + offset + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.35);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + offset);
      o.stop(ctx.currentTime + offset + 0.4);
    });
  }, []);
  return { enabled, enable, play };
}

export default function Queue() {
  const { t } = useI18n();
  const { me } = useStaff();
  const [scope, setScope] = useState<'open' | 'closed'>('open');
  const [items, setItems] = useState<StaffRequestDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [now, setNow] = useState(Date.now());
  const seen = useRef<Set<number> | null>(null);
  const chime = useChime();
  const playChime = chime.play;
  const baseTitle = useRef(document.title);

  const load = useCallback(async () => {
    try {
      const r = await get<{ requests: StaffRequestDto[] }>(`/api/staff/queue?scope=${scope}`);
      setItems(r.requests);
      setError(null);
      if (scope === 'open') {
        // First load establishes the baseline; later loads alert on unseen new/callback tickets.
        const fresh = r.requests.filter((x) => x.state === 'received' && !x.owner);
        if (seen.current) {
          const unseen = fresh.filter((x) => !seen.current!.has(x.id * 1000 + x.attempts.length));
          if (unseen.length) {
            const x = unseen[0];
            setAlert(x.attempts.length > 1 ? t('staff.callbackRequest', { ref: x.ref }) : t('staff.newRequest', { ref: x.ref }));
            playChime();
          }
        }
        seen.current = new Set([...(seen.current ?? []), ...fresh.map((x) => x.id * 1000 + x.attempts.length)]);
      }
    } catch (e) {
      setError((e as { code: string }).code);
    }
  }, [scope, t, playChime]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!alert) {
      document.title = baseTitle.current;
      return;
    }
    let on = false;
    const id = setInterval(() => {
      on = !on;
      document.title = on ? `(!) ${alert}` : baseTitle.current;
    }, 1000);
    const clear = setTimeout(() => setAlert(null), 8000);
    return () => {
      clearInterval(id);
      clearTimeout(clear);
      document.title = baseTitle.current;
    };
  }, [alert]);

  // Every (re)connect reloads the full queue from the server; events just trigger reloads.
  const live = useLiveStream('/api/staff/stream', { onSync: load, onEvent: () => void load() });

  const deviceId = me.device!.id;
  const list = items ?? [];
  const attention = list.filter((r) => r.attention.flag || (r.pos.status === 'uncertain' && ['completed', 'cancelled', 'rejected'].includes(r.state)));
  const rest = list.filter((r) => !attention.includes(r));
  const newOnes = rest.filter((r) => !r.owner && r.state === 'received');
  const waiting = rest.filter((r) => r.state === 'confirmation_not_received');
  const working = rest.filter((r) => !newOnes.includes(r) && !waiting.includes(r));

  const onChanged = (updated: StaffRequestDto | null, code?: string) => {
    if (code) setStale(true);
    if (updated) setItems((cur) => (cur ?? []).map((x) => (x.id === updated.id ? updated : x)));
    void load();
  };

  const section = (key: string, rows: StaffRequestDto[]) =>
    rows.length > 0 && (
      <section aria-labelledby={`s-${key}`}>
        <h2 className="section-title" id={`s-${key}`}>
          {t(`staff.sections_${key}`)} <span className="count">{rows.length}</span>
        </h2>
        <div className="queue">
          {rows.map((r) => (
            <TicketCard key={`${r.id}-${r.revision}`} r={r} myDeviceId={deviceId} now={now} isNew={key === 'new'} onChanged={onChanged} />
          ))}
        </div>
      </section>
    );

  return (
    <>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <div className="tabs" style={{ marginBottom: 0, borderBottom: 0 }}>
          <a href="#" className={scope === 'open' ? 'active' : ''} onClick={(e) => (e.preventDefault(), setScope('open'))}>
            {t('staff.open')}
          </a>
          <a href="#" className={scope === 'closed' ? 'active' : ''} onClick={(e) => (e.preventDefault(), setScope('closed'))}>
            {t('staff.closed')}
          </a>
        </div>
        <div className="row-start">
          <span className={`state ${live === 'live' ? 'ok' : 'warn'}`} role="status">
            {live === 'live' ? t('staff.live') : t('staff.reconnecting')}
          </span>
          {chime.enabled ? <span className="state ok">{t('staff.soundOn')}</span> : <button className="btn-secondary btn-sm" onClick={chime.enable}>{t('staff.enableSound')}</button>}
        </div>
      </div>
      <p className="muted" style={{ fontSize: '0.8rem' }}>
        {t('staff.alertNote')}
      </p>
      {alert && (
        <div className="alert-bar" role="alert">
          {alert}
        </div>
      )}
      {stale && (
        <Notice kind="info">
          <span>{t('staff.stale')}</span>{' '}
          <button className="btn-text btn-sm" onClick={() => setStale(false)}>
            {t('app.close')}
          </button>
        </Notice>
      )}
      {error && <ErrorNotice code={error} onRetry={load} />}
      {!items && <Loading />}
      {items && list.length === 0 && <p className="muted mt">{t('staff.emptyQueue')}</p>}
      {scope === 'open' ? (
        <>
          {section('attention', attention)}
          {section('new', newOnes)}
          {section('mine', working)}
          {section('waiting', waiting)}
        </>
      ) : (
        <div className="queue mt">
          {list.map((r) => (
            <TicketCard key={`${r.id}-${r.revision}`} r={r} myDeviceId={deviceId} now={now} isNew={false} onChanged={onChanged} />
          ))}
        </div>
      )}
    </>
  );
}
