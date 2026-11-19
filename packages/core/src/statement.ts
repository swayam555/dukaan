import { upiUri } from './cart';
import { formatRupees } from './money';

export type StatementShop = { name: string; address: string; phone: string; upiVpa: string };
export type StatementCustomer = { name: string; phone: string };
export type StatementEntry = { createdAt: number; kind: string; note: string; mode: string; amountPaise: number; balancePaise: number; billNo: string | null };

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const money = (p: number) => formatRupees(p, { symbol: false });
const dmy = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

const KIND_LABEL: Record<string, string> = { credit_sale: 'Sale on credit', payment: 'Payment received', adjust: 'Adjustment', opening: 'Opening balance' };

/** Khata statement (A4) for expo-print: every entry with its running balance. Positive balance = customer owes. */
export function renderStatementHtml(shop: StatementShop, customer: StatementCustomer, entries: readonly StatementEntry[], printedAt: number): string {
  const balance = entries.length ? entries[entries.length - 1]!.balancePaise : 0;
  const rows = entries.map((e) => {
    const what = `${KIND_LABEL[e.kind] ?? e.kind}${e.billNo ? ` · Bill ${esc(e.billNo)}` : ''}${e.mode ? ` · ${esc(e.mode.toUpperCase())}` : ''}${e.note ? ` · ${esc(e.note)}` : ''}`;
    return `<tr><td>${dmy(e.createdAt)}</td><td>${what}</td><td class="r">${e.amountPaise > 0 ? money(e.amountPaise) : ''}</td>
      <td class="r">${e.amountPaise < 0 ? money(-e.amountPaise) : ''}</td><td class="r">${money(e.balancePaise)}</td></tr>`;
  }).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Statement ${esc(customer.name)}</title><style>
  body{font-family:-apple-system,Roboto,"Noto Sans","Noto Sans Devanagari",sans-serif;font-size:12px;color:#16181D;margin:24px}
  h1{font-size:20px;margin:0}.muted{color:#4A505C}.r{text-align:right}table{width:100%;border-collapse:collapse;margin-top:12px}
  th,td{padding:6px 4px;border-bottom:1px solid #E3E5E8;vertical-align:top}th{text-align:left;background:#F5F4F0}
  .head{display:flex;justify-content:space-between}.due{font-size:18px;font-weight:700;margin-top:12px}</style></head><body>
  <div class="head"><div><h1>${esc(shop.name)}</h1><div class="muted">${esc(shop.address)}${shop.phone ? ` · ${esc(shop.phone)}` : ''}</div></div>
  <div class="r"><strong>KHATA STATEMENT</strong><div>${dmy(printedAt)}</div></div></div>
  <div style="margin-top:8px">Customer: <strong>${esc(customer.name)}</strong>${customer.phone ? ` · ${esc(customer.phone)}` : ''}</div>
  <table><thead><tr><th>Date</th><th>Details</th><th class="r">Debit (₹)</th><th class="r">Credit (₹)</th><th class="r">Balance (₹)</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="due r">${balance > 0 ? `Amount due: ₹${money(balance)}` : balance < 0 ? `Advance with shop: ₹${money(-balance)}` : 'No dues'}</div>
  ${balance > 0 && shop.upiVpa ? `<div class="muted r">Pay by UPI to ${esc(shop.upiVpa)}</div>` : ''}
  </body></html>`;
}

/** WhatsApp click-to-chat reminder (wa.me). Adds a UPI pay link when the shop has a VPA. Phone: 10-digit Indian mobile. */
export function reminderMessage(shop: StatementShop, customer: StatementCustomer, duePaise: number): string {
  const lines = [`Namaste ${customer.name} ji,`, `${shop.name} khata mein aapka ₹${money(duePaise)} baaki hai.`];
  if (shop.upiVpa) lines.push(`UPI se pay karein: ${upiUri({ vpa: shop.upiVpa, payee: shop.name, amountPaise: duePaise, note: 'Khata payment' })}`);
  lines.push('Dhanyavaad 🙏');
  return lines.join('\n');
}

export function whatsappUrl(phone: string, text: string): string | null {
  const digits = phone.replace(/\D/g, '').slice(-10);
  if (!/^[6-9]\d{9}$/.test(digits)) return null;
  return `https://wa.me/91${digits}?text=${encodeURIComponent(text)}`;
}
