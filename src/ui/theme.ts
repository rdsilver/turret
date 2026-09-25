/**
 * Shared UI palette & typography (minimalist physics-lab look). OWNER: UI agent (may extend).
 *
 * Colours come in two flavours: CSS strings for Text objects and numbers for
 * Graphics/Shapes (`...Num`). Keep the accent restrained: one warm amber for
 * "the thing you should look at", green/red only for good/bad deltas.
 */
export const THEME = {
  bg: 0x121418,
  bgDeep: 0x0d0f12,
  panel: 0x1b1f26,
  panelHi: 0x232833,
  panelEdge: 0x2e3440,
  rule: 0x3a4250,
  grid: 0x1d2128,
  gridMajor: 0x252a33,

  text: '#e8ecf1',
  textNum: 0xe8ecf1,
  textDim: '#8b95a5',
  textDimNum: 0x8b95a5,
  textFaint: '#5c6574',
  textFaintNum: 0x5c6574,

  accent: '#ffb547',
  accentNum: 0xffb547,
  good: '#6fe3a1',
  goodNum: 0x6fe3a1,
  bad: '#ff6b5e',
  badNum: 0xff6b5e,
  money: '#ffd66b',
  moneyNum: 0xffd66b,
  info: '#9fd3ff',
  infoNum: 0x9fd3ff,

  font: '"JetBrains Mono", "IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace',
  fontDisplay: '"Space Grotesk", "Inter", system-ui, sans-serif',
} as const;

/** Type scale for a 1920x1080 logical canvas. */
export const SIZE = {
  micro: 13,
  xs: 15,
  sm: 17,
  md: 20,
  lg: 26,
  xl: 34,
  xxl: 56,
  hero: 168,
} as const;

/** Grade letter colours (results panel, workshop records). */
export const GRADE_COLOR: Record<string, number> = {
  S: 0xffb547,
  A: 0x6fe3a1,
  B: 0x9fd3ff,
  C: 0xc9d1dc,
  D: 0xff6b5e,
};

/** 0xRRGGBB -> '#rrggbb'. */
export function css(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
}
