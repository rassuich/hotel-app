import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useQuery } from '../../lib/hooks';
import { useGuest } from '../../lib/guest';
import { Notice } from '../../components/ui';
import { useProperty } from './GuestShell';
import type { ContentItem } from '../../../../shared/src/api';

export default function Home() {
  const { t, l, dateTime } = useI18n();
  const property = useProperty();
  const { me } = useGuest();
  const q = useQuery<{ content: ContentItem[] }>('/api/guest/catalog/content');
  const content = q.data?.content ?? [];

  const section = (kind: ContentItem['kind'], title: string) => {
    const items = content.filter((c) => c.kind === kind);
    if (items.length === 0) return null;
    return (
      <section className="section" aria-labelledby={`sec-${kind}`}>
        <h2 id={`sec-${kind}`} className="eyebrow">
          {title}
        </h2>
        <dl style={{ margin: 0 }}>
          {items.map((c) => (
            <div key={c.id} style={{ padding: '10px 0' }}>
              <dt>
                <h3>{l(c.title)}</h3>
              </dt>
              <dd style={{ margin: '4px 0 0', color: 'var(--muted)', whiteSpace: 'pre-line' }}>
                {c.startsAt && <span className="num">{dateTime(c.startsAt)} — </span>}
                {l(c.body)}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    );
  };

  return (
    <>
      <div className="page-head">
        <span className="eyebrow">
          {l(property.cityLabel)}
          {me?.roomLabel ? ` · ${t('cart.roomLabel', { room: me.roomLabel })}` : ''}
        </span>
        <h1>{t('home.greeting', { hotel: property.name })}</h1>
      </div>
      {!property.requestsEnabled && (
        <div className="pad">
          <Notice>{t('home.notAccepting')}</Notice>
        </div>
      )}
      <ul className="list" style={{ borderTop: 0 }}>
        <li>
          <Link to="/h/food" className="row-link">
            <span className="title">{t('home.foodCta')}</span>
            <span className="aside arrow" aria-hidden="true" />
            <span className="sub">{t('home.foodCtaSub')}</span>
          </Link>
        </li>
        <li>
          <Link to="/h/services" className="row-link">
            <span className="title">{t('home.servicesCta')}</span>
            <span className="aside arrow" aria-hidden="true" />
            <span className="sub">{t('home.servicesCtaSub')}</span>
          </Link>
        </li>
      </ul>
      {section('info', t('home.information'))}
      {section('hours', t('home.hours'))}
      {section('event', t('home.events'))}
      {section('contact', t('home.contacts'))}
      {q.data && content.length === 0 && <p className="section muted">{t('home.noContent')}</p>}
    </>
  );
}
