import { Tabs } from 'expo-router/js-tabs';
import { Text, type ColorValue } from 'react-native';
import { useT } from '@/i18n';
import { useColors } from '@/ui/theme';

const icon = (glyph: string) => ({ color }: { color: ColorValue }) => <Text style={{ color, fontSize: 18 }}>{glyph}</Text>;

export default function MainTabs() {
  const t = useT();
  const c = useColors();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        lazy: true,
        tabBarActiveTintColor: c.saffronDeep,
        tabBarInactiveTintColor: c.ink3,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.line },
      }}
    >
      <Tabs.Screen name="billing" options={{ title: t('tab.billing'), tabBarIcon: icon('₹') }} />
      <Tabs.Screen name="catalogue" options={{ title: t('tab.catalogue'), tabBarIcon: icon('▤') }} />
      <Tabs.Screen name="khata" options={{ title: t('tab.khata'), tabBarIcon: icon('✎') }} />
      <Tabs.Screen name="more" options={{ title: t('tab.more'), tabBarIcon: icon('⋯') }} />
    </Tabs>
  );
}
