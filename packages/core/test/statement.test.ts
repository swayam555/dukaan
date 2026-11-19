import { reminderMessage, renderStatementHtml, whatsappUrl } from '../src';

const shop = { name: 'Sharma <Kirana>', address: 'MG Road', phone: '9800000000', upiVpa: 'sharma@upi' };
const cust = { name: 'Ramesh', phone: '98000 00001' };

test('statement lists entries with running balance and the amount due', () => {
  const html = renderStatementHtml(shop, cust, [
    { createdAt: Date.UTC(2026, 10, 1, 6), kind: 'credit_sale', note: '', mode: '', amountPaise: 50_000, balancePaise: 50_000, billNo: 'A-12' },
    { createdAt: Date.UTC(2026, 10, 5, 6), kind: 'payment', note: 'part', mode: 'upi', amountPaise: -20_000, balancePaise: 30_000, billNo: null },
  ], Date.UTC(2026, 10, 6, 6));
  expect(html).toContain('Sharma &lt;Kirana&gt;');
  expect(html).toContain('Bill A-12');
  expect(html).toContain('Payment received · UPI · part');
  expect(html).toContain('Amount due: ₹300.00');
  expect(html).toContain('sharma@upi');
});

test('reminder carries amount + UPI link; wa.me needs a valid mobile', () => {
  const text = reminderMessage(shop, cust, 123_456);
  expect(text).toContain('₹1,234.56');
  expect(text).toContain('upi://pay?pa=sharma@upi');
  expect(text).toContain('am=1234.56');
  expect(whatsappUrl(cust.phone, 'hi there')).toBe('https://wa.me/919800000001?text=hi%20there');
  expect(whatsappUrl('12345', 'x')).toBeNull();
  expect(reminderMessage({ ...shop, upiVpa: '' }, cust, 100)).not.toContain('upi://');
});
