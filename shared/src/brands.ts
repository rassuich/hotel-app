/**
 * Brand themes from the Rassuich Hotels & Resorts colour charter
 * (rassuich.com/chartes-graphiques). Charter values are copied verbatim;
 * anything the charter does not define (muted text, hairline rules, a tint for
 * brands without one, an accessible text shade of the accent) is DERIVED from
 * that brand's own colours by mixing, never invented.
 */
export interface BrandTheme {
  id: string;
  name: string;
  /** Main accent: buttons, borders, highlights (charter). */
  accent: string;
  /** Pressed/hover shade of the accent (charter). */
  accentDeep: string;
  /** Soft background for notes and badges (charter where given, else derived). */
  accentTint: string;
  /** Accent shade that is readable as small text on the paper (derived, >= 4.5:1). */
  accentText: string;
  /** Text colour on an accent-filled button (charter ink or cream, whichever passes 4.5:1). */
  onAccent: string;
  /** Pressed/hover button fill: the charter deep shade, darkened minimally only if cream text would fail 4.5:1. */
  accentPressed: string;
  /** Text colour on the pressed/hover button. */
  onAccentDeep: string;
  paper: string;
  paperDeep: string;
  card: string;
  ink: string;
  muted: string;
  rule: string;
  /** Cream text for dark bars (charter). */
  cream: string;
  /** Path of the logo SVG under client/public, once the charter files are added. */
  logo: string | null;
}

type Hex = string;

function rgb(hex: Hex): [number, number, number] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
function toHex([r, g, b]: number[]): Hex {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}
/** Mixes `a` toward `b` by `t` (0 = a, 1 = b). */
export function mix(a: Hex, b: Hex, t: number): Hex {
  const x = rgb(a);
  const y = rgb(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
}
function luminance(hex: Hex): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: Hex, b: Hex): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
/** Darkens `fg` toward `ink` until it reaches `ratio` against `bg`. */
function readable(fg: Hex, bg: Hex, ink: Hex, ratio = 4.5): Hex {
  let c = fg;
  for (let t = 0; contrast(c, bg) < ratio && t <= 1; t += 0.05) c = mix(fg, ink, t);
  return c;
}

interface CharterColours {
  id: string;
  name: string;
  accent: Hex;
  accentDeep: Hex;
  accentTint?: Hex;
  paper: Hex;
  paperDeep?: Hex;
  card?: Hex;
  ink: Hex;
  muted?: Hex;
  cream: Hex;
}

function build(c: CharterColours): BrandTheme {
  const onAccent = contrast(c.cream, c.accent) >= 4.5 ? c.cream : c.ink;
  const accentPressed = readable(c.accentDeep, c.cream, c.ink);
  const onAccentDeep = c.cream;
  const paperDeep = c.paperDeep ?? mix(c.paper, c.ink, 0.05);
  return {
    id: c.id,
    name: c.name,
    accent: c.accent,
    accentDeep: c.accentDeep,
    accentTint: c.accentTint ?? mix(c.paper, c.accent, 0.1),
    accentText: readable(c.accentDeep, c.paper, c.ink),
    onAccent,
    accentPressed,
    onAccentDeep,
    paper: c.paper,
    paperDeep,
    card: c.card ?? mix(c.paper, '#ffffff', 0.6),
    ink: c.ink,
    // Charter "Slate" is kept when readable; otherwise nudged toward ink to reach 4.5:1 for small
    // text on the darkest surface it is used on (paperDeep).
    muted: readable(c.muted ?? mix(c.ink, c.paper, 0.4), paperDeep, c.ink),
    rule: mix(c.paper, c.ink, 0.16),
    cream: c.cream,
    logo: null,
  };
}

/** Group identity: used before a guest is validated, and as the staff/admin fallback. */
export const GROUP_THEME = build({
  id: 'rassuich',
  name: 'Rassuich Hotels & Resorts',
  accent: '#0f2a4a', // Navy
  accentDeep: '#0a1d34', // Navy Deep
  paper: '#f4f6f8', // Paper
  paperDeep: '#e7edf3', // Paper Deep
  card: '#ffffff', // Card
  ink: '#1c2b3a', // Ink
  muted: '#63758c', // Slate
  cream: '#ffffff',
});

export const BRAND_THEMES: Record<string, BrandTheme> = {
  'palace-anfa': build({
    id: 'palace-anfa',
    name: "Le Palace d'Anfa",
    accent: '#b08d57', // Gold
    accentDeep: '#8f7143', // Gold Deep
    accentTint: '#f0e9dd', // Gold Tint
    paper: '#f8f6f1', // Paper — Web
    ink: '#1c1c1c', // Ink — Web
    cream: '#fdfcfa', // Cream Text
  }),
  'hotel-suisse': build({
    id: 'hotel-suisse',
    name: 'Hôtel Suisse',
    accent: '#1f3a52', // Navy
    accentDeep: '#142838', // Navy Deep
    paper: '#f8f6f1', // Paper
    ink: '#1c1c1c', // Ink
    cream: '#fdfcfa', // Cream Text
  }),
  'palm-plaza': build({
    id: 'palm-plaza',
    name: 'Palm Plaza',
    accent: '#995151', // Terracotta
    accentDeep: '#7a4040', // Terracotta Deep
    accentTint: '#f0e9dd', // Terracotta Tint
    paper: '#f8f6f1', // Paper
    ink: '#1c1c1c', // Ink — Web
    cream: '#fdfcfa', // Cream Text
  }),
  'palm-appart-club': build({
    id: 'palm-appart-club',
    name: 'Palm Appart Club',
    accent: '#ce2b31', // Red
    accentDeep: '#a01f24', // Red Deep
    paper: '#f8f6f1', // Paper
    ink: '#1c1c1c', // Ink
    cream: '#fdfcfa', // Cream Text
  }),
};

export function themeFor(propertyId: string | null | undefined): BrandTheme {
  return propertyId && Object.prototype.hasOwnProperty.call(BRAND_THEMES, propertyId) ? BRAND_THEMES[propertyId] : GROUP_THEME;
}
