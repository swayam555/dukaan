import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import StockScreen from '@/app/stock';
import { getDb } from '@/lib/db';
import { freshShop } from './fixtures';

jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);

const q = async <T,>(sql: string) => (await (await getDb()).execute<T>(sql)).rows;

beforeEach(async () => {
  await freshShop('owner');
  const db = await getDb();
  await db.execute("UPDATE item SET low_stock_milli = 5000 WHERE id = 'salt'");
  await db.execute("UPDATE item SET track_batches = 1 WHERE id = 'soap'");
});

test('low stock → adjust with a reason; the op carries the reason', async () => {
  await render(<StockScreen />);
  await fireEvent.press(await screen.findByTestId('low-salt'));
  await fireEvent.changeText(screen.getByTestId('adjust-qty'), '12');
  await fireEvent.press(screen.getByTestId('adjust-reason-opening'));
  await fireEvent.press(screen.getByTestId('adjust-save'));
  expect(await screen.findByTestId('stock-notice')).toHaveTextContent('Tata Salt 1kg: +12 pcs (Opening stock)');
  await waitFor(() => expect(screen.queryByTestId('low-salt')).toBeNull()); // 12 > re-order level 5
  expect(await q('SELECT qty_milli FROM item_stock WHERE item_id = \'salt\'')).toEqual([{ qty_milli: 12000 }]);
  const op = (await q<{ payload: string }>("SELECT payload FROM op_log WHERE type = 'stock.adjust'"))[0]!;
  expect(JSON.parse(op.payload)).toMatchObject({ itemId: 'salt', deltaMilli: 12000, reason: 'opening' });
});

test('purchase with a new supplier and a dated batch: stock in, cost updated, batch shows as expiring', async () => {
  await render(<StockScreen />);
  await fireEvent.press(screen.getByTestId('stock-tab-purchase'));
  await fireEvent.changeText(screen.getByTestId('purchase-new-supplier'), 'Gupta Traders');
  await fireEvent.press(screen.getByTestId('purchase-add-supplier'));
  await fireEvent.changeText(screen.getByTestId('purchase-invoice'), 'GT/778');
  await fireEvent.changeText(screen.getByTestId('purchase-search'), 'lux');
  await fireEvent.press(await screen.findByTestId('purchase-hit-soap'));
  await fireEvent.changeText(screen.getByTestId('purchase-qty-soap'), '24');
  await fireEvent.changeText(screen.getByTestId('purchase-cost-soap'), '32');
  await fireEvent.changeText(screen.getByTestId('purchase-batch-soap'), 'B12');
  const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  await fireEvent.changeText(screen.getByTestId('purchase-expiry-soap'), soon);
  // 24 × ₹32 = ₹768 + 18% GST ₹138.24
  expect(screen.getByTestId('purchase-total')).toHaveTextContent('Taxable ₹768.00 + GST ₹138.24 = ₹906.24');
  await fireEvent.press(screen.getByTestId('purchase-save'));
  expect(await screen.findByTestId('stock-notice')).toHaveTextContent('Purchase saved: 1 items, ₹906.24');
  expect(await screen.findByText('Gupta Traders')).toBeTruthy(); // history tab

  expect(await q("SELECT qty_milli FROM item_stock WHERE item_id = 'soap'")).toEqual([{ qty_milli: 24000 }]);
  expect(await q("SELECT cost_paise FROM item WHERE id = 'soap'")).toEqual([{ cost_paise: 3200 }]);
  expect(await q('SELECT invoice_no, total_paise FROM purchase')).toEqual([{ invoice_no: 'GT/778', total_paise: 90624 }]);

  await fireEvent.press(screen.getByTestId('stock-tab-expiry'));
  expect(await screen.findByText(/batch B12 · (9|10)d left/)).toBeTruthy();
});

test('cashier is turned away', async () => {
  await freshShop('cashier');
  await render(<StockScreen />);
  expect(screen.getByText(/Only the owner can change stock/)).toBeTruthy();
});
