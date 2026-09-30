import { createContext, useContext } from 'react';
import { NavLink, Navigate, Outlet, useLocation, Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useQuery } from '../../lib/hooks';
import { useGuest } from '../../lib/guest';
import { useBrand, Wordmark } from '../../lib/theme';
import { DemoStrip, ErrorNotice, LangSwitch, Loading, OfflineBanner, Unreachable } from '../../components/ui';
import type { GuestNoticeDto, PropertySummary } from '../../../../shared/src/api';

const PropertyCtx = createContext<PropertySummary | null>(null);
export function useProperty(): PropertySummary {
  const p = useContext(PropertyCtx);
  if (!p) throw new Error('no property');
  return p;
}

/** Everything under /h requires a validated stay; otherwise the guest is sent to the gate. */
export default function GuestShell() {
  const { t } = useI18n();
  const guest = useGuest();
  const location = useLocation();
  const ordering = guest.me?.capability === 'order';
  const theme = useBrand(guest.me?.property.id ?? null);
  const q = useQuery<{ property: PropertySummary }>(ordering ? '/api/guest/catalog/property' : null, [guest.me?.property.id]);
  const notices = useQuery<{ notices: GuestNoticeDto[] }>(ordering ? '/api/guest/notices' : null, [guest.version]);
  const unread = notices.data?.notices.filter((n) => !n.readAt).length ?? 0;

  if (guest.loading) return <Loading />;
  if (!guest.me) return guest.unavailable ? <Unreachable onRetry={() => void guest.refresh()} /> : <Navigate to="/" replace />;
  // After checkout only the restricted stay/bill area remains.
  if (!ordering && location.pathname !== '/h/stay') return <Navigate to="/h/stay" replace />;

  const property = q.data?.property;
  const tab = (to: string, label: string, end = false, badge = 0) => (
    <NavLink to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}>
      {label}
      {badge > 0 && (
        <span className="count" aria-label={`(${badge})`}>
          {badge}
        </span>
      )}
    </NavLink>
  );

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        {t('app.skipToContent')}
      </a>
      <header className="masthead">
        <LangSwitch compact />
        <Wordmark theme={theme} href={ordering ? '/h' : '/h/stay'} />
        <Link to="/h/stay" className="btn-text">
          {t('nav.stay')}
        </Link>
      </header>
      <OfflineBanner />
      {property?.hasDemoContent && <DemoStrip />}
      <main id="main">
        {!ordering ? (
          <Outlet />
        ) : q.error ? (
          <ErrorNotice code={q.error.code} onRetry={q.reload} />
        ) : !property ? (
          <Loading />
        ) : (
          <PropertyCtx.Provider value={property}>
            <Outlet />
          </PropertyCtx.Provider>
        )}
      </main>
      {ordering && (
        <nav className="tabbar" aria-label={t('nav.main')}>
          {tab('/h', t('nav.home'), true)}
          {tab('/h/food', t('nav.food'))}
          {tab('/h/services', t('nav.services'))}
          {tab('/h/requests', t('nav.requests'), false, unread)}
        </nav>
      )}
    </div>
  );
}
