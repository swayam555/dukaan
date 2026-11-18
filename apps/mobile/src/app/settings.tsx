import { useSession } from '@/state/session';
import { Card, Screen, Text } from '@/ui/primitives';

export default function SettingsScreen() {
  const shop = useSession((s) => s.shop);
  return (
    <Screen>
      <Card>
        <Text variant="heading">{shop?.name}</Text>
        <Text tone="ink2">GSTIN {shop?.gstin || '—'} · State {shop?.stateCode}</Text>
      </Card>
    </Screen>
  );
}
