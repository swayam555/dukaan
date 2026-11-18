import { HlcClock } from '@dukaan/core';
import { migrate, MIGRATIONS, OpWriter, upsertItems, type ItemInput, type Role } from '../src';
import { openNodeDb } from '../src/drivers/node';

export const ITEMS: ItemInput[] = [
  { id: 'salt', name: 'Tata Salt 1kg', salePaise: 2800, mrpPaise: 2800, gstBp: 0, hsn: '2501', costPaise: 2300 },
  { id: 'rice', name: 'Basmati Rice (Loose)', unit: 'kg', salePaise: 12000, gstBp: 500, hsn: '1006', costPaise: 9800 },
  { id: 'soap', name: 'Lux Soap 100g', salePaise: 4500, gstBp: 1800, hsn: '3401', costPaise: 3600 },
];

export async function deviceDb(deviceId = 'dev-a', role: Role = 'owner', wall: () => number = Date.now) {
  const db = openNodeDb();
  await migrate(db, MIGRATIONS);
  await db.transaction((tx) => upsertItems(tx, ITEMS));
  const writer = new OpWriter({ shopId: 'shop-1', deviceId, role }, new HlcClock(deviceId, wall));
  return { db, writer };
}

export const line = (itemId: string, qtyMilli: number) => {
  const item = ITEMS.find((i) => i.id === itemId)!;
  return { itemId, name: item.name, hsn: item.hsn ?? '', unit: item.unit ?? 'pcs', qtyMilli, unitPaise: item.salePaise, mrpPaise: item.mrpPaise ?? item.salePaise, gstBp: item.gstBp ?? 0, costPaise: item.costPaise ?? 0 };
};
