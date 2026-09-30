import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { LANGUAGE_NAMES, useI18n } from '../../i18n';
import { ApiError, post } from '../../lib/api';
import { activationCapture, forgetActivationToken } from '../../lib/activation';
import { getSelectedProperty, setSelectedProperty, useQuery } from '../../lib/hooks';
import { useGuest } from '../../lib/guest';
import { useBrand, Wordmark } from '../../lib/theme';
import { parseScanned } from '../../lib/scan';
import QrScanner from '../../components/QrScanner';
import { ErrorNotice, LangSwitch, Loading, Notice, Unreachable } from '../../components/ui';
import { LANGS } from '../../../../shared/src/api';

/** Trilingual on purpose: shown before any language is chosen. */
const CHOOSE_LANGUAGE = 'Choisissez votre langue · Choose your language · Elija su idioma';

function LanguageStep() {
  const { setLang } = useI18n();
  return (
    <>
      <p className="eyebrow center" style={{ marginBottom: 24 }}>
        {CHOOSE_LANGUAGE}
      </p>
      <ul className="lang-choice">
        {LANGS.map((l) => (
          <li key={l}>
            <button type="button" lang={l} onClick={() => setLang(l)}>
              {LANGUAGE_NAMES[l]}
              <span className="eyebrow">{l.toUpperCase()}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Entry point of the guest app. Only validated hotel guests get past this
 * screen: language first, then a private QR (scanned in-app or opened from the
 * phone camera) or the typed validation code, always with the room number.
 */
export default function Gate() {
  const { t, lang, chosen } = useI18n();
  const guest = useGuest();
  const nav = useNavigate();
  const location = useLocation();
  const [captured] = useState(activationCapture);
  const [token, setToken] = useState<string | null>(captured.token);
  const [hint, setHint] = useState<string | null>(captured.propertyId ?? getSelectedProperty());
  const theme = useBrand(hint);
  const prop = useQuery<{ property: { id: string; name: string; activationCheck: 'none' | 'room' | 'name' } }>(hint ? `/api/public/properties/${hint}` : null);
  const check = token ? (prop.data?.property.activationCheck ?? 'room') : 'room';
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [room, setRoom] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (hint) setSelectedProperty(hint);
  }, [hint]);

  if (guest.loading) return <Loading />;
  // A pending private QR is always honoured, even on a device already signed in (it switches stay).
  if (guest.me && !token) return <Navigate to={guest.me.capability === 'order' ? '/h' : '/h/stay'} replace state={location.state} />;
  if (!guest.me && guest.unavailable && !token) return <Unreachable onRetry={() => void guest.refresh()} />;

  const onScan = (text: string) => {
    setScanning(false);
    const s = parseScanned(text);
    if (s.kind === 'token') {
      setToken(s.token);
      if (s.propertyId) setHint(s.propertyId);
      setScanNote(null);
    } else if (s.kind === 'code') {
      setCode(s.code.match(/.{1,4}/g)!.join('-'));
      setScanNote(null);
    } else {
      setScanNote(t('gate.scanNotPrivate'));
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/api/guest/activate', {
        ...(token ? { token } : { code }),
        room: room || undefined,
        name: name || undefined,
        language: lang,
      });
      forgetActivationToken();
      guest.clearRevoked();
      await guest.refresh();
      nav('/h', { replace: true });
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const roomField = (
    <div className="field">
      <label htmlFor="room">{t('gate.room')}</label>
      <input id="room" autoComplete="off" required value={room} onChange={(e) => setRoom(e.target.value)} />
      <div className="help">{t('activate.roomHelp')}</div>
    </div>
  );

  return (
    <div className="gate">
      <header className="gate-head">
        <Wordmark theme={theme} large />
        {chosen && (
          <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
            <LangSwitch />
          </div>
        )}
      </header>
      <main className="gate-body" id="main">
        {guest.revoked && (
          <Notice kind="bad" role="alert">
            <p>{t('stay.revoked')}</p>
            <button type="button" className="btn-text" onClick={guest.clearRevoked}>
              {t('app.close')}
            </button>
          </Notice>
        )}
        {guest.me && token && chosen && <Notice>{t('gate.switchStay', { room: guest.me.roomLabel ?? '—' })}</Notice>}
        {!chosen ? (
          <LanguageStep />
        ) : token ? (
          <form onSubmit={submit}>
            <p className="eyebrow">{t('gate.confirmEyebrow')}</p>
            <h1 style={{ margin: '8px 0 12px' }}>{t('gate.confirmTitle')}</h1>
            <p className="muted">{t('gate.confirmHelp')}</p>
            {check === 'room' && roomField}
            {check === 'name' && (
              <div className="field">
                <label htmlFor="name">{t('activate.name')}</label>
                <input id="name" autoComplete="family-name" required value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            )}
            {error && <ErrorNotice code={error.code} />}
            <button className="btn-primary btn-block" disabled={busy}>
              {busy ? t('gate.validating') : t('gate.submit')}
            </button>
            <button
              type="button"
              className="btn-text mt"
              onClick={() => {
                forgetActivationToken();
                setToken(null);
              }}
            >
              {t('gate.useCodeInstead')}
            </button>
            <p className="muted mt" style={{ fontSize: '0.8rem' }}>
              {t('activate.privacy')}
            </p>
          </form>
        ) : (
          <>
            <p className="eyebrow">{t('gate.eyebrow')}</p>
            <h1 style={{ margin: '8px 0 12px' }}>{t('gate.title')}</h1>
            <p className="muted">{t('gate.intro')}</p>
            <div className="method">
              <section aria-labelledby="scan-h">
                <h2 id="scan-h">{t('gate.scanTitle')}</h2>
                <p className="muted">{t('gate.scanHelp')}</p>
                {scanning ? (
                  <>
                    <QrScanner onResult={onScan} />
                    <button type="button" className="btn-text" onClick={() => setScanning(false)}>
                      {t('gate.scanStop')}
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn-secondary btn-block" onClick={() => setScanning(true)}>
                    {t('gate.scanStart')}
                  </button>
                )}
                {scanNote && <Notice kind="plain">{scanNote}</Notice>}
              </section>
              <section aria-labelledby="code-h">
                <h2 id="code-h">{t('gate.codeTitle')}</h2>
                <p className="muted">{t('gate.codeHelp')}</p>
                <form onSubmit={submit}>
                  <div className="field">
                    <label htmlFor="code">{t('gate.code')}</label>
                    <input
                      id="code"
                      className="code-input"
                      autoComplete="one-time-code"
                      autoCapitalize="characters"
                      spellCheck={false}
                      required
                      placeholder="XXXX-XXXX-XXXX"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                    />
                  </div>
                  {roomField}
                  {error && <ErrorNotice code={error.code} />}
                  <button className="btn-primary btn-block" disabled={busy}>
                    {busy ? t('gate.validating') : t('gate.submit')}
                  </button>
                </form>
              </section>
            </div>
          </>
        )}
      </main>
      <footer className="gate-foot">{t('gate.footer')}</footer>
    </div>
  );
}
