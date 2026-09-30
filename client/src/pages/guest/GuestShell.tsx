import { createContext, useContext, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { getSelectedProperty, useQuery } from '../../lib/hooks';
import { useGuest } from '../../lib/guest';
import { ErrorNotice, Icons, LangSwitch, Notice, OfflineBanner, Spinner } from '../../components/ui';
import type { GuestNoticeDto, PropertySummary } from '../../../../shared/src/api';

const PropertyCtx = createContext<PropertySummary | null>(null);
export function useProperty(): PropertySummary {
  const p = useContext(PropertyCtx);
  if (!p) throw new Error('no property');
  return p;
}

export default function GuestShell() {
  const { t } = useI18n();
  const guest = useGuest();
  const selected = getSelectedProperty();
  // Once activated, the stay's property wins over any locally selected hotel.
  const propertyId = guest.me?.property.id ?? selected;
  const q = useQuery<{ property: PropertySummary }>(propertyId ? `/api/public/properties/${propertyId}` : null);
  const notices = useQuery<{ notices: GuestNoticeDto[] }>(guest.me?.capability === 'order' ? '/api/guest/notices' : null, [guest.version]);
  const unread = notices.data?.notices.filter((n) => !n.readAt).length ?? 0;

  if (!propertyId && !guest.loading) return <Navigate to="/" replace />;
  if (q.error?.status === 404) return <Navigate to="/" replace />;

  const property = q.data?.property;
  const tab = (to: string, label: string, ic: ReactNode, end = false, badge = 0) => (
    <NavLink to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}>
      {ic}
      <span>{label}</span>
      {badge > 0 && (
        <span className="badge-dot" aria-label={String(badge)}>
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
      <header className="topbar">
        <Link to="/h" className="brand">
          {property?.name ?? '…'}
          <small>{t('app.name')}</small>
        </Link>
        <LangSwitch />
      </header>
      <OfflineBanner />
      <main id="main">
        {guest.revoked && (
          <Notice kind="warn" role="alert">
            <p className="mb0">{t('stay.revoked')}</p>
            <button className="btn-secondary btn-sm mt" onClick={guest.clearRevoked}>
              {t('app.close')}
            </button>
          </Notice>
        )}
        {property?.hasDemoContent && <Notice kind="demo">{t('app.demoBanner')}</Notice>}
        {q.loading && !property && <Spinner />}
        {q.error && <ErrorNotice code={q.error.code} onRetry={q.reload} />}
        {property && (
          <PropertyCtx.Provider value={property}>
            <Outlet />
          </PropertyCtx.Provider>
        )}
      </main>
      <nav className="bottomnav" aria-label={t('nav.main')}>
        {tab('/h', t('nav.home'), Icons.home, true)}
        {tab('/h/food', t('nav.food'), Icons.food)}
        {tab('/h/services', t('nav.services'), Icons.services)}
        {tab('/h/requests', t('nav.requests'), Icons.requests, false, unread)}
        {tab('/h/stay', t('nav.stay'), Icons.stay)}
      </nav>
    </div>
  );
}
