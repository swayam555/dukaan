import { useT } from '@/i18n';
import { useSession } from '@/state/session';
import { Card, Screen, Text } from '@/ui/primitives';

export default function BillingScreen() {
  const t = useT();
  const shop = useSession((s) => s.shop);
  const device = useSession((s) => s.device);
  return (
    <Screen>
      <Text variant="title">{shop?.name}</Text>
      <Text tone="ink3" testID="device-prefix">{device?.prefix} · {device?.role}</Text>
      <Card style={{ marginTop: 16 }}>
        <Text tone="ink2">{t('billing.empty')}</Text>
      </Card>
    </Screen>
  );
}
