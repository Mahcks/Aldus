import { router, Slot, usePathname, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { colors } from '../ui';

export function AppShell() {
  const auth = useAuth();
  const path = usePathname();
  const desktop = useWindowDimensions().width >= 820;
  async function signOut() {
    await auth.signOut();
    router.replace('/login');
  }
  if (path.startsWith('/consume/')) return <Slot />;
  const links = [
    { label: 'Home', href: '/home' },
    { label: 'Libraries', href: '/libraries' },
    ...(auth.user?.admin ? [{ label: 'Users', href: '/users' }] : []),
  ];
  return (
    <View style={[styles.shell, !desktop && styles.mobileShell]}>
      <View style={[styles.nav, !desktop && styles.mobileHeader]}>
        <Pressable accessibilityRole="link" onPress={() => router.replace('/home' as Href)}>
          <Text style={styles.brand}>Aldus</Text>
        </Pressable>
        {desktop ? (
          <View style={styles.links}>
            {links.slice(0, 2).map((link) => (
              <NavLink key={link.href} {...link} selected={isActive(path, link.href)} />
            ))}
          </View>
        ) : null}
        {desktop && auth.user?.admin ? (
          <View style={styles.admin}>
            <Text style={styles.navLabel}>Administration</Text>
            <Pressable
              accessibilityRole="link"
              accessibilityState={{ selected: path === '/users' }}
              onPress={() => router.push('/users')}
              style={[styles.link, path === '/users' && styles.activeLink]}
            >
              <Text style={[styles.linkText, path === '/users' && styles.activeText]}>Users</Text>
            </Pressable>
          </View>
        ) : null}
        {desktop ? (
          <View style={styles.account}>
            <Text numberOfLines={1} style={styles.user}>
              {auth.user?.display_name || auth.user?.username}
            </Text>
            <Pressable accessibilityRole="button" onPress={signOut}>
              <Text style={styles.signOut}>Sign out</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable accessibilityRole="button" onPress={signOut}>
            <Text style={styles.signOut}>Sign out</Text>
          </Pressable>
        )}
      </View>
      <View style={styles.main}>
        <Slot />
      </View>
      {!desktop ? (
        <View accessibilityRole="tablist" style={styles.mobileNav}>
          {links.map((link) => (
            <NavLink key={link.href} {...link} selected={isActive(path, link.href)} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function isActive(path: string, href: string) {
  return (
    path === href ||
    (href === '/libraries' &&
      ['/library/', '/work/', '/representation/'].some((prefix) => path.startsWith(prefix)))
  );
}
function NavLink({ label, href, selected }: { label: string; href: string; selected: boolean }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityState={{ selected }}
      onPress={() => router.push(href as Href)}
      style={[styles.link, styles.mobileLink, selected && styles.activeLink]}
    >
      <Text style={[styles.linkText, selected && styles.activeText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, minHeight: '100%', flexDirection: 'row', backgroundColor: colors.canvas },
  mobileShell: { flexDirection: 'column' },
  nav: {
    width: 224,
    paddingHorizontal: 18,
    paddingVertical: 22,
    borderRightWidth: 1,
    borderRightColor: colors.line,
    backgroundColor: colors.panel,
  },
  mobileHeader: {
    width: '100%',
    minHeight: 54,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRightWidth: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mobileNav: {
    minHeight: 58,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.paper,
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  brand: { color: colors.accent, fontFamily: 'Georgia', fontSize: 24, fontWeight: '700' },
  links: { gap: 4, marginTop: 28 },
  link: { minHeight: 44, paddingHorizontal: 11, justifyContent: 'center', borderRadius: 6 },
  mobileLink: { flex: 1, alignItems: 'center', paddingHorizontal: 6 },
  activeLink: { backgroundColor: colors.panelStrong },
  linkText: { color: colors.muted, fontSize: 15, fontWeight: '700' },
  activeText: { color: colors.ink },
  admin: { marginTop: 28, paddingTop: 20, borderTopWidth: 1, borderTopColor: colors.line, gap: 5 },
  navLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  account: {
    marginTop: 'auto',
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    gap: 8,
  },
  user: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  signOut: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  main: { flex: 1, minWidth: 0 },
});
