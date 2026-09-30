import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useQuery } from '../../lib/hooks';
import { useGuest } from '../../lib/guest';
import { Icons, Notice } from '../../components/ui';
import { useProperty } from './GuestShell';
import type { ContentItem } from '../../../../shared/src/api';

export default function Home() {
  const { t, l, dateTime } = useI18n();
  const property = useProperty();
  const { me } = useGuest();
  const q = useQuery<{ content: ContentItem[] }>(`/api/public/properties/${property.id}/content`);
  const content = q.data?.content ?? [];
  const section = (kind: ContentItem['kind'], title: string) => {
    const items = content.filter((c) => c.kind === kind);
    if (items.length === 0) return null;
    return (
      <section className="card" aria-labelledby={`sec-${kind}`}>
        <h2 id={`sec-${kind}`} style={{ marginTop: 0 }}>
          {title}
        </h2>
        {items.map((c) => (
          <div className="info-item" key={c.id}>
            <h3>{l(c.title)}</h3>
            {c.startsAt && <div className="muted">{dateTime(c.startsAt)}</div>}
            {l(c.body) && <p>{l(c.body)}</p>}
          </div>
        ))}
      </section>
    );
  };

  return (
    <>
      <div className="hero">
        <h1>{t('home.greeting', { hotel: property.name })}</h1>
        <p>{l(property.cityLabel)}</p>
      </div>
      {!property.requestsEnabled && <Notice kind="info">{t('home.notAccepting')}</Notice>}
      <div className="cta-grid">
        <Link to="/h/food" className="cta">
          {Icons.food}
          <strong>{t('home.foodCta')}</strong>
          <span>{t('home.foodCtaSub')}</span>
        </Link>
        <Link to="/h/services" className="cta">
          {Icons.services}
          <strong>{t('home.servicesCta')}</strong>
          <span>{t('home.servicesCtaSub')}</span>
        </Link>
      </div>
      {property.requestsEnabled && !me && (
        <Notice kind="info">
          <p>{t('home.activatePrompt')}</p>
          <Link to="/activate" className="btn btn-secondary btn-sm">
            {t('home.activateCta')}
          </Link>
        </Notice>
      )}
      {section('info', t('home.information'))}
      {section('hours', t('home.hours'))}
      {section('event', t('home.events'))}
      {section('contact', t('home.contacts'))}
      {q.data && content.length === 0 && <p className="muted">{t('home.noContent')}</p>}
      <p className="center">
        <Link to="/">{t('home.changeHotel')}</Link>
      </p>
    </>
  );
}
