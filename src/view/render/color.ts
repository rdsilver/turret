/**
 * Small allocation-free colour helpers for the view layer (0xRRGGBB ints).
 */

export function lerpColor(a: number, b: number, t: number): number {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const r = ar + (((b >> 16) & 255) - ar) * t;
  const g = ag + (((b >> 8) & 255) - ag) * t;
  const bl = ab + ((b & 255) - ab) * t;
  return ((r & 255) << 16) | ((g & 255) << 8) | (bl & 255);
}

/** Multiply every channel by k (0..1 darkens, >1 brightens, clamped). */
export function scaleColor(c: number, k: number): number {
  const r = Math.min(255, ((c >> 16) & 255) * k);
  const g = Math.min(255, ((c >> 8) & 255) * k);
  const b = Math.min(255, (c & 255) * k);
  return ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
}

/** Mix toward white by t. */
export function tintToward(c: number, target: number, t: number): number {
  return lerpColor(c, target, t);
}

export function grey(v: number): number {
  const g = Math.max(0, Math.min(255, Math.round(v * 255)));
  return (g << 16) | (g << 8) | g;
}

/** Perceived luminance 0..1. */
export function luminance(c: number): number {
  return (0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255)) / 255;
}

export function css(c: number, alpha = 1): string {
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Structural heat-map ramp for joint utilisation (stressVis 0..1.5):
 * calm teal-green -> yellow -> orange -> red (>= yield).
 */
const RAMP_STOPS = [0.0, 0.35, 0.65, 0.9, 1.05, 1.5];
const RAMP_COLORS = [0x2f9e78, 0x7ccf52, 0xf2d23c, 0xff9a2e, 0xff3b30, 0xff2a6a];

export function stressColor(s: number): number {
  if (s <= RAMP_STOPS[0]!) return RAMP_COLORS[0]!;
  for (let i = 1; i < RAMP_STOPS.length; i++) {
    const s1 = RAMP_STOPS[i]!;
    if (s <= s1) {
      const s0 = RAMP_STOPS[i - 1]!;
      return lerpColor(RAMP_COLORS[i - 1]!, RAMP_COLORS[i]!, (s - s0) / (s1 - s0));
    }
  }
  return RAMP_COLORS[RAMP_COLORS.length - 1]!;
}
