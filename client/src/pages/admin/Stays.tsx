import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useI18n } from '../../i18n';
import { ApiError, patch, post } from '../../lib/api';
import { useQuery } from '../../lib/hooks';
import { ErrorNotice, Notice, Sheet, Spinner } from '../../components/ui';

interface StayRow {
  id: string;
  guestName: string;
  occupants: number;
  status: 'active' | 'checked_out';
  roomId: number | null;
  roomLabel: string | null;
  scheduledDeparture: string | null;
  overdue: boolean;
  checkedOutAt: string | null;
  activeSessions: number;
  activeQr: boolean;
  openRequests: number;
  attentionRequests: number;
  isDemo: boolean;
}
interface Room {
  id: number;
  label: string;
  active: number;
  occupied: number;
}
interface PmsStatus {
  adapter: string;
  liveChecks: boolean;
  lastChangeAt: string | null;
}

function QrSheet({ qr, onClose }: { qr: { url: string; room: string } | null; onClose: () => void }) {
  const { t } = useI18n();
  const [img, setImg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setImg(null);
    setCopied(false);
    if (qr) void QRCode.toDataURL(qr.url, { margin: 1, width: 520, errorCorrectionLevel: 'M' }).then(setImg);
  }, [qr]);
  return (
    <Sheet
      open={!!qr}
      onClose={onClose}
      title={t('admin.qrTitle', { room: qr?.room ?? '' })}
      footer={
        <div className="btn-row no-print" style={{ width: '100%' }}>
          <button className="btn-primary" onClick={() => window.print()}>
            {t('admin.print')}
          </button>
          <button className="btn-secondary" onClick={() => navigator.clipboard?.writeText(qr!.url).then(() => setCopied(true))}>
            {copied ? t('admin.copied') : t('admin.copyLink')}
          </button>
        </div>
      }
    >
      <div className="qr-box">
        {img ? <img src={img} alt={t('admin.qrTitle', { room: qr?.room ?? '' })} /> : <Spinner />}
        <Notice kind="warn">{t('admin.qrWarning')}</Notice>
        <div className="qr-url no-print">{qr?.url}</div>
      </div>
    </Sheet>
  );
}

export default function Stays() {
  const { t, dateTime } = useI18n();
  const [filter, setFilter] = useState<'active' | 'overdue' | 'checked_out'>('active');
  const [version, setVersion] = useState(0);
  const stays = useQuery<{ stays: StayRow[]; pms: PmsStatus }>(`/api/admin/stays?filter=${filter}`, [version]);
  const overdue = useQuery<{ stays: StayRow[] }>('/api/admin/stays?filter=overdue', [version]);
  const rooms = useQuery<{ rooms: Room[] }>('/api/admin/rooms', [version]);
  const [qr, setQr] = useState<{ url: string; room: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ guestName: '', roomId: '', occupants: '1', departure: '' });
  const [moving, setMoving] = useState<StayRow | null>(null);
  const [moveTo, setMoveTo] = useState('');
  const [editing, setEditing] = useState<StayRow | null>(null);
  const [departure, setDeparture] = useState('');

  const freeRooms = (rooms.data?.rooms ?? []).filter((r) => r.active && !r.occupied);
  const refresh = () => setVersion((v) => v + 1);
  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
      refresh();
    } catch (e) {
      setError((e as ApiError).code);
    }
  };

  const pms = stays.data?.pms;
  return (
    <>
      <h1>{t('admin.stays')}</h1>
      {pms && !pms.liveChecks && (
        <Notice kind="info">
          <p className="mb0">{t('admin.pmsManual')}</p>
          {pms.lastChangeAt && <small>{t('admin.pmsLastChange', { time: dateTime(pms.lastChangeAt) })}</small>}
        </Notice>
      )}
      {(overdue.data?.stays.length ?? 0) > 0 && <Notice kind="warn">{t('admin.overdue', { count: overdue.data!.stays.length })}</Notice>}
      {error && <ErrorNotice code={error} />}

      <details className="card" open={filter === 'active'}>
        <summary style={{ cursor: 'pointer', fontWeight: 600, minHeight: 40 }}>{t('admin.checkIn')}</summary>
        <form
          className="form-grid mt"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const r = await post<{ qr: { url: string } }>('/api/admin/stays', {
                guestName: form.guestName,
                roomId: Number(form.roomId),
                occupants: Number(form.occupants),
                scheduledDeparture: form.departure ? new Date(form.departure).toISOString() : null,
              });
              setQr({ url: r.qr.url, room: freeRooms.find((x) => x.id === Number(form.roomId))?.label ?? '' });
              setForm({ guestName: '', roomId: '', occupants: '1', departure: '' });
            });
          }}
        >
          <div className="field">
            <label htmlFor="gn">{t('admin.guestName')}</label>
            <input id="gn" required value={form.guestName} onChange={(e) => setForm({ ...form, guestName: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="rm">{t('admin.room')}</label>
            <select id="rm" required value={form.roomId} onChange={(e) => setForm({ ...form, roomId: e.target.value })}>
              <option value="">{t('admin.freeRooms')}</option>
              {freeRooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="oc">{t('admin.occupants')}</label>
            <input id="oc" inputMode="numeric" value={form.occupants} onChange={(e) => setForm({ ...form, occupants: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="dp">{t('admin.departure')}</label>
            <input id="dp" type="datetime-local" value={form.departure} onChange={(e) => setForm({ ...form, departure: e.target.value })} />
          </div>
          <button className="btn-primary">{t('admin.create')}</button>
        </form>
      </details>

      <div className="tabs">
        {(['active', 'overdue', 'checked_out'] as const).map((f) => (
          <a key={f} href="#" className={filter === f ? 'active' : ''} onClick={(e) => (e.preventDefault(), setFilter(f))}>
            {t(`admin.filter_${f}`)}
          </a>
        ))}
      </div>
      {stays.loading && !stays.data && <Spinner />}
      {stays.data?.stays.length === 0 && <p className="muted">{t('admin.noStays')}</p>}
      {stays.data?.stays.map((s) => (
        <div className="card" key={s.id}>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <div>
              <h3>
                {s.roomLabel ?? '—'} · {s.guestName} {s.isDemo && <span className="pill pill-warn">{t('admin.demo')}</span>}
              </h3>
              <div className="row-start">
                <span className="pill pill-muted">
                  {t('admin.occupants')}: {s.occupants}
                </span>
                {s.scheduledDeparture && (
                  <span className={`pill ${s.overdue ? 'pill-bad' : 'pill-muted'}`}>
                    {t('admin.departure')}: {dateTime(s.scheduledDeparture)} {s.overdue ? `· ${t('admin.overdueBadge')}` : ''}
                  </span>
                )}
                {s.status === 'active' && <span className={`pill ${s.activeQr ? 'pill-ok' : 'pill-muted'}`}>{s.activeQr ? t('admin.qrActive') : t('admin.qrNone')}</span>}
                <span className="pill pill-info">{t('admin.devicesSignedIn', { count: s.activeSessions })}</span>
                {s.openRequests > 0 && <span className="pill pill-info">{t('admin.openRequests', { count: s.openRequests })}</span>}
                {s.attentionRequests > 0 && <span className="pill pill-bad">{t('admin.attention', { count: s.attentionRequests })}</span>}
                {s.checkedOutAt && <span className="pill pill-muted">{t('staff.stayCheckedOut')} {dateTime(s.checkedOutAt)}</span>}
              </div>
            </div>
            {s.status === 'active' && (
              <div className="btn-row">
                <button
                  className="btn-secondary btn-sm"
                  onClick={() =>
                    run(async () => {
                      const r = await post<{ qr: { url: string } }>(`/api/admin/stays/${s.id}/rotate-qr`, { reason: 'reprint' });
                      setQr({ url: r.qr.url, room: s.roomLabel ?? '' });
                    })
                  }
                >
                  {t('admin.showQr')}
                </button>
                <button
                  className="btn-secondary btn-sm"
                  title={t('admin.occupantChangeHelp')}
                  onClick={() =>
                    run(async () => {
                      const r = await post<{ qr: { url: string } }>(`/api/admin/stays/${s.id}/rotate-qr`, { reason: 'occupant_change' });
                      setQr({ url: r.qr.url, room: s.roomLabel ?? '' });
                    })
                  }
                >
                  {t('admin.occupantChange')}
                </button>
                <button className="btn-secondary btn-sm" onClick={() => (setMoving(s), setMoveTo(''))}>
                  {t('admin.move')}
                </button>
                <button className="btn-secondary btn-sm" onClick={() => (setEditing(s), setDeparture(s.scheduledDeparture?.slice(0, 16) ?? ''))}>
                  {t('admin.editDeparture')}
                </button>
                <button
                  className="btn-danger btn-sm"
                  onClick={() => {
                    if (window.confirm(t('admin.checkoutConfirm', { name: s.guestName }))) void run(() => post(`/api/admin/stays/${s.id}/checkout`));
                  }}
                >
                  {t('admin.checkout')}
                </button>
              </div>
            )}
          </div>
        </div>
      ))}

      <Sheet
        open={!!moving}
        onClose={() => setMoving(null)}
        title={`${t('admin.move')} — ${moving?.guestName ?? ''}`}
        footer={
          <button
            className="btn-primary btn-block"
            disabled={!moveTo}
            onClick={() =>
              run(async () => {
                const r = await post<{ qr: { url: string } }>(`/api/admin/stays/${moving!.id}/move`, { roomId: Number(moveTo) });
                const label = freeRooms.find((x) => x.id === Number(moveTo))?.label ?? '';
                setMoving(null);
                setQr({ url: r.qr.url, room: label });
              })
            }
          >
            {t('app.confirm')}
          </button>
        }
      >
        <p className="muted">{t('admin.moveHelp')}</p>
        <select aria-label={t('admin.room')} value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
          <option value="">{t('admin.freeRooms')}</option>
          {freeRooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </Sheet>

      <Sheet
        open={!!editing}
        onClose={() => setEditing(null)}
        title={t('admin.editDeparture')}
        footer={
          <button
            className="btn-primary btn-block"
            onClick={() =>
              run(async () => {
                await patch(`/api/admin/stays/${editing!.id}`, { scheduledDeparture: departure ? new Date(departure).toISOString() : null });
                setEditing(null);
              })
            }
          >
            {t('app.save')}
          </button>
        }
      >
        <label htmlFor="dep2">{t('admin.departure')}</label>
        <input id="dep2" type="datetime-local" value={departure} onChange={(e) => setDeparture(e.target.value)} />
      </Sheet>

      <QrSheet qr={qr} onClose={() => setQr(null)} />
    </>
  );
}
