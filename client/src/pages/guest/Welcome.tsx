import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useQuery, setSelectedProperty } from '../../lib/hooks';
import { ErrorNotice, Icons, LangSwitch, Notice, Spinner } from '../../components/ui';
import type { PropertySummary } from '../../../../shared/src/api';

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Suggest the city whose hotels are nearest (within ~150 km); location stays on the device. */
export function nearestCity(props: PropertySummary[], pos: { lat: number; lng: number }): PropertySummary['city'] | null {
  let best: { city: PropertySummary['city']; d: number } | null = null;
  for (const p of props) {
    if (!p.approxLocation) continue;
    const d = distanceKm(pos, p.approxLocation);
    if (!best || d < best.d) best = { city: p.city, d };
  }
  return best && best.d < 150 ? best.city : null;
}

export default function Welcome() {
  const { t, l, lang, setLang } = useI18n();
  const nav = useNavigate();
  const q = useQuery<{ properties: PropertySummary[] }>('/api/public/properties');
  const [locating, setLocating] = useState(false);
  const [city, setCity] = useState<PropertySummary['city'] | null>(null);
  const [denied, setDenied] = useState(false);

  const choose = (id: string) => {
    setSelectedProperty(id);
    nav('/h');
  };

  const findMe = () => {
    setDenied(false);
    if (!('geolocation' in navigator) || !q.data) {
      setDenied(true);
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const c = nearestCity(q.data!.properties, { lat: pos.coords.latitude, lng: pos.coords.longitude });
        if (c) setCity(c);
        else setDenied(true);
      },
      () => {
        setLocating(false);
        setDenied(true);
      },
      { timeout: 10_000, maximumAge: 600_000 },
    );
  };

  const props = q.data?.properties ?? [];
  const near = city ? props.filter((p) => p.city === city) : [];

  const card = (p: PropertySummary) => (
    <li key={p.id} className="card row">
      <div>
        <h3>{p.name}</h3>
        <div className="muted">{l(p.cityLabel)}</div>
        <span className={`pill ${p.requestsEnabled ? 'pill-ok' : 'pill-muted'}`}>{p.requestsEnabled ? t('welcome.requestsAvailable') : t('welcome.infoOnly')}</span>
      </div>
      <button className="btn-primary" onClick={() => choose(p.id)} aria-label={`${t('welcome.select')} ${p.name}`}>
        {t('welcome.select')}
      </button>
    </li>
  );

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          {t('app.name')}
        </span>
        <LangSwitch />
      </header>
      <main id="main">
        <div className="hero">
          <h1>{t('welcome.title')}</h1>
          <p>{t('welcome.subtitle')}</p>
        </div>
        <fieldset>
          <legend>{t('welcome.chooseLanguage')}</legend>
          <div className="btn-row">
            <button className={lang === 'fr' ? 'btn-primary' : 'btn-secondary'} aria-pressed={lang === 'fr'} onClick={() => setLang('fr')} lang="fr">
              Français
            </button>
            <button className={lang === 'en' ? 'btn-primary' : 'btn-secondary'} aria-pressed={lang === 'en'} onClick={() => setLang('en')} lang="en">
              English
            </button>
          </div>
        </fieldset>
        <button className="btn-secondary btn-block" onClick={findMe} disabled={locating || !q.data}>
          {Icons.pin}
          {locating ? t('welcome.locating') : t('welcome.findMyHotel')}
        </button>
        <p className="muted center" style={{ fontSize: '0.8rem', marginTop: '0.4rem' }}>
          {t('welcome.locationNote')}
        </p>
        {denied && <Notice kind="warn">{t('welcome.locationDenied')}</Notice>}
        {q.loading && <Spinner />}
        {q.error && <ErrorNotice code={q.error.code} onRetry={q.reload} />}
        {near.length > 0 && (
          <section aria-live="polite">
            <h2>{t('welcome.nearYou', { city: l(near[0].cityLabel) })}</h2>
            <ul style={{ listStyle: 'none', padding: 0 }}>{near.map(card)}</ul>
          </section>
        )}
        {props.length > 0 && (
          <section>
            <h2>{t('welcome.allHotels')}</h2>
            <ul style={{ listStyle: 'none', padding: 0 }}>{props.map(card)}</ul>
          </section>
        )}
      </main>
    </div>
  );
}
