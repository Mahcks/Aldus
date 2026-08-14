import { router, Slot, usePathname, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Modal, Platform, useWindowDimensions } from 'react-native';
import Animated, { SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthProvider';
import { AppIcon, type AppIconName } from '../icons';
import { colors } from '../ui';
import { Pressable, Text, View } from '../tw';

type NavItem = { label: string; href: string; icon: AppIconName };

/**
 * Reflects the OS/browser "reduce motion" preference so the More sheet can
 * skip its slide-in animation. Checked once on mount and, on web, kept live
 * via the media query's change event.
 */
function useReducedMotionPreference() {
  const [reduced, setReduced] = useState(() =>
    Platform.OS === 'web' ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false,
  );

  useEffect(() => {
    if (Platform.OS === 'web') {
      const query = window.matchMedia('(prefers-reduced-motion: reduce)');
      const handleChange = () => setReduced(query.matches);
      query.addEventListener('change', handleChange);
      return () => query.removeEventListener('change', handleChange);
    }
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduced(value);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return reduced;
}

function isActive(path: string, href: string) {
  return (
    path === href ||
    (href === '/sources' && path.startsWith('/sources')) ||
    (href === '/libraries' &&
      ['/library/', '/work/', '/representation/'].some((prefix) => path.startsWith(prefix)))
  );
}

function noop() {
  // Swallows presses on sheet content so they don't bubble to the backdrop.
}

export function AppShell() {
  const path = usePathname();
  if (path.startsWith('/consume/')) return <Slot />;
  return (
    <SafeAreaProvider>
      <AppShellChrome />
    </SafeAreaProvider>
  );
}

function AppShellChrome() {
  const auth = useAuth();
  const path = usePathname();
  const insets = useSafeAreaInsets();
  const desktop = useWindowDimensions().width >= 820;
  const reducedMotion = useReducedMotionPreference();
  const [sheetOpen, setSheetOpen] = useState(false);

  const consumerLinks: NavItem[] = [
    { label: 'Home', href: '/home', icon: 'home' },
    { label: 'Libraries', href: '/libraries', icon: 'libraries' },
    { label: 'Search', href: '/search', icon: 'search' },
    { label: 'Account', href: '/account', icon: 'account' },
  ];
  const adminLinks: NavItem[] = auth.user?.admin
    ? [
        { label: 'Sources', href: '/sources', icon: 'folder' },
        { label: 'Users', href: '/users', icon: 'users' },
      ]
    : [];
  const userLabel = auth.user?.display_name || auth.user?.username || '';

  useEffect(() => {
    if (Platform.OS !== 'web' || !sheetOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSheetOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sheetOpen]);

  async function handleSignOut() {
    setSheetOpen(false);
    await auth.signOut();
    router.replace('/login');
  }
  function handleBrandPress() {
    router.replace('/home' as Href);
  }
  function openSheet() {
    setSheetOpen(true);
  }
  function closeSheet() {
    setSheetOpen(false);
  }

  if (desktop) {
    return (
      <View className="min-h-full flex-1 flex-row bg-canvas">
        <DesktopNav
          path={path}
          consumerLinks={consumerLinks}
          adminLinks={adminLinks}
          userLabel={userLabel}
          onBrandPress={handleBrandPress}
          onSignOut={handleSignOut}
        />
        <View className="min-w-0 flex-1">
          <Slot />
        </View>
      </View>
    );
  }

  return (
    <View className="min-h-full flex-1 bg-canvas">
      <MobileHeader topInset={insets.top} onBrandPress={handleBrandPress} />
      <View className="min-h-0 flex-1">
        <Slot />
      </View>
      <MobileTabBar
        path={path}
        consumerLinks={consumerLinks.filter((link) => link.href !== '/account')}
        bottomInset={insets.bottom}
        sheetOpen={sheetOpen}
        onOpenSheet={openSheet}
      />
      <MoreSheet
        visible={sheetOpen}
        onClose={closeSheet}
        path={path}
        adminLinks={adminLinks}
        userLabel={userLabel}
        onSignOut={handleSignOut}
        reducedMotion={reducedMotion}
        bottomInset={insets.bottom}
      />
    </View>
  );
}

/** Desktop left rail: brand, consumer links, a visually separated admin group, account footer. */
function DesktopNav({
  path,
  consumerLinks,
  adminLinks,
  userLabel,
  onBrandPress,
  onSignOut,
}: {
  path: string;
  consumerLinks: NavItem[];
  adminLinks: NavItem[];
  userLabel: string;
  onBrandPress: () => void;
  onSignOut: () => void;
}) {
  return (
    <View className="w-56 border-r border-line bg-panel px-[18px] py-[22px]">
      <Pressable
        accessibilityRole="link"
        onPress={onBrandPress}
        className="min-h-11 justify-center"
      >
        <Text className="font-editorial text-2xl font-bold text-accent">Aldus</Text>
      </Pressable>
      <View className="mt-7 gap-1">
        {consumerLinks.map((link) => (
          <NavLink key={link.href} {...link} selected={isActive(path, link.href)} />
        ))}
      </View>
      {adminLinks.length > 0 ? (
        <View className="mt-7 gap-1 border-t border-line pt-5">
          <Text className="px-[11px] text-[11px] font-bold uppercase tracking-widest text-subtle">
            Administration
          </Text>
          {adminLinks.map((link) => (
            <NavLink key={link.href} {...link} tone="quiet" selected={isActive(path, link.href)} />
          ))}
        </View>
      ) : null}
      <View className="mt-auto gap-2 border-t border-line pt-[18px]">
        <NavLink
          label={userLabel}
          href="/account"
          icon="account"
          selected={isActive(path, '/account')}
          tone="quiet"
        />
        <Pressable
          accessibilityRole="button"
          onPress={onSignOut}
          className="min-h-11 flex-row items-center"
        >
          <Text className="text-sm font-bold text-accent">Sign out</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Single desktop rail item. `quiet` tone renders the admin group a size down and less saturated. */
function NavLink({
  label,
  href,
  icon,
  selected,
  tone = 'primary',
}: NavItem & { selected: boolean; tone?: 'primary' | 'quiet' }) {
  const iconSize = tone === 'quiet' ? 18 : 20;
  const textSizeClass = tone === 'quiet' ? 'text-sm' : 'text-[15px]';
  const inactiveTextClass = tone === 'quiet' ? 'text-subtle' : 'text-muted';
  const iconColor = selected ? colors.accent : tone === 'quiet' ? colors.subtle : colors.muted;
  const backgroundClass = selected ? 'bg-accent-soft' : '';

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityState={{ selected }}
      onPress={() => router.push(href as Href)}
      className={`min-h-11 flex-row items-center gap-2.5 rounded-control px-[11px] ${backgroundClass}`}
    >
      <AppIcon name={icon} size={iconSize} color={iconColor} />
      <Text
        className={`font-bold ${textSizeClass} ${selected ? 'text-accent' : inactiveTextClass}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Slim mobile top header: brand only, padded for the notch/status bar. */
function MobileHeader({ topInset, onBrandPress }: { topInset: number; onBrandPress: () => void }) {
  return (
    <View
      className="w-full flex-row items-center border-b border-line bg-panel px-4 pb-2"
      style={{ paddingTop: topInset + 8 }}
    >
      <Pressable
        accessibilityRole="link"
        onPress={onBrandPress}
        className="min-h-11 justify-center"
      >
        <Text className="font-editorial text-xl font-bold text-accent">Aldus</Text>
      </Pressable>
    </View>
  );
}

/** Mobile bottom tab bar: consumer destinations only, plus a "More" entry for everything else. */
function MobileTabBar({
  path,
  consumerLinks,
  bottomInset,
  sheetOpen,
  onOpenSheet,
}: {
  path: string;
  consumerLinks: NavItem[];
  bottomInset: number;
  sheetOpen: boolean;
  onOpenSheet: () => void;
}) {
  return (
    <View
      accessibilityRole="tablist"
      className="w-full flex-row justify-around border-t border-line bg-paper px-2 pt-1.5"
      style={{ paddingBottom: bottomInset + 6 }}
    >
      {consumerLinks.map((link) => (
        <MobileTab
          key={link.href}
          label={link.label}
          icon={link.icon}
          selected={isActive(path, link.href)}
          onPress={() => router.push(link.href as Href)}
        />
      ))}
      <MobileTab
        label="More"
        icon="more"
        selected={sheetOpen}
        expanded={sheetOpen}
        onPress={onOpenSheet}
      />
    </View>
  );
}

function MobileTab({
  label,
  icon,
  selected,
  expanded,
  onPress,
}: {
  label: string;
  icon: AppIconName;
  selected: boolean;
  expanded?: boolean;
  onPress: () => void;
}) {
  const color = selected ? colors.accent : colors.muted;

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected, expanded }}
      onPress={onPress}
      className="min-h-11 min-w-11 flex-1 items-center justify-center gap-1 py-1"
    >
      <AppIcon name={icon} size={20} color={color} />
      <Text className={`text-[11px] font-bold ${selected ? 'text-accent' : 'text-muted'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Slide-up sheet for everything the bottom tab bar doesn't have room for:
 * admin links (grouped and visually separated, same treatment as the
 * desktop rail) and the account section. Animates in with Reanimated unless
 * the user prefers reduced motion, in which case it appears instantly.
 */
function MoreSheet({
  visible,
  onClose,
  path,
  adminLinks,
  userLabel,
  onSignOut,
  reducedMotion,
  bottomInset,
}: {
  visible: boolean;
  onClose: () => void;
  path: string;
  adminLinks: NavItem[];
  userLabel: string;
  onSignOut: () => void;
  reducedMotion: boolean;
  bottomInset: number;
}) {
  if (!visible) return null;

  function handleLinkPress(href: string) {
    onClose();
    router.push(href as Href);
  }

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel="Dismiss menu"
        accessibilityRole="button"
        onPress={onClose}
        className="flex-1 justify-end bg-ink/40"
      >
        <Animated.View
          entering={reducedMotion ? undefined : SlideInDown.springify().damping(22)}
          exiting={reducedMotion ? undefined : SlideOutDown.duration(150)}
        >
          <Pressable
            onPress={noop}
            accessibilityViewIsModal
            role="dialog"
            className="gap-1 rounded-t-card border-x border-t border-line bg-paper px-5 pt-4"
            style={{ paddingBottom: bottomInset + 16 }}
          >
            <View className="mb-1 flex-row items-center justify-between gap-4 border-b border-line pb-3">
              <Text accessibilityRole="header" className="text-lg font-bold text-ink">
                More
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close menu"
                onPress={onClose}
                className="h-11 w-11 items-center justify-center rounded-control"
              >
                <AppIcon name="close" size={20} color={colors.muted} />
              </Pressable>
            </View>
            {adminLinks.length > 0 ? (
              <View className="gap-1 pb-2">
                <Text className="px-[11px] pb-1 text-[11px] font-bold uppercase tracking-widest text-subtle">
                  Administration
                </Text>
                {adminLinks.map((link) => (
                  <SheetLink
                    key={link.href}
                    {...link}
                    selected={isActive(path, link.href)}
                    onPress={() => handleLinkPress(link.href)}
                  />
                ))}
              </View>
            ) : null}
            <View className="gap-1 border-t border-line pt-3">
              <SheetLink
                label={userLabel || 'Account'}
                href="/account"
                icon="account"
                selected={isActive(path, '/account')}
                onPress={() => handleLinkPress('/account')}
              />
              <Pressable
                accessibilityRole="button"
                onPress={onSignOut}
                className="min-h-11 flex-row items-center px-[11px]"
              >
                <Text className="text-sm font-bold text-accent">Sign out</Text>
              </Pressable>
            </View>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

function SheetLink({
  label,
  icon,
  selected,
  onPress,
}: NavItem & { selected: boolean; onPress: () => void }) {
  const iconColor = selected ? colors.accent : colors.subtle;
  const backgroundClass = selected ? 'bg-accent-soft' : '';

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`min-h-11 flex-row items-center gap-2.5 rounded-control px-[11px] ${backgroundClass}`}
    >
      <AppIcon name={icon} size={18} color={iconColor} />
      <Text className={`text-sm font-bold ${selected ? 'text-accent' : 'text-subtle'}`}>
        {label}
      </Text>
    </Pressable>
  );
}
