import { useState } from 'react';
import { useI18n } from '../../i18n';
import { ApiError, post } from '../../lib/api';
import { ErrorNotice, Sheet } from '../../components/ui';
import type { StaffRequestDto } from '../../../../shared/src/api';

type Prompt = { kind: 'takeover' | 'reject' | 'cancel' | 'amend' | 'resolve' } | null;

function ageLabel(t: (k: string, p?: Record<string, string | number>) => string, iso: string, now: number) {
  const min = Math.floor((now - Date.parse(iso)) / 60_000);
  return min < 1 ? t('staff.justNow') : t('staff.age', { min });
}

export default function TicketCard({
  r,
  myDeviceId,
  now,
  isNew,
  onChanged,
}: {
  r: StaffRequestDto;
  myDeviceId: number;
  now: number;
  isNew: boolean;
  onChanged: (updated: StaffRequestDto | null, staleCode?: string) => void;
}) {
  const { t, l, money, time } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [text, setText] = useState('');
  const [text2, setText2] = useState('');
  const [useCurrentRoom, setUseCurrentRoom] = useState(true);
  const [posRef, setPosRef] = useState(r.pos.reference ?? '');

  const mine = r.owner?.deviceId === myDeviceId;
  const pool = r.currentDestination.kind === 'pool';
  const dest = l(r.currentDestination.label);

  const act = async (path: string, body: Record<string, unknown> = {}) => {
    setBusy(true);
    setError(null);
    try {
      const res = await post<{ request: StaffRequestDto }>(`/api/staff/requests/${r.id}/${path}`, { expectedRevision: r.revision, ...body });
      setPrompt(null);
      setText('');
      setText2('');
      onChanged(res.request);
    } catch (e) {
      const err = e as ApiError;
      // Another tablet changed the ticket: reload it rather than overwrite.
      if (['stale_revision', 'already_claimed', 'not_owner'].includes(err.code)) onChanged(null, err.code);
      setError(err.code);
    } finally {
      setBusy(false);
    }
  };

  const cls = ['ticket', r.attention.flag ? 'attention' : mine ? 'mine' : isNew ? 'new' : ''].join(' ');
  const closed = ['completed', 'rejected', 'cancelled'].includes(r.state);

  return (
    <article className={cls} aria-labelledby={`t-${r.id}`}>
      <div className="row">
        <span className="meta">
          <strong id={`t-${r.id}`}>{r.ref}</strong> · {ageLabel(t, r.createdAt, now)} · {time(r.createdAt)}
        </span>
        <span className="state">{t(`staff.state_${r.state}`)}</span>
      </div>
      <div className="dest">{dest}</div>
      {JSON.stringify(r.originalDestination) !== JSON.stringify(r.currentDestination) && (
        <div className="meta">{t('staff.original', { dest: l(r.originalDestination.label) })}</div>
      )}
      <div className="meta">
        {r.guestName}
        {r.stayStatus === 'checked_out' && <span className="state bad"> {t('staff.stayCheckedOut')}</span>}
      </div>

      {r.attention.flag && (
        <div className="note bad" role="alert">
          {t(`staff.attention_${r.attention.flag}`, { detail: r.attention.detail ?? '' })}
          <div className="btn-row mt">
            <button className="btn-secondary btn-sm" disabled={busy || (!!r.owner && !mine)} onClick={() => setPrompt({ kind: 'resolve' })}>
              {t('staff.resolve')}
            </button>
          </div>
        </div>
      )}

      <ul className="lines">
        {r.lines.map((x, i) => (
          <li key={i}>
            <div>
              <strong>{x.quantity} ×</strong> {l(x.name)}
              {x.options.length > 0 && <div className="opt">{x.options.map((o) => l(o.name)).join(', ')}</div>}
              {x.details && <div className="opt">“{x.details}”</div>}
            </div>
            <div>{x.complimentary ? t('staff.complimentary') : money(x.lineTotalMinor, r.currency)}</div>
          </li>
        ))}
      </ul>
      {(r.type === 'food' || r.totalMinor > 0) && (
        <div className="total-row">
          <span>{t('staff.total')}</span>
          <span>{money(r.totalMinor, r.currency)}</span>
        </div>
      )}
      {r.notes && (
        <p className="mt mb0">
          <strong>{t('staff.notes')}:</strong> {r.notes}
        </p>
      )}

      <div className="row-start mt">
        {r.owner ? (
          <span className={`state ${mine ? 'ok' : 'warn'}`}>{t('staff.takenBy', { device: mine ? `${r.owner.name} (${t('staff.you')})` : r.owner.name })}</span>
        ) : null}
        {r.type === 'food' && r.confirmation.result === 'confirmed' && (
          <span className={`state ${r.pos.status === 'entered' ? 'ok' : r.pos.status === 'uncertain' ? 'bad' : 'warn'}`}>
            {t(`staff.posStatus_${r.pos.status}`)}
            {r.pos.reference ? ` · ${r.pos.reference}` : ''}
          </span>
        )}
        {r.housekeepingContactedAt && <span className="state ok">{t('staff.housekeepingDone', { time: time(r.housekeepingContactedAt) })}</span>}
      </div>

      {error && <ErrorNotice code={error} />}

      {!closed && (
        <div className="actions">
          {!r.owner && r.state !== 'confirmation_not_received' && (
            <button className="btn-primary" disabled={busy} onClick={() => act('claim')}>
              {t('staff.take')}
            </button>
          )}
          {r.owner && !mine && (
            <button className="btn-secondary" disabled={busy} onClick={() => setPrompt({ kind: 'takeover' })}>
              {t('staff.takeover')}
            </button>
          )}

          {mine && r.state === 'confirming' && (
            <>
              <p className="meta" style={{ width: '100%', margin: 0 }}>
                {pool ? t('staff.goToPool', { location: dest }) : t('staff.callRoom', { room: r.roomLabel ?? dest })}
              </p>
              <button className="btn-primary" disabled={busy || !!r.attention.flag} onClick={() => act('confirmation', { outcome: 'confirmed', method: pool ? 'in_person' : 'room_call' })}>
                {pool ? t('staff.confirmedInPerson') : t('staff.confirmedCall')}
              </button>
              <button className="btn-danger" disabled={busy} title={t('staff.notReceivedHelp')} onClick={() => act('confirmation', { outcome: 'not_received', method: pool ? 'in_person' : 'room_call' })}>
                {t('staff.notReceived')}
              </button>
              <button className="btn-secondary btn-sm" disabled={busy} onClick={() => setPrompt({ kind: 'amend' })}>
                {t('staff.amend')}
              </button>
            </>
          )}

          {mine && r.type === 'food' && ['confirmed', 'in_progress'].includes(r.state) && (
            <fieldset style={{ width: '100%' }}>
              <legend>{t('staff.posTitle')}</legend>
              <p className="meta">{t('staff.posWarning')}</p>
              <div className="row-start">
                <input aria-label={t('staff.posReference')} placeholder={t('staff.posReference')} value={posRef} onChange={(e) => setPosRef(e.target.value)} style={{ maxWidth: 200 }} />
                <button className="btn-secondary btn-sm" disabled={busy} onClick={() => act('pos', { status: 'entered', reference: posRef || null })}>
                  {t('staff.posEntered')}
                </button>
                <button className="btn-secondary btn-sm" disabled={busy} onClick={() => act('pos', { status: 'uncertain', reference: posRef || null })}>
                  {t('staff.posUncertain')}
                </button>
              </div>
            </fieldset>
          )}
          {mine && r.state === 'confirmed' && (
            <>
              <button className="btn-primary" disabled={busy || !!r.attention.flag} onClick={() => act('status', { to: 'in_progress' })}>
                {t('staff.startPreparing')}
              </button>
              <button className="btn-secondary btn-sm" disabled={busy} onClick={() => setPrompt({ kind: 'amend' })}>
                {t('staff.amend')}
              </button>
            </>
          )}
          {mine && r.state === 'in_progress' && (
            <button className="btn-primary" disabled={busy || !!r.attention.flag} onClick={() => act('status', { to: 'completed' })}>
              {t('staff.complete')}
            </button>
          )}

          {mine && r.state === 'being_handled' && (
            <>
              {!r.housekeepingContactedAt && (
                <button className="btn-secondary" disabled={busy} onClick={() => act('housekeeping')}>
                  {t('staff.housekeeping')}
                </button>
              )}
              <button className="btn-primary" disabled={busy || !!r.attention.flag} onClick={() => act('status', { to: 'completed' })}>
                {t('staff.completeService')}
              </button>
            </>
          )}

          {r.state === 'confirmation_not_received' && <p className="meta" style={{ width: '100%', margin: 0 }}>{t('staff.waitingGuest')}</p>}

          {(mine || (r.state === 'confirmation_not_received' && !r.owner)) && (
            <>
              {['confirming', 'being_handled'].includes(r.state) && (
                <button className="btn-danger btn-sm" disabled={busy} onClick={() => setPrompt({ kind: 'reject' })}>
                  {t('staff.reject')}
                </button>
              )}
              <button className="btn-danger btn-sm" disabled={busy} onClick={() => setPrompt({ kind: 'cancel' })}>
                {t('staff.cancelRequest')}
              </button>
            </>
          )}
        </div>
      )}
      {closed && r.closeReason && <p className="meta mt">{r.closeReason}</p>}

      <details>
        <summary>{t('staff.history')}</summary>
        <ul className="events">
          {r.attempts.map((a) => (
            <li key={`a${a.attemptNo}`}>
              {t('staff.attempt', { n: a.attemptNo })}: {a.status} {a.method ? `(${a.method})` : ''} · {time(a.createdAt)}
            </li>
          ))}
          {r.notices.map((n) => (
            <li key={`n${n.id}`}>
              {t('staff.guestNotice', { time: time(n.createdAt) })} — {n.readAt ? t('staff.noticeRead') : t('staff.noticeUnread')}
              {n.push ? ` — ${t(`staff.push_${n.push.split(':')[0]}`)}` : ''}
            </li>
          ))}
          {r.events.map((e) => (
            <li key={e.id}>
              {time(e.createdAt)} · {e.actorLabel} · {e.type}
              {typeof e.data.reason === 'string' ? ` — ${e.data.reason}` : ''}
              {typeof e.data.note === 'string' ? ` — ${e.data.note}` : ''}
            </li>
          ))}
        </ul>
      </details>

      <Sheet
        open={!!prompt}
        onClose={() => setPrompt(null)}
        title={
          prompt?.kind === 'takeover'
            ? t('staff.takeover')
            : prompt?.kind === 'reject'
              ? t('staff.reject')
              : prompt?.kind === 'cancel'
                ? t('staff.cancelRequest')
                : prompt?.kind === 'amend'
                  ? t('staff.amend')
                  : t('staff.resolve')
        }
        footer={
          <button
            className="btn-primary btn-block"
            disabled={busy || text.trim().length < 3 || (prompt?.kind === 'cancel' && r.pos.status !== 'not_entered' && text2.trim().length < 3)}
            onClick={() => {
              if (!prompt) return;
              if (prompt.kind === 'takeover') void act('takeover', { reason: text });
              if (prompt.kind === 'reject') void act('close', { outcome: 'rejected', reason: text });
              if (prompt.kind === 'cancel') void act('close', { outcome: 'cancelled', reason: text, posDecision: text2 || null });
              if (prompt.kind === 'amend') void act('amendment', { note: text, newTotalMinor: text2 ? Math.round(Number(text2.replace(',', '.')) * 100) : undefined });
              if (prompt.kind === 'resolve') void act('resolve-attention', { note: text, useCurrentRoom: r.attention.flag === 'room_moved' && r.stayStatus === 'active' ? useCurrentRoom : false });
            }}
          >
            {t('app.confirm')}
          </button>
        }
      >
        {prompt?.kind === 'takeover' && <p>{t('staff.takeoverPrompt', { device: r.owner?.name ?? '' })}</p>}
        <div className="field">
          <label htmlFor={`p-${r.id}`}>
            {prompt?.kind === 'takeover' ? t('staff.takeoverReason') : prompt?.kind === 'amend' ? t('staff.amendNote') : prompt?.kind === 'resolve' ? t('staff.resolveNote') : t('staff.reason')}
          </label>
          <textarea id={`p-${r.id}`} value={text} onChange={(e) => setText(e.target.value)} maxLength={300} />
        </div>
        {prompt?.kind === 'amend' && (
          <div className="field">
            <label htmlFor={`p2-${r.id}`}>{t('staff.newTotal')}</label>
            <input id={`p2-${r.id}`} inputMode="decimal" value={text2} onChange={(e) => setText2(e.target.value)} />
          </div>
        )}
        {prompt?.kind === 'cancel' && r.pos.status !== 'not_entered' && (
          <div className="field">
            <label htmlFor={`p3-${r.id}`}>{t('staff.posDecision')}</label>
            <textarea id={`p3-${r.id}`} value={text2} onChange={(e) => setText2(e.target.value)} maxLength={300} />
          </div>
        )}
        {prompt?.kind === 'resolve' && r.attention.flag === 'room_moved' && r.stayStatus === 'active' && (
          <label className="check">
            <input type="checkbox" checked={useCurrentRoom} onChange={(e) => setUseCurrentRoom(e.target.checked)} />
            {t('staff.useCurrentRoom')}
          </label>
        )}
        {error && <ErrorNotice code={error} />}
      </Sheet>
    </article>
  );
}
