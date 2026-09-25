/** Number/label formatting shared by the HUD, results and workshop. */

const MINUS = '−';

/** 1240 -> "$1,240"; -30 -> "−$30". */
export function money(n: number): string {
  const v = Math.round(n);
  const abs = Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${v < 0 ? MINUS : ''}$${abs}`;
}

/** Signed money for score lines: "+$120" / "−$30" / "$0". */
export function signedMoney(n: number): string {
  const v = Math.round(n);
  if (v > 0) return `+${money(v)}`;
  return money(v);
}

/** 3 -> "03". */
export function pad2(n: number): string {
  return n < 10 && n >= 0 ? `0${n}` : String(n);
}

/** Today's date as YYYY-MM-DD (local time). */
export function todayKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
