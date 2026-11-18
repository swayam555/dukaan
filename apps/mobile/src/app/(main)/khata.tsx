import { useT } from '@/i18n';
import { Screen, Text } from '@/ui/primitives';

export default function KhataScreen() {
  const t = useT();
  return (
    <Screen>
      <Text variant="title">{t('tab.khata')}</Text>
    </Screen>
  );
}
