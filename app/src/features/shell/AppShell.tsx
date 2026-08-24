import { router, Slot, usePathname, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Platform, useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthProvider';
import { AppIcon, type AppIconName } from '../icons';
import { sheetEnter, sheetExit } from '../motion';
import { colors, IconButton, resolvePressStateClass } from '../ui';
import { Pressable, Text, View } from '../tw';
import { api } from '../../lib/api';

type NavItem = { label: string; href: string; icon: AppIconName; badge?: number };

function isActive(path: string, href: string) {
  return (
    path === href ||
    (href === '/sources' && path.startsWith('/sources')) ||
    (href === '/acquisitions' && path.startsWith('/acquisitions')) ||
    (href === '/collections' && path.startsWith('/collections')) ||
    (href === '/activity' && path.startsWith('/activity')) ||
    (href === '/system' && path.startsWith('/system')) ||
    (href === '/libraries' &&
      ['/library/', '/representation/'].some((prefix) => path.startsWith(prefix)))
  );
}

function noop() {
  // Swallows presses on sheet content so they don't bubble to the backdrop.
}

export function AppShell() {
  const path = usePathname();
  return (
    <SafeAreaProvider>
      {path.startsWith('/consume/') ? <Slot /> : <AppShellChrome />}
    </SafeAreaProvider>
  );
}

function AppShellChrome() {
  const auth = useAuth();
  const path = usePathname();
  const insets = useSafeAreaInsets();
  const desktop = useWindowDimensions().width >= 820;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  const consumerLinks: NavItem[] = [
    { label: 'Home', href: '/home', icon: 'home' },
    { label: 'Search', href: '/search', icon: 'search' },
    { label: 'Collections', href: '/collections', icon: 'collections' },
    { label: 'Activity', href: '/activity', icon: 'activity', badge: unreadNotifications },
    { label: 'Account', href: '/account', icon: 'account' },
  ];
  const adminLinks: NavItem[] = auth.user?.admin
    ? [
        { label: 'Libraries', href: '/libraries', icon: 'libraries' },
        { label: 'Acquisitions', href: '/acquisitions', icon: 'acquire' },
        { label: 'Sources', href: '/sources', icon: 'folder' },
        { label: 'Users', href: '/users', icon: 'users' },
        { label: 'System', href: '/system', icon: 'system' },
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

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const result = await api.notificationUnreadCount();
        if (!active) return;
        setUnreadNotifications(result.unread_count);
      } catch {
        if (active) setUnreadNotifications(0);
      }
    }
    void refresh();
    const interval = setInterval(() => void refresh(), 15000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

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
      <MobileHeader
        topInset={insets.top}
        onBrandPress={handleBrandPress}
        onAccountPress={() => router.push('/account')}
      />
      <View className="min-h-0 flex-1">
        <Slot />
      </View>
      <MobileTabBar
        path={path}
        consumerLinks={consumerLinks.filter((link) => link.href !== '/account')}
        bottomInset={insets.bottom}
        sheetOpen={sheetOpen}
        moreSelected={
          path.startsWith('/account') || adminLinks.some((link) => isActive(path, link.href))
        }
        onOpenSheet={openSheet}
      />
      <MoreSheet
        visible={sheetOpen}
        onClose={closeSheet}
        path={path}
        adminLinks={adminLinks}
        userLabel={userLabel}
        onSignOut={handleSignOut}
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
    <View role="navigation" className="w-56 border-r border-line bg-panel px-[18px] py-[22px]">
      <Pressable
        accessibilityRole="link"
        onPress={onBrandPress}
        className="min-h-11 justify-center"
      >
        <Text className="font-editorial-bold text-2xl text-accent">Aldus</Text>
      </Pressable>
      <View className="mt-7 gap-1">
        {consumerLinks
          .filter((link) => link.href !== '/account')
          .map((link) => (
            <NavLink key={link.href} {...link} selected={isActive(path, link.href)} />
          ))}
      </View>
      {adminLinks.length > 0 ? (
        <View className="mt-7 gap-1 border-t border-line pt-5">
          <Text className="px-[11px] text-[11px] font-sans-bold uppercase tracking-widest text-muted">
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
        />
        <Pressable
          accessibilityRole="button"
          onPress={onSignOut}
          className="min-h-11 flex-row items-center"
        >
          <Text className="text-sm font-sans-bold text-accent">Sign out</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Single desktop rail item. Every item — consumer, admin, or the account
 * footer — renders at the same icon/text size so the rail reads as one
 * consistent list; `quiet` tone only mutes the resting color, distinguishing
 * the admin group without making it look like a visually broken mismatch.
 */
function NavLink({
  label,
  href,
  icon,
  badge,
  selected,
  tone = 'primary',
}: NavItem & { selected: boolean; tone?: 'primary' | 'quiet' }) {
  const inactiveTextClass = 'text-muted';
  const iconColor = selected ? colors.accent : colors.muted;
  const backgroundClass = selected ? 'bg-accent-soft' : '';
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const stateClass = resolvePressStateClass({ focused, pressed });

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={badge ? `${label}, ${badge} unread updates` : label}
      accessibilityState={{ selected }}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={() => router.push(href as Href)}
      className={`min-h-11 flex-row items-center gap-2.5 rounded-control px-[11px] ${backgroundClass} ${stateClass}`}
    >
      <View>
        <AppIcon name={icon} size={20} color={iconColor} />
        {badge ? (
          <View className="absolute -right-2 -top-2 min-w-4 items-center rounded-pill bg-accent px-1">
            <Text className="text-[10px] font-sans-bold text-on-accent">{Math.min(badge, 9)}</Text>
          </View>
        ) : null}
      </View>
      <Text
        className={`text-[15px] font-sans-bold ${selected ? 'text-accent' : inactiveTextClass}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Compact mobile masthead: centered brand with a familiar account affordance. */
function MobileHeader({
  topInset,
  onBrandPress,
  onAccountPress,
}: {
  topInset: number;
  onBrandPress: () => void;
  onAccountPress: () => void;
}) {
  const [accountFocused, setAccountFocused] = useState(false);
  const [accountPressed, setAccountPressed] = useState(false);
  const accountStateClass = resolvePressStateClass({
    focused: accountFocused,
    pressed: accountPressed,
  });

  return (
    <View
      className="w-full flex-row items-center border-b border-line bg-panel px-4 pb-2.5"
      style={{ paddingTop: topInset + 6 }}
    >
      <View className="h-11 w-11" />
      <Pressable
        accessibilityRole="link"
        onPress={onBrandPress}
        className="min-h-11 flex-1 items-center justify-center"
      >
        <Text className="font-editorial-bold text-2xl text-accent">Aldus</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open account"
        onBlur={() => setAccountFocused(false)}
        onFocus={() => setAccountFocused(true)}
        onPressIn={() => setAccountPressed(true)}
        onPressOut={() => setAccountPressed(false)}
        onPress={onAccountPress}
        className={`h-11 w-11 items-center justify-center rounded-control ${accountStateClass}`}
      >
        <AppIcon name="account" size={22} color={colors.muted} />
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
  moreSelected,
  onOpenSheet,
}: {
  path: string;
  consumerLinks: NavItem[];
  bottomInset: number;
  sheetOpen: boolean;
  moreSelected: boolean;
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
          badge={link.badge}
          selected={isActive(path, link.href)}
          onPress={() => router.push(link.href as Href)}
        />
      ))}
      <MobileTab
        label="More"
        icon="more"
        selected={sheetOpen || moreSelected}
        expanded={sheetOpen}
        onPress={onOpenSheet}
      />
    </View>
  );
}

function MobileTab({
  label,
  icon,
  badge,
  selected,
  expanded,
  onPress,
}: {
  label: string;
  icon: AppIconName;
  badge?: number;
  selected: boolean;
  expanded?: boolean;
  onPress: () => void;
}) {
  const color = selected ? colors.accent : colors.muted;
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const stateClass = resolvePressStateClass({ focused, pressed });

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={badge ? `${label}, ${badge} unread updates` : label}
      accessibilityState={{ selected, expanded }}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={onPress}
      className={`min-h-11 min-w-11 flex-1 items-center justify-center gap-1 py-1 ${stateClass}`}
    >
      <View>
        <AppIcon name={icon} size={20} color={color} />
        {badge ? (
          <View className="absolute -right-2 -top-2 min-w-4 items-center rounded-pill bg-accent px-1">
            <Text className="text-[10px] font-sans-bold text-on-accent">{Math.min(badge, 9)}</Text>
          </View>
        ) : null}
      </View>
      <Text className={`text-[11px] font-sans-bold ${selected ? 'text-accent' : 'text-muted'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Slide-up sheet for everything the bottom tab bar doesn't have room for:
 * admin links (grouped and visually separated, same treatment as the
 * desktop rail) and the account section. Uses the shared `sheetEnter`/
 * `sheetExit` motion presets, which already resolve to an instant transition
 * when the OS/browser reduced-motion setting is on.
 */
function MoreSheet({
  visible,
  onClose,
  path,
  adminLinks,
  userLabel,
  onSignOut,
  bottomInset,
}: {
  visible: boolean;
  onClose: () => void;
  path: string;
  adminLinks: NavItem[];
  userLabel: string;
  onSignOut: () => void;
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
        <Animated.View entering={sheetEnter} exiting={sheetExit}>
          <Pressable
            onPress={noop}
            accessibilityViewIsModal
            role="dialog"
            className="gap-1 rounded-t-card border-x border-t border-line bg-paper px-5 pt-4"
            style={{ paddingBottom: bottomInset + 16 }}
          >
            <View className="mb-1 flex-row items-center justify-between gap-4 border-b border-line pb-3">
              <Text accessibilityRole="header" className="text-lg font-sans-bold text-ink">
                More
              </Text>
              <IconButton icon="close" label="Close menu" kind="quiet" onPress={onClose} />
            </View>
            {adminLinks.length > 0 ? (
              <View className="gap-1 pb-2">
                <Text className="px-[11px] pb-1 text-[11px] font-sans-bold uppercase tracking-widest text-muted">
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
                <Text className="text-sm font-sans-bold text-accent">Sign out</Text>
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
  const iconColor = selected ? colors.accent : colors.muted;
  const backgroundClass = selected ? 'bg-accent-soft' : '';
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const stateClass = resolvePressStateClass({ focused, pressed });

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityState={{ selected }}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={onPress}
      className={`min-h-11 flex-row items-center gap-2.5 rounded-control px-[11px] ${backgroundClass} ${stateClass}`}
    >
      <AppIcon name={icon} size={18} color={iconColor} />
      <Text className={`text-sm font-sans-bold ${selected ? 'text-accent' : 'text-muted'}`}>
        {label}
      </Text>
    </Pressable>
  );
}
