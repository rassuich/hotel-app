import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { themeFor, type BrandTheme } from '../../../shared/src/brands';

const VARS: [keyof BrandTheme, string][] = [
  ['accent', '--accent'],
  ['accentDeep', '--accent-deep'],
  ['accentTint', '--accent-tint'],
  ['accentText', '--accent-text'],
  ['onAccent', '--on-accent'],
  ['paper', '--paper'],
  ['paperDeep', '--paper-deep'],
  ['card', '--card'],
  ['ink', '--ink'],
  ['muted', '--muted'],
  ['rule', '--rule'],
  ['cream', '--cream'],
];

export function applyTheme(theme: BrandTheme) {
  const root = document.documentElement;
  for (const [key, cssVar] of VARS) root.style.setProperty(cssVar, String(theme[key]));
  root.dataset.brand = theme.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.paper);
}

/** Applies the charter theme of a hotel (or the group identity when unknown). */
export function useBrand(propertyId: string | null | undefined): BrandTheme {
  const theme = themeFor(propertyId);
  useEffect(() => applyTheme(theme), [theme]);
  return theme;
}

/** The hotel's logo when its charter SVG is installed, otherwise its name set as a wordmark. */
export function Wordmark({ theme, large = false, href }: { theme: BrandTheme; large?: boolean; href?: string }) {
  const content = theme.logo ? <img src={theme.logo} alt={theme.name} /> : theme.name;
  const cls = `wordmark${large ? ' wordmark-lg' : ''}`;
  return href ? (
    <Link className={cls} to={href}>
      {content}
    </Link>
  ) : (
    <span className={cls}>{content}</span>
  );
}
