import { renderInvoiceHtml } from '../src/invoice';

const shop = { name: 'Sharma <Kirana>', gstin: '27AAPFU0939F1ZV', stateCode: '27', address: 'Pune', phone: '', footer: 'Thank you' };
const bill = { localNo: 'C1-000007', globalNo: null, createdAt: Date.UTC(2026, 10, 18, 6, 30), status: 'final', customerName: null, customerGstin: null, interstate: false,
  grossPaise: 23600, discountPaise: 0, taxablePaise: 22743, cgstPaise: 429, sgstPaise: 428, igstPaise: 0, cessPaise: 0, roundOffPaise: 0, totalPaise: 23600 };

describe('invoice', () => {
  it('renders a tax invoice with escaped text, CGST/SGST and totals', () => {
    const html = renderInvoiceHtml(shop, bill, [{ name: 'चावल <loose>', hsn: '1006', unit: 'kg', qtyMilli: 1500, unitPaise: 12000, gstBp: 500, taxablePaise: 17143, totalPaise: 18000 }], [{ mode: 'cash', amountPaise: 23600 }]);
    expect(html).toContain('TAX INVOICE');
    expect(html).toContain('Sharma &lt;Kirana&gt;');
    expect(html).toContain('चावल &lt;loose&gt;');
    expect(html).toContain('1.5 kg');
    expect(html).toContain('CGST');
    expect(html).toContain('₹236.00');
    expect(html).not.toContain('IGST');
  });

  it('marks unregistered shops as bill of supply and voids clearly', () => {
    const html = renderInvoiceHtml({ ...shop, gstin: '' }, { ...bill, status: 'void' }, [], []);
    expect(html).toContain('BILL OF SUPPLY');
    expect(html).toContain('VOID');
  });
});
