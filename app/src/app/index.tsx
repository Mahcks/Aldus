import { useEffect, useState } from 'react';
import { Platform, SafeAreaView, StyleSheet, Text, View } from 'react-native';

const apiURL = process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === 'web' ? '' : 'http://localhost:8080');

export default function Home() {
  const [reachable, setReachable] = useState<boolean>();

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiURL}/api/health`, { signal: controller.signal })
      .then((response) => setReachable(response.ok))
      .catch(() => setReachable(false));
    return () => controller.abort();
  }, []);

  return (
    <SafeAreaView style={styles.page}>
      <View>
        <Text style={styles.title}>Aldus</Text>
        <Text style={styles.subtitle}>Your library.</Text>
        <Text accessibilityLiveRegion="polite" style={styles.status}>
          API: {reachable === undefined ? 'checking…' : reachable ? 'connected' : 'unreachable'}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, justifyContent: 'center', padding: 32, backgroundColor: '#f5f0e7' },
  title: { color: '#26221d', fontSize: 52, fontWeight: '700', letterSpacing: -2 },
  subtitle: { color: '#665f55', fontSize: 22, marginTop: 4 },
  status: { color: '#665f55', fontSize: 14, marginTop: 28 },
});
