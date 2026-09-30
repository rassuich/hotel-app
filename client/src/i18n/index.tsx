import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import en from './en.json';
import fr from './fr.json';
import es from './es.json';
import { LANGS, type Lang, type Localized } from '../../../shared/src/api';
import { formatMoney } from '../../../shared/src/money';

const dictionaries: Record<Lang, unknown> = { en, fr, es };
const STORAGE_KEY = 'pa.lang';
const LOCALES: Record<Lang, string> = { fr: 'fr-FR', en: 'en-GB', es: 'es-ES' };
/** Each language named in itself, for the language picker. */
export const LANGUAGE_NAMES: Record<Lang, string> = { fr: 'Français', en: 'English', es: 'Español' };

function lookup(dict: unknown, key: string): string | undefined {
  let cur: unknown = dict;
  for (const part of key.split('.')) {
    if (cur && typeof cur === 'object' && part in (cur as object)) cur = (cur as Record<string, unknown>)[part];
    else return undefined;
  }
  return typeof cur === 'string' ? cur : undefined;
}

const pluralRules: Partial<Record<Lang, Intl.PluralRules>> = {};
function pluralCategory(lang: Lang, count: number): string {
  pluralRules[lang] ??= new Intl.PluralRules(LOCALES[lang]);
  return pluralRules[lang]!.select(count);
}

/**
 * Looks a key up in the language, then English. When `params.count` is a number and
 * the dictionary has `key_one` / `key_other` variants, the right plural form is used.
 */
export function translate(lang: Lang, key: string, params?: Record<string, string | number>): string {
  let raw: string | undefined;
  if (typeof params?.count === 'number') {
    const cat = pluralCategory(lang, params.count);
    for (const d of [dictionaries[lang], dictionaries.en]) {
      raw ??= lookup(d, `${key}_${cat}`) ?? lookup(d, `${key}_other`);
    }
  }
  raw ??= lookup(dictionaries[lang], key) ?? lookup(dictionaries.en, key) ?? key;
  return params ? raw.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`)) : raw;
}

/** Content fallback order when a translation is missing: chosen language, then English, then French. */
export function pick(v: Localized | null | undefined, lang: Lang): string {
  if (!v) return '';
  return v[lang] || v.en || v.fr || v.es || '';
}

function storedLang(): Lang | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return LANGS.includes(saved as Lang) ? (saved as Lang) : null;
  } catch {
    return null;
  }
}

function browserLang(): Lang {
  const n = (navigator.language || 'fr').toLowerCase();
  return n.startsWith('es') ? 'es' : n.startsWith('en') ? 'en' : 'fr';
}

interface I18n {
  lang: Lang;
  /** IANA zone used for guest-facing times (the hotel's), or undefined for the device zone. */
  setTimeZone: (tz: string | undefined) => void;
  /** False until the guest has explicitly picked a language on this device. */
  chosen: boolean;
  setLang: (l: Lang) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  l: (v: Localized | null | undefined) => string;
  money: (minor: number, currency: string) => string;
  time: (iso: string) => string;
  dateTime: (iso: string) => string;
  err: (code: string | undefined) => string;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [saved, setSaved] = useState<Lang | null>(storedLang);
  const [timeZone, setTimeZone] = useState<string | undefined>(undefined);
  const lang = saved ?? browserLang();
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const setLang = useCallback((l: Lang) => {
    setSaved(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);
  const value = useMemo<I18n>(() => {
    const locale = LOCALES[lang];
    const tz = (() => {
      try {
        return timeZone ? new Intl.DateTimeFormat(locale, { timeZone }).resolvedOptions().timeZone : undefined;
      } catch {
        return undefined;
      }
    })();
    return {
      lang,
      setTimeZone,
      chosen: saved !== null,
      setLang,
      t: (key, params) => translate(lang, key, params),
      l: (v) => pick(v, lang),
      money: (minor, currency) => formatMoney(minor, currency, lang),
      time: (iso) => new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: tz }),
      dateTime: (iso) => new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: tz }),
      err: (code) => {
        const k = `errors.${code ?? 'generic'}`;
        const v = translate(lang, k);
        return v === k ? translate(lang, 'errors.generic') : v;
      },
    };
  }, [lang, saved, setLang, timeZone]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('I18nProvider missing');
  return v;
}
