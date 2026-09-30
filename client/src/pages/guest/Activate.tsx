import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { ApiError, post } from '../../lib/api';
import { setSelectedProperty, useQuery } from '../../lib/hooks';
import { useGuest } from '../../lib/guest';
import { ErrorNotice, LangSwitch, Notice } from '../../components/ui';
import { activationCapture, forgetActivationToken } from '../../lib/activation';
import type { PropertySummary } from '../../../../shared/src/api';

export default function Activate() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const guest = useGuest();
  const [{ token, propertyId }] = useState(activationCapture);
  const prop = useQuery<{ property: PropertySummary & { activationCheck: 'none' | 'room' | 'name' } }>(propertyId ? `/api/public/properties/${propertyId}` : null);
  const check = prop.data?.property.activationCheck ?? 'room';
  const [room, setRoom] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (propertyId) setSelectedProperty(propertyId);
  }, [propertyId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await post('/api/guest/activate', { token, room: room || undefined, name: name || undefined, language: lang });
      setDone(true);
      guest.clearRevoked();
      await guest.refresh();
      forgetActivationToken(); // dropped from memory once exchanged
      setTimeout(() => nav('/h', { replace: true }), 900);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">{prop.data?.property.name ?? t('app.name')}</span>
        <LangSwitch />
      </header>
      <main id="main">
        <h1>{t('activate.title')}</h1>
        {done ? (
          <Notice kind="ok" role="status">
            {t('activate.success')}
          </Notice>
        ) : token ? (
          <form onSubmit={submit} className="card">
            <p>{t('activate.haveCode')}</p>
            {check === 'room' && (
              <div className="field">
                <label htmlFor="room">{t('activate.room')}</label>
                <input id="room" autoComplete="off" inputMode="text" required value={room} onChange={(e) => setRoom(e.target.value)} />
                <div className="help">{t('activate.roomHelp')}</div>
              </div>
            )}
            {check === 'name' && (
              <div className="field">
                <label htmlFor="name">{t('activate.name')}</label>
                <input id="name" autoComplete="family-name" required value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            )}
            {error && <ErrorNotice code={error.code} />}
            <button className="btn-primary btn-block" disabled={busy}>
              {busy ? t('activate.activating') : t('activate.submit')}
            </button>
            <p className="muted mt mb0" style={{ fontSize: '0.8rem' }}>
              {t('activate.privacy')}
            </p>
          </form>
        ) : (
          <>
            <p>{t('activate.intro')}</p>
            <Notice kind="info">{t('activate.notPublic')}</Notice>
            {propertyId && <Notice kind="warn">{t('activate.noCode')}</Notice>}
          </>
        )}
        <p className="center mt">
          <Link to="/h">← {t('nav.home')}</Link>
        </p>
      </main>
    </div>
  );
}
