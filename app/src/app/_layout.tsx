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

import '../global.css';
import { AuthProvider } from '../features/auth/AuthProvider';

export default function Layout() {
  const [fontsLoaded] = useFonts({
    Lora_400Regular,
    Lora_700Bold,
    SourceSerif4_400Regular,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  if (!fontsLoaded) return null;

  return (
    <AuthProvider>
      <Stack screenOptions={{ headerShown: false }} />
      <StatusBar style="auto" />
    </AuthProvider>
  );
}
