import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { ApiError, get, post } from '../../lib/api';
import { ErrorNotice, LangSwitch, OfflineBanner, Spinner } from '../../components/ui';
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
      className="card"
      style={{ maxWidth: 420, margin: '2rem auto' }}
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
      <h1>{t('staff.login')}</h1>
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
    <div className="card" style={{ maxWidth: 480, margin: '2rem auto' }}>
      <h1>{t('staff.chooseDevice')}</h1>
      <p className="muted">{t('staff.chooseDeviceHelp')}</p>
      {!devices && <Spinner />}
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

  return (
    <div className="app">
      <header className="topbar staff-top">
        <span className="brand">
          {me ? `${l(me.account.name)}${me.device ? ` · ${me.device.name}` : ''}` : t('staff.title')}
          <small>{me?.account.propertyName ?? t('staff.title')}</small>
        </span>
        <div className="row-start">
          {me && !needsDevice && (
            <nav className="row-start" aria-label={t('nav.main')}>
              {!isAdmin && (
                <NavLink to="/staff" end className="btn btn-ghost btn-sm">
                  {t('staff.queue')}
                </NavLink>
              )}
              {canStays && (
                <NavLink to="/admin/stays" className="btn btn-ghost btn-sm">
                  {t('staff.stays')}
                </NavLink>
              )}
              {isAdmin && (
                <NavLink to="/admin/food" className="btn btn-ghost btn-sm">
                  {t('staff.admin')}
                </NavLink>
              )}
            </nav>
          )}
          <LangSwitch />
          {me && (
            <button className="btn-ghost btn-sm" onClick={signOut}>
              {t('staff.signOut')}
            </button>
          )}
        </div>
      </header>
      <OfflineBanner />
      <main id="main" className="wide">
        {state === 'loading' && <Spinner />}
        {state === 'login' && <Login onDone={reload} />}
        {state === 'ready' && needsDevice && <DevicePicker onDone={reload} />}
        {state === 'ready' && me && !needsDevice && (isAdmin && !allowAdmin ? <ErrorNotice code="department_account_required" /> : <StaffCtx.Provider value={{ me, reload, signOut }}>{children}</StaffCtx.Provider>)}
      </main>
    </div>
  );
}
