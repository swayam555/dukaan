import '@/lib/polyfills';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { boot } from '@/lib/boot';
import { startSync, stopSync } from '@/lib/sync';
import { useSession } from '@/state/session';
import { Text } from '@/ui/primitives';
import { useColors } from '@/ui/theme';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const status = useSession((s) => s.status);
  const error = useSession((s) => s.error);
  const c = useColors();

  useEffect(() => {
    void boot();
  }, []);

  // sync runs while the shop is unlocked (it needs the writer's clock and device identity)
  useEffect(() => {
    if (status !== 'ready') return;
    void startSync();
    return stopSync;
  }, [status]);

  useEffect(() => {
    if (status !== 'booting') void SplashScreen.hideAsync();
  }, [status]);

  if (status === 'booting') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.canvas }}>
        <ActivityIndicator color={c.saffron} />
      </View>
    );
  }
  if (status === 'error') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: c.canvas }}>
        <Text variant="heading" tone="brick">Could not open the shop database</Text>
        <Text tone="ink2">{error}</Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.canvas } }}>
          <Stack.Protected guard={status === 'needs-setup'}>
            <Stack.Screen name="setup" />
          </Stack.Protected>
          <Stack.Protected guard={status === 'locked'}>
            <Stack.Screen name="lock" />
          </Stack.Protected>
          <Stack.Protected guard={status === 'ready'}>
            <Stack.Screen name="(main)" />
            <Stack.Screen name="settings" options={{ headerShown: true, title: 'Settings' }} />
            <Stack.Screen name="printer" options={{ headerShown: true, title: 'Printer' }} />
            <Stack.Screen name="diagnostics" options={{ headerShown: true, title: 'Diagnostics' }} />
            <Stack.Screen name="line/[key]" options={{ presentation: 'modal' }} />
            <Stack.Screen name="pay" options={{ headerShown: true, title: 'Payment' }} />
            <Stack.Screen name="bill/[id]" options={{ gestureEnabled: false }} />
            <Stack.Screen name="scan" options={{ headerShown: true, title: 'Scan' }} />
          </Stack.Protected>
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
