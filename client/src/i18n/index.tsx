import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import en from './en.json';
import fr from './fr.json';
import type { Lang, Localized } from '../../../shared/src/api';
import { formatMoney } from '../../../shared/src/money';

const dictionaries: Record<Lang, unknown> = { en, fr };
const STORAGE_KEY = 'pa.lang';

function lookup(dict: unknown, key: string): string | undefined {
  let cur: unknown = dict;
  for (const part of key.split('.')) {
    if (cur && typeof cur === 'object' && part in (cur as object)) cur = (cur as Record<string, unknown>)[part];
    else return undefined;
  }
  return typeof cur === 'string' ? cur : undefined;
}

export function translate(lang: Lang, key: string, params?: Record<string, string | number>): string {
  const raw = lookup(dictionaries[lang], key) ?? lookup(dictionaries.en, key) ?? key;
  return params ? raw.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`)) : raw;
}

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'fr' || saved === 'en') return saved;
  } catch {
    /* storage unavailable */
  }
  return navigator.language?.toLowerCase().startsWith('en') ? 'en' : 'fr';
}

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  /** Picks the current language from a bilingual value. */
  l: (v: Localized | null | undefined) => string;
  money: (minor: number, currency: string) => string;
  time: (iso: string) => string;
  dateTime: (iso: string) => string;
  /** Translates an API error code, falling back to a generic message. */
  err: (code: string | undefined) => string;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);
  const value = useMemo<I18n>(() => {
    const locale = lang === 'fr' ? 'fr-FR' : 'en-GB';
    return {
      lang,
      setLang,
      t: (key, params) => translate(lang, key, params),
      l: (v) => (v ? v[lang] || v.fr || v.en : ''),
      money: (minor, currency) => formatMoney(minor, currency, lang),
      time: (iso) => new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
      dateTime: (iso) => new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }),
      err: (code) => {
        const k = `errors.${code ?? 'generic'}`;
        const v = translate(lang, k);
        return v === k ? translate(lang, 'errors.generic') : v;
      },
    };
  }, [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('I18nProvider missing');
  return v;
}
