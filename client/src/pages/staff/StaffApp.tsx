import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { ApiError, get, post } from '../../lib/api';
import { ErrorNotice, LangSwitch, OfflineBanner, Loading } from '../../components/ui';
import { useBrand, Wordmark } from '../../lib/theme';
import { StaffCtx } from './staffContext';
import type { StaffMeDto } from '../../../../shared/src/api';

function Login({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="panel"
      style={{ maxWidth: 440, margin: '48px auto' }}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await post('/api/staff/login', { username, password });
          onDone();
        } catch (err) {
          setError((err as ApiError).code);
        } finally {
          setBusy(false);
        }
      }}
    >
      <span className="eyebrow">{t('staff.title')}</span>
      <h1 style={{ margin: '6px 0 24px' }}>{t('staff.login')}</h1>
      <div className="field">
        <label htmlFor="u">{t('staff.username')}</label>
        <input id="u" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
      </div>
      <div className="field">
        <label htmlFor="p">{t('staff.password')}</label>
        <input id="p" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      {error && <ErrorNotice code={error} />}
      <button className="btn-primary btn-block" disabled={busy}>
        {t('staff.signIn')}
      </button>
    </form>
  );
}

function DevicePicker({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const [devices, setDevices] = useState<{ id: number; name: string }[] | null>(null);
  useEffect(() => {
    get<{ devices: { id: number; name: string }[] }>('/api/staff/devices').then((r) => setDevices(r.devices));
  }, []);
  return (
    <div className="panel" style={{ maxWidth: 480, margin: '48px auto' }}>
      <h1 style={{ marginBottom: 12 }}>{t('staff.chooseDevice')}</h1>
      <p className="muted">{t('staff.chooseDeviceHelp')}</p>
      {!devices && <Loading />}
      <div className="stack">
        {devices?.map((d) => (
          <button key={d.id} className="btn-secondary btn-block" onClick={() => post('/api/staff/device', { deviceId: d.id }).then(onDone)}>
            {d.name}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Shared shell for the staff companion and admin screens (same session cookie). */
export default function StaffApp({ children, allowAdmin = false }: { children: ReactNode; allowAdmin?: boolean }) {
  const { t, l } = useI18n();
  const [me, setMe] = useState<StaffMeDto | null>(null);
  const [state, setState] = useState<'loading' | 'login' | 'ready'>('loading');

  const reload = useCallback(async () => {
    try {
      const r = await get<{ me: StaffMeDto }>('/api/staff/me');
      setMe(r.me);
      setState('ready');
    } catch {
      setMe(null);
      setState('login');
    }
  }, []);
  useEffect(() => {
    document.body.classList.add('staff-body');
    void reload();
    return () => document.body.classList.remove('staff-body');
  }, [reload]);

  const signOut = useCallback(async () => {
    await post('/api/staff/logout').catch(() => undefined);
    setMe(null);
    setState('login');
  }, []);

  const needsDevice = me && me.account.role !== 'admin' && !me.device;
  const isAdmin = me?.account.role === 'admin';
  const canStays = me?.account.role === 'reception' || isAdmin;

  const theme = useBrand(me?.account.propertyId ?? null);

  return (
    <div className="app">
      <header className="masthead staff-top" style={{ gridTemplateColumns: 'auto 1fr auto', gap: 20 }}>
        <div>
          <Wordmark theme={theme} />
          <div className="eyebrow" style={{ marginTop: 2 }}>
            {me ? `${l(me.account.name)}${me.device ? ` · ${me.device.name}` : ''}` : t('staff.title')}
          </div>
        </div>
        <nav className="row-start staff-nav" aria-label={t('nav.main')} style={{ justifySelf: 'center' }}>
          {me && !needsDevice && !isAdmin && (
            <NavLink to="/staff" end className="btn-text">
              {t('staff.queue')}
            </NavLink>
          )}
          {me && !needsDevice && canStays && (
            <NavLink to="/admin/stays" className="btn-text">
              {t('staff.stays')}
            </NavLink>
          )}
          {me && !needsDevice && isAdmin && (
            <NavLink to="/admin/food" className="btn-text">
              {t('staff.admin')}
            </NavLink>
          )}
        </nav>
        <div className="row-start">
          <LangSwitch />
          {me && (
            <button className="btn-text" onClick={signOut}>
              {t('staff.signOut')}
            </button>
          )}
        </div>
      </header>
      <OfflineBanner />
      <main id="main" className="wide">
        {state === 'loading' && <Loading />}
        {state === 'login' && <Login onDone={reload} />}
        {state === 'ready' && needsDevice && <DevicePicker onDone={reload} />}
        {state === 'ready' && me && !needsDevice && (isAdmin && !allowAdmin ? <ErrorNotice code="department_account_required" /> : <StaffCtx.Provider value={{ me, reload, signOut }}>{children}</StaffCtx.Provider>)}
      </main>
    </div>
  );
}
