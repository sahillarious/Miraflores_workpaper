import type { PacketIndex } from '../domain/packetIndex';

// Tool output passes through here before it reaches the model. Identity and
// account numbers are not needed to investigate a case, so they are masked to
// their last four characters (enough to spot a transposition such as
// 3309 vs 3390 without sending the full number to the provider).

export function makeRedactor(ix: PacketIndex) {
  const exact = new Set<string>();
  const hh = ix.packet.household;
  if (hh.bank_account_for_refund_or_payment) {
    exact.add(String(hh.bank_account_for_refund_or_payment.account));
    exact.add(String(hh.bank_account_for_refund_or_payment.routing));
  }
  for (const p of hh.people) if (p.ip_pin) exact.add(String(p.ip_pin));
  for (const e of ix.packet.extracted_values) if (e.value_type === 'account_number' && e.value) exact.add(String(e.value));
  const exactList = [...exact].filter((s) => s.length >= 5).sort((a, b) => b.length - a.length);

  return (text: string): string => {
    let out = text.replace(/\b\d{3}-\d{2}-(\d{4})\b/g, '***-**-$1');
    out = out.replace(/\b([A-Z]{2}\d{2}(?: ?\d{4}){3,7})\b/g, (m) => `[account ••${m.replace(/\s/g, '').slice(-4)}]`);
    out = out.replace(/(IP PIN[^0-9]{0,20})(\d{6})/gi, '$1••••••');
    for (const s of exactList) out = out.split(s).join(`••${s.slice(-4)}`);
    return out;
  };
}
