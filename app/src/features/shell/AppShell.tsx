import { router, Slot, usePathname } from 'expo-router';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { colors } from '../ui';

export function AppShell() {
  const auth = useAuth(); const path = usePathname(); const desktop = useWindowDimensions().width >= 820;
  const links = [{ label: 'Libraries', href: '/libraries' }, ...(auth.user?.admin ? [{ label: 'Users', href: '/users' }] : [])];
  return <View style={[styles.shell, !desktop && styles.mobileShell]}>
    <View style={[styles.nav, !desktop && styles.mobileNav]}>
      <Pressable accessibilityRole="link" onPress={() => router.replace('/libraries')}><Text style={styles.brand}>Aldus</Text></Pressable>
      <View style={[styles.links, !desktop && styles.mobileLinks]}>{links.map((link) => <Pressable accessibilityRole="link" accessibilityState={{ selected: path === link.href }} key={link.label} onPress={() => router.push(link.href as '/libraries' | '/users')} style={[styles.link, path === link.href && styles.activeLink]}><Text style={[styles.linkText, path === link.href && styles.activeText]}>{link.label}</Text></Pressable>)}</View>
      {desktop ? <View style={styles.account}><Text numberOfLines={1} style={styles.user}>{auth.user?.display_name || auth.user?.username}</Text><Pressable accessibilityRole="button" onPress={async () => { await auth.signOut(); router.replace('/login'); }}><Text style={styles.signOut}>Sign out</Text></Pressable></View> : <Pressable accessibilityRole="button" onPress={async () => { await auth.signOut(); router.replace('/login'); }}><Text style={styles.signOut}>Sign out</Text></Pressable>}
    </View>
    <View style={styles.main}><Slot /></View>
  </View>;
}

const styles = StyleSheet.create({
  shell: { flex: 1, minHeight: '100%', flexDirection: 'row', backgroundColor: colors.canvas }, mobileShell: { flexDirection: 'column' },
  nav: { width: 224, paddingHorizontal: 18, paddingVertical: 22, borderRightWidth: 1, borderRightColor: colors.line, backgroundColor: '#ece4d8' }, mobileNav: { width: '100%', minHeight: 58, paddingHorizontal: 14, paddingVertical: 8, borderRightWidth: 0, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: 'row', alignItems: 'center', gap: 12 },
  brand: { color: colors.accent, fontSize: 24, fontWeight: '900' }, links: { gap: 4, marginTop: 28 }, mobileLinks: { flex: 1, flexDirection: 'row', justifyContent: 'center', gap: 2, marginTop: 0 },
  link: { minHeight: 42, paddingHorizontal: 11, justifyContent: 'center', borderRadius: 6 }, activeLink: { backgroundColor: '#ddd0c0' }, linkText: { color: colors.muted, fontSize: 15, fontWeight: '600' }, activeText: { color: colors.ink },
  account: { marginTop: 'auto', paddingTop: 18, borderTopWidth: 1, borderTopColor: colors.line, gap: 8 }, user: { color: colors.ink, fontSize: 13, fontWeight: '700' }, signOut: { color: colors.accent, fontSize: 13, fontWeight: '700' }, main: { flex: 1, minWidth: 0 },
});
