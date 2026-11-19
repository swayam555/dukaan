import { Link } from 'expo-router';
import { Pressable, View } from 'react-native';
import { setMeta, META } from '@dukaan/db';
import { space } from '@/constants/theme';
import { useT } from '@/i18n';
import { LOCALE_NAMES, type Locale } from '@/i18n/strings';
import { getDb } from '@/lib/db';
import { useSession } from '@/state/session';
import { Card, Pill, Screen, Text } from '@/ui/primitives';

export default function MoreScreen() {
  const t = useT();
  const locale = useSession((s) => s.locale);
  const set = useSession((s) => s.set);
  const choose = async (next: Locale) => {
    set({ locale: next });
    await setMeta(await getDb(), META.locale, next);
  };
  return (
    <Screen style={{ gap: space.lg }}>
      <Text variant="title">{t('tab.more')}</Text>
      <Card style={{ gap: space.md }}>
        <Text variant="heading">{t('more.language')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {(Object.keys(LOCALE_NAMES) as Locale[]).map((l) => (
            <Pressable key={l} onPress={() => void choose(l)} accessibilityRole="button" testID={`locale-${l}`}>
              <Pill label={LOCALE_NAMES[l]} tone={l === locale ? 'saffron' : 'indigo'} />
            </Pressable>
          ))}
        </View>
      </Card>
      <Link href="/printer" testID="more-printer"><Text variant="heading" tone="indigo">Printer</Text></Link>
      <Link href="/settings"><Text variant="heading" tone="indigo">{t('more.settings')}</Text></Link>
      <Link href="/diagnostics" testID="more-diagnostics"><Text variant="heading" tone="indigo">{t('more.diagnostics')}</Text></Link>
    </Screen>
  );
}
