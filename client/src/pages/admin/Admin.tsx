import { useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { ApiError, post } from '../../lib/api';
import { useQuery } from '../../lib/hooks';
import { ErrorNotice, Notice, Loading } from '../../components/ui';
import { useStaff } from '../staff/staffContext';
import EditableTable, { type Column } from './EditableTable';
import Stays from './Stays';

type Row = Record<string, any>;

function useCols() {
  const { t } = useI18n();
  const names: Column[] = [
    { key: 'nameFr', label: t('admin.nameFr'), type: 'text', width: 160 },
    { key: 'nameEn', label: t('admin.nameEn'), type: 'text', width: 160 },
    { key: 'nameEs', label: t('admin.nameEs'), type: 'text', width: 160 },
  ];
  return { t, names };
}

function Food() {
  const { t, names } = useCols();
  const { l } = useI18n();
  const [v, setV] = useState(0);
  const q = useQuery<{ categories: Row[]; items: Row[]; groups: Row[]; options: Row[] }>('/api/admin/food', [v]);
  const [itemId, setItemId] = useState<number | null>(null);
  if (!q.data) return <Loading />;
  const reload = () => setV((x) => x + 1);
  const catOptions = q.data.categories.map((c) => ({ value: c.id as number, label: l({ fr: c.nameFr, en: c.nameEn, es: c.nameEs }) }));
  const groups = q.data.groups.filter((g) => g.foodItemId === itemId);
  return (
    <>
      <h2>{t('admin.category')}</h2>
      <EditableTable
        rows={q.data.categories}
        endpoint="/api/admin/food/categories"
        onSaved={reload}
        columns={[...names, { key: 'sort', label: '#', type: 'int', width: 50 }, { key: 'active', label: t('admin.active'), type: 'bool' }]}
      />
      <h2>{t('admin.food')}</h2>
      <EditableTable
        rows={q.data.items}
        endpoint="/api/admin/food/items"
        onSaved={reload}
        createDefaults={{ categoryId: catOptions[0]?.value, available: true, active: true }}
        columns={[
          { key: 'categoryId', label: t('admin.category'), type: 'select', options: catOptions },
          ...names,
          { key: 'descriptionFr', label: t('admin.descriptionFr'), type: 'textarea', width: 180 },
          { key: 'descriptionEn', label: t('admin.descriptionEn'), type: 'textarea', width: 180 },
          { key: 'descriptionEs', label: t('admin.descriptionEs'), type: 'textarea', width: 180 },
          { key: 'priceMinor', label: t('admin.price'), type: 'money', width: 90 },
          { key: 'available', label: t('admin.available'), type: 'bool' },
          { key: 'active', label: t('admin.active'), type: 'bool' },
        ]}
      />
      <h2>{t('admin.optionGroups')}</h2>
      <select aria-label={t('admin.food')} value={itemId ?? ''} onChange={(e) => setItemId(e.target.value ? Number(e.target.value) : null)} style={{ maxWidth: 360 }}>
        <option value="">—</option>
        {q.data.items.map((i) => (
          <option key={i.id} value={i.id}>
            {l({ fr: i.nameFr, en: i.nameEn, es: i.nameEs })}
          </option>
        ))}
      </select>
      {itemId && (
        <>
          <EditableTable
            rows={groups}
            endpoint="/api/admin/food/option-groups"
            onSaved={reload}
            createDefaults={{ foodItemId: itemId }}
            columns={[...names, { key: 'minSelect', label: t('admin.minSelect'), type: 'int', width: 60 }, { key: 'maxSelect', label: t('admin.maxSelect'), type: 'int', width: 60 }]}
          />
          {groups.map((g) => (
            <div key={g.id}>
              <h3>{l({ fr: g.nameFr, en: g.nameEn, es: g.nameEs })}</h3>
              <EditableTable
                rows={q.data!.options.filter((o) => o.groupId === g.id)}
                endpoint="/api/admin/food/options"
                onSaved={reload}
                createDefaults={{ groupId: g.id, available: true }}
                columns={[...names, { key: 'priceDeltaMinor', label: t('admin.priceDelta'), type: 'money', width: 90 }, { key: 'available', label: t('admin.available'), type: 'bool' }]}
              />
            </div>
          ))}
        </>
      )}
    </>
  );
}

function Services() {
  const { t, names } = useCols();
  const [v, setV] = useState(0);
  const q = useQuery<{ services: Row[] }>('/api/admin/services', [v]);
  if (!q.data) return <Loading />;
  return (
    <EditableTable
      rows={q.data.services}
      endpoint="/api/admin/services"
      onSaved={() => setV((x) => x + 1)}
      createDefaults={{ complimentary: true, available: true, active: true, maxQuantity: 4 }}
      columns={[
        ...names,
        { key: 'descriptionFr', label: t('admin.descriptionFr'), type: 'textarea', width: 160 },
        { key: 'descriptionEn', label: t('admin.descriptionEn'), type: 'textarea', width: 160 },
        { key: 'descriptionEs', label: t('admin.descriptionEs'), type: 'textarea', width: 160 },
        { key: 'complimentary', label: t('admin.complimentary'), type: 'bool' },
        { key: 'priceMinor', label: t('admin.fee'), type: 'money', width: 90 },
        { key: 'maxQuantity', label: t('admin.maxQuantity'), type: 'int', width: 70 },
        { key: 'allowDetails', label: t('admin.allowDetails'), type: 'bool' },
        { key: 'available', label: t('admin.available'), type: 'bool' },
        { key: 'active', label: t('admin.active'), type: 'bool' },
      ]}
    />
  );
}

function Content() {
  const { t } = useI18n();
  const [v, setV] = useState(0);
  const q = useQuery<{ content: Row[] }>('/api/admin/content', [v]);
  if (!q.data) return <Loading />;
  const kinds = (['info', 'hours', 'contact', 'event'] as const).map((k) => ({ value: k, label: t(`admin.kind_${k}`) }));
  return (
    <EditableTable
      rows={q.data.content}
      endpoint="/api/admin/content"
      onSaved={() => setV((x) => x + 1)}
      createDefaults={{ kind: 'info', public: true, active: true }}
      columns={[
        { key: 'kind', label: t('admin.kind'), type: 'select', options: kinds },
        { key: 'titleFr', label: t('admin.titleFr'), type: 'text', width: 160 },
        { key: 'titleEn', label: t('admin.titleEn'), type: 'text', width: 160 },
        { key: 'titleEs', label: t('admin.titleEs'), type: 'text', width: 160 },
        { key: 'bodyFr', label: t('admin.bodyFr'), type: 'textarea', width: 200 },
        { key: 'bodyEn', label: t('admin.bodyEn'), type: 'textarea', width: 200 },
        { key: 'bodyEs', label: t('admin.bodyEs'), type: 'textarea', width: 200 },
        { key: 'startsAt', label: t('admin.startsAt'), type: 'datetime' },
        { key: 'public', label: t('admin.public'), type: 'bool' },
        { key: 'active', label: t('admin.active'), type: 'bool' },
      ]}
    />
  );
}

function Locations() {
  const { t } = useI18n();
  const [v, setV] = useState(0);
  const rooms = useQuery<{ rooms: Row[]; configuredRoomCount: number | null }>('/api/admin/rooms', [v]);
  const locs = useQuery<{ locations: Row[] }>('/api/admin/locations', [v]);
  const reload = () => setV((x) => x + 1);
  return (
    <>
      <h2>{t('admin.rooms')}</h2>
      {rooms.data && <p className="muted">{t('admin.roomCount', { count: rooms.data.rooms.length, total: rooms.data.configuredRoomCount ?? '?' })}</p>}
      {rooms.data && (
        <EditableTable
          rows={rooms.data.rooms}
          endpoint="/api/admin/rooms"
          onSaved={reload}
          createDefaults={{ active: true }}
          columns={[
            { key: 'label', label: t('admin.roomLabel'), type: 'text' },
            { key: 'active', label: t('admin.active'), type: 'bool' },
          ]}
        />
      )}
      <h2>{t('admin.poolLocations')}</h2>
      {locs.data && (
        <EditableTable
          rows={locs.data.locations}
          endpoint="/api/admin/locations"
          onSaved={reload}
          createDefaults={{ active: true }}
          columns={[
            { key: 'labelFr', label: t('admin.labelFr'), type: 'text', width: 200 },
            { key: 'labelEn', label: t('admin.labelEn'), type: 'text', width: 200 },
            { key: 'labelEs', label: t('admin.labelEs'), type: 'text', width: 200 },
            { key: 'sort', label: '#', type: 'int', width: 50 },
            { key: 'active', label: t('admin.active'), type: 'bool' },
          ]}
        />
      )}
    </>
  );
}

function Devices() {
  const { t, l } = useI18n();
  const [v, setV] = useState(0);
  const q = useQuery<{ accounts: Row[]; devices: Row[] }>('/api/admin/accounts', [v]);
  const [pw, setPw] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!q.data) return <Loading />;
  const dept = q.data.accounts.filter((a) => a.role !== 'admin');
  return (
    <>
      <h2>{t('admin.accounts')}</h2>
      {msg && <Notice kind="ok">{msg}</Notice>}
      {error && <ErrorNotice code={error} />}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t('admin.account')}</th>
              <th>{t('staff.username')}</th>
              <th>{t('admin.resetPassword')}</th>
            </tr>
          </thead>
          <tbody>
            {q.data.accounts.map((a) => (
              <tr key={a.id}>
                <td>{l({ fr: a.displayNameFr, en: a.displayNameEn, es: a.displayNameEs })}</td>
                <td>
                  <code>{a.username}</code>
                </td>
                <td>
                  <div className="row-start">
                    <input type="password" aria-label={t('admin.newPassword')} placeholder={t('admin.newPassword')} value={pw[a.id] ?? ''} onChange={(e) => setPw({ ...pw, [a.id]: e.target.value })} style={{ maxWidth: 240 }} />
                    <button
                      className="btn-secondary btn-sm"
                      disabled={(pw[a.id] ?? '').length < 10}
                      onClick={async () => {
                        setError(null);
                        try {
                          await post(`/api/admin/accounts/${a.id}/password`, { password: pw[a.id] });
                          setPw({ ...pw, [a.id]: '' });
                          setMsg(t('admin.passwordChanged'));
                        } catch (e) {
                          setError((e as ApiError).code);
                        }
                      }}
                    >
                      {t('app.save')}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>{t('admin.devices')}</h2>
      <EditableTable
        rows={q.data.devices}
        endpoint="/api/admin/devices"
        onSaved={() => setV((x) => x + 1)}
        createDefaults={{ accountId: dept[0]?.id, active: true }}
        columns={[
          { key: 'accountId', label: t('admin.account'), type: 'select', createOnly: false, options: dept.map((a) => ({ value: a.id as string, label: l({ fr: a.displayNameFr, en: a.displayNameEn, es: a.displayNameEs }) })) },
          { key: 'name', label: t('admin.deviceName'), type: 'text', width: 220 },
          { key: 'active', label: t('admin.active'), type: 'bool' },
        ].map((c) => (c.key === 'accountId' ? { ...c, createOnly: true } : c)) as Column[]}
      />
    </>
  );
}

function Integrations() {
  const { t, dateTime } = useI18n();
  const q = useQuery<any>('/api/admin/integrations');
  if (!q.data) return <Loading />;
  const d = q.data;
  return (
    <div className="stack">
      <div className="panel">
        <h3>{t('admin.pms')}</h3>
        <p>{t('admin.pmsStatus_manual')}</p>
        {d.pms.lastChangeAt && <small>{t('admin.pmsLastChange', { time: dateTime(d.pms.lastChangeAt) })}</small>}
      </div>
      <div className="panel">
        <h3>{t('admin.bills')}</h3>
        <p className="mb0">{d.bills.configured ? d.bills.provider : t('admin.billsUnconfigured')}</p>
      </div>
      <div className="panel">
        <h3>{t('admin.push')}</h3>
        <p className="mb0">{d.push.configured ? t('admin.pushConfigured') : t('admin.pushUnconfigured')}</p>
      </div>
      <div className="panel">
        <h3>{t('admin.ordering')}</h3>
        <p>{d.ordering.enabled ? t('admin.orderingEnabled') : t('admin.orderingDisabled')}</p>
        <p>{t('admin.cutoff', { value: d.ordering.scheduledDepartureCutoffHours === null ? t('admin.cutoffOff') : `${d.ordering.scheduledDepartureCutoffHours} h` })}</p>
        <p className="mb0">{t('admin.postStay', { hours: d.ordering.postStayAccessHours })}</p>
      </div>
    </div>
  );
}

export default function Admin() {
  const { t } = useI18n();
  const { me } = useStaff();
  const isAdmin = me.account.role === 'admin';
  const tab = (to: string, label: string) => (
    <NavLink to={to} className={({ isActive }) => (isActive ? 'active' : '')}>
      {label}
    </NavLink>
  );
  return (
    <>
      <nav className="tabs no-print" aria-label={t('admin.title')}>
        {tab('/admin/stays', t('admin.stays'))}
        {isAdmin && (
          <>
            {tab('/admin/food', t('admin.food'))}
            {tab('/admin/services', t('admin.services'))}
            {tab('/admin/content', t('admin.content'))}
            {tab('/admin/locations', t('admin.locations'))}
            {tab('/admin/devices', t('admin.devices'))}
          </>
        )}
        {tab('/admin/integrations', t('admin.integrations'))}
      </nav>
      <Routes>
        <Route path="stays" element={<Stays />} />
        <Route path="integrations" element={<Integrations />} />
        {isAdmin && (
          <>
            <Route path="food" element={<Food />} />
            <Route path="services" element={<Services />} />
            <Route path="content" element={<Content />} />
            <Route path="locations" element={<Locations />} />
            <Route path="devices" element={<Devices />} />
          </>
        )}
        <Route path="*" element={<Navigate to="/admin/stays" replace />} />
      </Routes>
    </>
  );
}
