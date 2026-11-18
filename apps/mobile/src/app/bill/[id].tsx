import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { formatRupees, renderInvoiceHtml, type Unit } from '@dukaan/core';
import { getBill, getShop } from '@dukaan/db';
import { space } from '@/constants/theme';
import { getDb } from '@/lib/db';
import { Button, Card, Screen, Text } from '@/ui/primitives';

type Loaded = NonNullable<Awaited<ReturnType<typeof getBill>>>;

async function invoiceHtml(data: Loaded): Promise<string> {
  const db = await getDb();
  const shop = await getShop(db);
  const b = data.bill as Record<string, number | string | null>;
  const customer = b.customer_id ? (await db.execute<{ name: string; gstin: string }>('SELECT name, gstin FROM customer WHERE id = ?', [b.customer_id])).rows[0] : undefined;
  return renderInvoiceHtml(
    { name: shop!.name, gstin: shop!.gstin, stateCode: shop!.stateCode, address: shop!.address, phone: shop!.phone, footer: shop!.invoiceFooter },
    {
      localNo: String(b.local_no), globalNo: (b.global_no as number | null) ?? null, createdAt: Number(b.created_at), status: String(b.status),
      customerName: customer?.name ?? null, customerGstin: customer?.gstin || null, interstate: b.interstate === 1,
      grossPaise: Number(b.gross_paise), discountPaise: Number(b.discount_paise), taxablePaise: Number(b.taxable_paise), cgstPaise: Number(b.cgst_paise),
      sgstPaise: Number(b.sgst_paise), igstPaise: Number(b.igst_paise), cessPaise: Number(b.cess_paise), roundOffPaise: Number(b.round_off_paise), totalPaise: Number(b.total_paise),
    },
    data.lines.map((l) => ({
      name: String(l.name), hsn: String(l.hsn), unit: l.unit as Unit, qtyMilli: Number(l.qty_milli), unitPaise: Number(l.unit_paise),
      gstBp: Number(l.gst_bp), taxablePaise: Number(l.taxable_paise), totalPaise: Number(l.total_paise),
    })),
    data.payments.map((p) => ({ mode: p.mode, amountPaise: p.amount_paise })),
  );
}

export default function BillDone() {
  const { id, change } = useLocalSearchParams<{ id: string; change?: string }>();
  const [data, setData] = useState<Loaded | null>(null);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    void (async () => setData(await getBill(await getDb(), id)))();
  }, [id]);

  const share = async () => {
    if (!data) return;
    setSharing(true);
    try {
      const { uri } = await Print.printToFileAsync({ html: await invoiceHtml(data) });
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `Invoice ${data.bill.local_no}`, UTI: 'com.adobe.pdf' });
    } finally {
      setSharing(false);
    }
  };

  const changePaise = Number(change ?? 0);
  return (
    <Screen style={{ justifyContent: 'space-between' }}>
      <View style={{ gap: space.lg, alignItems: 'center', marginTop: space.xxl }}>
        <Text variant="title" tone="leaf" testID="bill-saved">Bill saved</Text>
        <Text variant="display" testID="bill-saved-total">{data ? formatRupees(data.bill.total_paise) : ' '}</Text>
        <Text tone="ink2" testID="bill-saved-no">{data?.bill.local_no}</Text>
        {changePaise > 0 ? (
          <Card style={{ alignItems: 'center' }}>
            <Text tone="ink2">Return change</Text>
            <Text variant="display" tone="saffron" testID="bill-change">{formatRupees(changePaise)}</Text>
          </Card>
        ) : null}
      </View>
      <View style={{ gap: space.sm }}>
        <Button kind="secondary" title="Share invoice PDF (WhatsApp…)" onPress={share} loading={sharing} disabled={!data} testID="bill-share" />
        <Button title="New bill" onPress={() => router.replace('/billing')} testID="bill-new" />
      </View>
    </Screen>
  );
}
