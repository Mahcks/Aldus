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
import { colors } from '@/components/ui/theme';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { ServerProvider, useServer } from '@/components/auth/ServerProvider';

// Index and the authenticated layout are startup destinations, so neither
// should animate as a pushed screen. Public routes have no group layout and
// are registered individually by Expo Router.
function ServerSession() {
  const server = useServer();
  return (
    <AuthProvider key={server.origin}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.canvas },
          statusBarStyle: 'dark',
        }}
      >
        <Stack.Screen name="index" options={{ animation: 'none' }} />
        <Stack.Screen name="(app)" options={{ animation: 'none' }} />
      </Stack>
      <StatusBar style="dark" />
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
