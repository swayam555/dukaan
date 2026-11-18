import { STATES } from './gstin';
import { formatRupees } from './money';
import { formatQuantity, type Unit } from './units';

export type InvoiceShop = { name: string; gstin: string; stateCode: string; address: string; phone: string; footer: string };
export type InvoiceBill = {
  localNo: string; globalNo: number | null; createdAt: number; status: string; customerName: string | null; customerGstin: string | null;
  interstate: boolean; grossPaise: number; discountPaise: number; taxablePaise: number; cgstPaise: number; sgstPaise: number;
  igstPaise: number; cessPaise: number; roundOffPaise: number; totalPaise: number;
};
export type InvoiceLine = { name: string; hsn: string; unit: Unit; qtyMilli: number; unitPaise: number; gstBp: number; taxablePaise: number; totalPaise: number };
export type InvoicePayment = { mode: string; amountPaise: number };

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const money = (p: number) => formatRupees(p, { symbol: false });

/** A4 tax invoice (B2C/B2B) as self-contained HTML for expo-print. Devanagari names render via system fonts. */
export function renderInvoiceHtml(shop: InvoiceShop, bill: InvoiceBill, lines: readonly InvoiceLine[], payments: readonly InvoicePayment[]): string {
  const date = new Date(bill.createdAt);
  const when = `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const byRate = new Map<number, { taxable: number }>();
  for (const l of lines) byRate.set(l.gstBp, { taxable: (byRate.get(l.gstBp)?.taxable ?? 0) + l.taxablePaise });
  const rows = lines.map((l, i) => `
    <tr><td>${i + 1}</td><td>${esc(l.name)}</td><td>${esc(l.hsn)}</td><td class="r">${esc(formatQuantity(l.qtyMilli, l.unit))}</td>
    <td class="r">${money(l.unitPaise)}</td><td class="r">${l.gstBp / 100}%</td><td class="r">${money(l.taxablePaise)}</td><td class="r">${money(l.totalPaise)}</td></tr>`).join('');
  const tax = bill.interstate
    ? `<tr><td>IGST</td><td class="r">${money(bill.igstPaise)}</td></tr>`
    : `<tr><td>CGST</td><td class="r">${money(bill.cgstPaise)}</td></tr><tr><td>SGST</td><td class="r">${money(bill.sgstPaise)}</td></tr>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice ${esc(bill.localNo)}</title><style>
  body{font-family:-apple-system,Roboto,"Noto Sans","Noto Sans Devanagari",sans-serif;font-size:12px;color:#16181D;margin:24px}
  h1{font-size:20px;margin:0}.muted{color:#4A505C}.r{text-align:right}table{width:100%;border-collapse:collapse;margin-top:12px}
  th,td{padding:6px 4px;border-bottom:1px solid #E3E5E8;vertical-align:top}th{text-align:left;background:#F5F4F0}
  .head{display:flex;justify-content:space-between}.tot td{border:none;padding:3px 4px}.grand td{font-size:16px;font-weight:700;border-top:2px solid #16181D}
  .void{color:#C23B22;font-size:18px;font-weight:700;border:2px solid #C23B22;padding:4px 8px;display:inline-block}</style></head><body>
  <div class="head"><div><h1>${esc(shop.name)}</h1><div class="muted">${esc(shop.address)}</div>
  <div class="muted">${shop.gstin ? `GSTIN ${esc(shop.gstin)} · ` : ''}State ${esc(shop.stateCode)} ${esc(STATES[shop.stateCode] ?? '')}${shop.phone ? ` · ${esc(shop.phone)}` : ''}</div></div>
  <div class="r"><strong>${shop.gstin ? 'TAX INVOICE' : 'BILL OF SUPPLY'}</strong><div>No. ${esc(bill.localNo)}${bill.globalNo ? ` · ${bill.globalNo}` : ''}</div><div>${when}</div>
  ${bill.status === 'void' ? '<div class="void">VOID</div>' : ''}</div></div>
  ${bill.customerName ? `<div style="margin-top:8px">Billed to: <strong>${esc(bill.customerName)}</strong>${bill.customerGstin ? ` · GSTIN ${esc(bill.customerGstin)}` : ''}</div>` : ''}
  <table><thead><tr><th>#</th><th>Item</th><th>HSN</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">GST</th><th class="r">Taxable</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
  <table class="tot" style="width:45%;margin-left:55%">
  <tr><td>Gross</td><td class="r">${money(bill.grossPaise)}</td></tr>
  ${bill.discountPaise ? `<tr><td>Discount</td><td class="r">−${money(bill.discountPaise)}</td></tr>` : ''}
  <tr><td>Taxable value</td><td class="r">${money(bill.taxablePaise)}</td></tr>${tax}
  ${bill.cessPaise ? `<tr><td>Cess</td><td class="r">${money(bill.cessPaise)}</td></tr>` : ''}
  ${bill.roundOffPaise ? `<tr><td>Round off</td><td class="r">${money(bill.roundOffPaise)}</td></tr>` : ''}
  <tr class="grand"><td>Total</td><td class="r">₹${money(bill.totalPaise)}</td></tr></table>
  <div class="muted" style="margin-top:8px">GST by rate: ${[...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([bp, v]) => `${bp / 100}% on ₹${money(v.taxable)}`).join(' · ')}</div>
  <div class="muted">Paid: ${payments.map((p) => `${esc(p.mode.toUpperCase())} ₹${money(p.amountPaise)}`).join(' + ')}</div>
  ${shop.footer ? `<p class="muted">${esc(shop.footer)}</p>` : ''}</body></html>`;
}
