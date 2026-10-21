import type { PacketIndex } from './packetIndex';

// Tax-effect estimates. The engine cannot be rerun, so per the packet README a
// change is multiplied by the matching rate in the current version's
// tax_effect_rates. Positive = more tax owed. These are estimates, always
// labelled as such in the UI; credits and payments move the balance 1:1.

export type RateCategory =
  | 'wages' | 'interest' | 'schc_profit' | 'stcg' | 'ltcg' | 'ordinary_income'
  | 'adjustment' | 'salt' | 'itemized' | 'ca_source_income';

export interface EffectPart {
  category: RateCategory | 'payment_federal' | 'payment_california';
  amount: number; // change in the underlying dollar figure
  /** Fully California-source item: California effect uses ca_source_income per README. */
  caSource?: boolean;
  label: string;
}

export interface Effect { federal: number; california: number; parts: EffectPart[]; basis: string }

export function estimateEffect(ix: PacketIndex, parts: EffectPart[], basis?: string): Effect {
  const rates = ix.current.tax_effect_rates;
  let federal = 0;
  let california = 0;
  for (const p of parts) {
    if (p.category === 'payment_federal') { federal += -p.amount; continue; }
    if (p.category === 'payment_california') { california += -p.amount; continue; }
    const r = rates[p.category];
    if (!r) continue;
    federal += p.amount * r.federal_per_dollar;
    california += p.amount * (p.caSource ? rates.ca_source_income.california_per_dollar : r.california_per_dollar);
  }
  return {
    federal: Math.round(federal),
    california: Math.round(california),
    parts,
    basis: basis ?? `Estimate: change x ${ix.current.version} tax_effect_rates (engine cannot be rerun). Large changes can cross thresholds.`,
  };
}

export const absEffect = (e?: Effect) => (e ? Math.abs(e.federal) + Math.abs(e.california) : 0);
