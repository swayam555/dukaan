import { addItem, cartProblems, EMPTY_CART, isValidVpa, removeLine, updateLine, upiUri, type CatalogueItem } from '../src/cart';

const salt: CatalogueItem = { id: 's', name: 'Salt', hsn: '2501', unit: 'pcs', sale_paise: 2800, mrp_paise: 2800, gst_bp: 0, cess_bp: 0, price_incl_tax: 1, cost_paise: 2300 };
const rice: CatalogueItem = { ...salt, id: 'r', name: 'Rice loose', unit: 'kg', sale_paise: 6000 };

describe('cart', () => {
  it('rescanning a packaged item bumps quantity and moves it to the top', () => {
    let c = addItem(EMPTY_CART, salt);
    c = addItem(c, rice, 1250);
    c = addItem(c, salt);
    expect(c.lines.map((l) => [l.itemId, l.qtyMilli])).toEqual([['s', 2000], ['r', 1250]]);
  });

  it('loose items get their own line and need a weight before checkout', () => {
    let c = addItem(EMPTY_CART, rice);
    c = addItem(c, rice, 500);
    expect(c.lines).toHaveLength(2);
    expect(cartProblems(c)).toEqual(['Rice loose: enter quantity']);
    c = updateLine(c, c.lines[1]!.key, { qtyMilli: 750 });
    expect(cartProblems(c)).toEqual([]);
    expect(removeLine(c, c.lines[0]!.key).lines).toHaveLength(1);
  });

  it('builds an exact-amount UPI link', () => {
    expect(upiUri({ vpa: 'sharma.kirana@okaxis', payee: 'Sharma Kirana', amountPaise: 23650, note: 'Bill C1-000042' }))
      .toBe('upi://pay?pa=sharma.kirana@okaxis&pn=Sharma+Kirana&am=236.50&cu=INR&tn=Bill+C1-000042');
    expect(isValidVpa('sharma.kirana@okaxis')).toBe(true);
    expect(isValidVpa('not a vpa')).toBe(false);
  });
});
