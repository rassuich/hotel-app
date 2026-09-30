/** Money is always integer minor units plus an explicit ISO currency code. */
export interface Money {
  amountMinor: number;
  currency: string;
}

const MINOR_DIGITS: Record<string, number> = { MAD: 2, EUR: 2, USD: 2 };

export function minorDigits(currency: string): number {
  return MINOR_DIGITS[currency] ?? 2;
}

export function formatMoney(amountMinor: number, currency: string, locale: string): string {
  const digits = minorDigits(currency);
  const value = amountMinor / 10 ** digits;
  try {
    const tag = locale === 'fr' ? 'fr-MA' : locale === 'es' ? 'es-ES' : 'en-GB';
    return new Intl.NumberFormat(tag, {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  } catch {
    return `${value.toFixed(digits)} ${currency}`;
  }
}
