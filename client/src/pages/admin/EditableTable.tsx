import { useState } from 'react';
import { useI18n } from '../../i18n';
import { ApiError, patch, post } from '../../lib/api';
import { ErrorNotice } from '../../components/ui';

export interface Column {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'int' | 'money' | 'bool' | 'select' | 'datetime';
  options?: { value: string | number; label: string }[];
  /** Only used when creating a row. */
  createOnly?: boolean;
  width?: number;
}

type Row = Record<string, any>;

const toInput = (c: Column, v: any) => {
  if (v === null || v === undefined) return c.type === 'bool' ? false : '';
  if (c.type === 'money') return (Number(v) / 100).toFixed(2);
  if (c.type === 'bool') return !!v;
  if (c.type === 'datetime') return String(v).slice(0, 16);
  return v;
};
const fromInput = (c: Column, v: any) => {
  if (c.type === 'money') return Math.round(Number(String(v).replace(',', '.')) * 100) || 0;
  if (c.type === 'int') return Number(v) || 0;
  if (c.type === 'bool') return !!v;
  if (c.type === 'select') return typeof c.options?.[0]?.value === 'number' ? Number(v) : v;
  if (c.type === 'datetime') return v ? new Date(v).toISOString() : null;
  return v;
};

function Cell({ c, value, onChange, id }: { c: Column; value: any; onChange: (v: any) => void; id: string }) {
  if (c.type === 'bool') return <input id={id} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} aria-label={c.label} style={{ width: 22, height: 22 }} />;
  if (c.type === 'select')
    return (
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-label={c.label}>
        {c.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  if (c.type === 'textarea') return <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-label={c.label} rows={2} />;
  return (
    <input
      id={id}
      type={c.type === 'datetime' ? 'datetime-local' : 'text'}
      inputMode={c.type === 'money' ? 'decimal' : c.type === 'int' ? 'numeric' : undefined}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={c.label}
    />
  );
}

/** Inline editor: each row saves only its changed fields; a blank row at the bottom creates. */
export default function EditableTable({
  rows,
  columns,
  endpoint,
  createDefaults = {},
  onSaved,
  demoKey = 'isDemo',
}: {
  rows: Row[];
  columns: Column[];
  endpoint: string;
  createDefaults?: Row;
  onSaved: () => void;
  demoKey?: string;
}) {
  const { t } = useI18n();
  const [drafts, setDrafts] = useState<Record<string, Row>>({});
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const blank = () => Object.fromEntries(columns.map((c) => [c.key, toInput(c, createDefaults[c.key] ?? (c.type === 'select' ? c.options?.[0]?.value : undefined))]));
  const [newRow, setNewRow] = useState<Row>(blank);

  const draft = (r: Row) => drafts[r.id] ?? Object.fromEntries(columns.map((c) => [c.key, toInput(c, r[c.key])]));
  const setField = (r: Row, key: string, v: any) => setDrafts((d) => ({ ...d, [r.id]: { ...draft(r), [key]: v } }));

  const save = async (r: Row) => {
    setError(null);
    const d = draft(r);
    const body: Row = {};
    for (const c of columns) {
      if (c.createOnly) continue;
      const v = fromInput(c, d[c.key]);
      const orig = c.type === 'bool' ? !!r[c.key] : r[c.key];
      if (v !== orig && !(v === '' && orig === null)) body[c.key] = v;
    }
    if (Object.keys(body).length === 0) return;
    try {
      await patch(`${endpoint}/${r.id}`, body);
      setDrafts((x) => {
        const { [r.id]: _, ...rest } = x;
        return rest;
      });
      setSavedId(String(r.id));
      onSaved();
    } catch (e) {
      setError((e as ApiError).code);
    }
  };

  const create = async () => {
    setError(null);
    const body: Row = { ...createDefaults };
    for (const c of columns) body[c.key] = fromInput(c, newRow[c.key]);
    try {
      await post(endpoint, body);
      setNewRow(blank());
      onSaved();
    } catch (e) {
      setError((e as ApiError).code);
    }
  };

  return (
    <>
      {error && <ErrorNotice code={error} />}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} style={c.width ? { minWidth: c.width } : undefined}>
                  {c.label}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {columns.map((c) => (
                  <td key={c.key}>
                    {c.createOnly ? String(c.options?.find((o) => o.value === r[c.key])?.label ?? r[c.key] ?? '') : <Cell id={`c-${r.id}-${c.key}`} c={c} value={draft(r)[c.key]} onChange={(v) => setField(r, c.key, v)} />}
                  </td>
                ))}
                <td>
                  <div className="row-start">
                    <button className="btn-secondary btn-sm" onClick={() => save(r)} disabled={!drafts[r.id]}>
                      {t('app.save')}
                    </button>
                    {savedId === String(r.id) && !drafts[r.id] && <span className="state ok">{t('admin.saved')}</span>}
                    {r[demoKey] ? <span className="state warn">{t('admin.demo')}</span> : null}
                  </div>
                </td>
              </tr>
            ))}
            <tr>
              {columns.map((c) => (
                <td key={c.key}>
                  <Cell id={`new-${c.key}`} c={c} value={newRow[c.key]} onChange={(v) => setNewRow((x) => ({ ...x, [c.key]: v }))} />
                </td>
              ))}
              <td>
                <button className="btn-primary btn-sm" onClick={create}>
                  {t('admin.add')}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
