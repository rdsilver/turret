/**
 * Payouts for assault levels. Rewards stopping creatures FAR from the line
 * and taking them apart with style; no ammunition costs (the machine gun is
 * meant to be fired freely).
 */
import type { AssaultOutcome } from './AssaultSession';
import type { LevelResult, ScoreLine } from './Economy';

export function scoreAssault(o: AssaultOutcome): LevelResult {
  const lines: ScoreLine[] = [];
  const titles: string[] = [];
  if (!o.won) {
    lines.push({ label: 'Salvage', detail: `${o.stopped}/${o.creatures} stopped`, amount: Math.round(o.bounty * 0.3), kind: 'base' });
    return { lines, total: lines.reduce((a, l) => a + l.amount, 0), grade: 'D', titles: ['BREACHED'] };
  }
  lines.push({ label: 'Contract', detail: o.level.name, amount: o.level.reward, kind: 'base' });
  lines.push({ label: 'Bounties', detail: `${o.stopped} stopped`, amount: Math.round(o.bounty), kind: 'base' });
  const distBonus = Math.round(o.level.reward * 0.8 * o.distanceScore);
  if (distBonus > 0) lines.push({ label: 'Stopped at range', detail: `${Math.round(o.distanceScore * 100)}% of the field`, amount: distBonus, kind: 'bonus' });
  if (o.limbsSevered > 0) lines.push({ label: 'Dismemberment', detail: `${o.limbsSevered} limbs`, amount: o.limbsSevered * 6, kind: 'bonus' });
  const acc = o.shots > 0 ? o.hits / o.shots : 0;
  if (o.shots >= 10 && acc > 0.5) lines.push({ label: 'Marksman', detail: `${Math.round(acc * 100)}% hits`, amount: Math.round(o.level.reward * 0.2 * acc), kind: 'bonus' });
  if (o.closest > 20) titles.push('NEVER CLOSE');
  if (o.closest < 4) titles.push('CLOSE CALL');
  if (o.limbsSevered >= 4) titles.push('SCRAP YARD');
  if (acc > 0.75 && o.shots >= 10) titles.push('MARKSMAN');
  const total = lines.reduce((a, l) => a + l.amount, 0);
  const grade = o.distanceScore > 0.6 ? 'S' : o.distanceScore > 0.45 ? 'A' : o.distanceScore > 0.3 ? 'B' : o.distanceScore > 0.15 ? 'C' : 'D';
  return { lines, total, grade, titles };
}
