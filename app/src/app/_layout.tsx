import { Lora_400Regular, Lora_700Bold } from '@expo-google-fonts/lora';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { SourceSerif4_400Regular } from '@expo-google-fonts/source-serif-4';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import '@/global.css';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { ServerProvider, useServer } from '@/features/auth/ServerProvider';

/**
 * `(app)` and `(public)` don't render their own Stack navigators — each is
 * just a `_layout` that resolves to a `<Slot/>` internally, so this root
 * `<Stack>` is the only real (animated) navigator above them, and *these
 * two group names* are its actual screens (not `"(app)/home"` etc. — a
 * group with no Navigator of its own doesn't flatten its children up into
 * this one). `index` silently redirects into whichever group auth resolves
 * to on every cold boot, and again on sign-out (`AppShell`'s
 * `router.replace('/')`) — that's never a screen the user navigated to, so
 * it shouldn't play the native push/slide transition a real in-app
 * drill-down gets.
 */
function ServerSession() {
  const server = useServer();
  return (
    <AuthProvider key={server.origin}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" options={{ animation: 'none' }} />
        <Stack.Screen name="(app)" options={{ animation: 'none' }} />
        <Stack.Screen name="(public)" options={{ animation: 'none' }} />
      </Stack>
      <StatusBar style="auto" />
    </AuthProvider>
  );
}

export default function Layout() {
  const [fontsLoaded, fontError] = useFonts({
    Lora_400Regular,
    Lora_700Bold,
    SourceSerif4_400Regular,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ServerProvider>
        <ServerSession />
      </ServerProvider>
    </GestureHandlerRootView>
  );
}
