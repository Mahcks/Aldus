import {
  Fragment,
  useState,
  type PropsWithChildren,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';
import {
  Platform,
  useWindowDimensions,
  View as NativeView,
  type ScrollView as NativeScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Head from 'expo-router/head';
import { router, usePathname, type Href } from 'expo-router';
import { goBackOr, onPlainLinkPress, pageBackFallback } from '@/lib/navigation';
import { Link, Pressable, ScrollView, Text, View } from '@/components/ui/tw';
import { IconButton, resolvePressStateClass } from '@/components/ui/Button';
import { AppIcon } from '@/components/ui/icons';
import { useThemeColors } from '@/components/ui/theme';

/**
 * A page title that's also a control — used only where the title itself
 * names a switchable context (e.g. "which library am I in"), so switching
 * is discoverable exactly where people already read the current one.
 */
function PressableTitle({
  title,
  actionLabel,
  onPress,
  className,
  anchorRef,
}: {
  title: string;
  actionLabel: string;
  onPress: () => void;
  className: string;
  anchorRef?: RefObject<NativeView | null>;
}) {
  const colors = useThemeColors();
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const stateClass = resolvePressStateClass({ focused, pressed });
  return (
    <NativeView ref={anchorRef} style={{ flexShrink: 1 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={actionLabel}
        onBlur={() => setFocused(false)}
        onFocus={() => setFocused(true)}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        onPress={onPress}
        className={`min-h-11 flex-shrink flex-row items-center gap-1.5 rounded-control ${stateClass}`}
      >
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          className={`min-w-0 shrink text-ink ${className}`}
        >
          {title}
        </Text>
        <AppIcon name="chevronDown" size={18} color={colors.subtle} />
      </Pressable>
    </NativeView>
  );
}

export type Breadcrumb = {
  label: string;
  href: Href;
  /** Replaces plain navigation, e.g. to confirm leaving unsaved work first. */
  onPress?: () => void;
};

function Breadcrumbs({ items }: { items: Breadcrumb[] }) {
  const colors = useThemeColors();

  return (
    <View
      role="navigation"
      aria-label="Breadcrumb"
      className="flex-row flex-wrap items-center gap-1"
    >
      {items.map((item, index) => (
        <Fragment key={`${item.label}-${index}`}>
          {index > 0 ? <AppIcon name="chevron" size={14} color={colors.subtle} /> : null}
          <Link
            href={item.href}
            onPress={item.onPress ? onPlainLinkPress(item.onPress) : undefined}
            className="rounded-control py-1 text-sm text-muted hover:text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
          >
            {item.label}
          </Link>
        </Fragment>
      ))}
    </View>
  );
}

/**
 * App-level page header: title, optional back control, and at most one
 * obvious primary action row. Extracted from `Page` so it can be reused
 * independently if a screen ever needs the header without the scroll shell.
 */
export function PageHeader({
  title,
  actions,
  back,
  compact,
  editorial = false,
  onTitlePress,
  titleActionLabel,
  titleAnchorRef,
  breadcrumbs,
}: {
  title: string;
  actions?: ReactNode;
  back?: ReactNode;
  compact: boolean;
  /** Links to this page's parents, shown above the title in place of `back` on web. */
  breadcrumbs?: Breadcrumb[];
  /** Anchors a popover opened by the title control. */
  titleAnchorRef?: RefObject<NativeView | null>;
  /** Screen titles use sans by default; editorial is reserved for a book title. */
  editorial?: boolean;
  /** Makes the title itself a control (a context switcher) instead of plain text. */
  onTitlePress?: () => void;
  /** Accessible name for the title control; required whenever onTitlePress is set. */
  titleActionLabel?: string;
}) {
  const paddingClass = compact ? 'px-4' : 'px-6';
  const layoutClass = compact ? 'items-stretch' : 'items-center';
  const titleSizeClass = compact ? 'text-2xl leading-7' : 'text-[26px] leading-8';
  const actionsWidthClass = compact ? 'w-full' : '';
  const titleFontClass = editorial ? 'font-editorial-bold' : 'font-sans-bold';
  const showBreadcrumbs = Platform.OS === 'web' && Boolean(breadcrumbs?.length);

  return (
    <View
      className={`min-h-[72px] flex-row flex-wrap justify-between gap-3 border-b border-line py-3 ${paddingClass} ${layoutClass}`}
    >
      <View className="min-w-0 max-w-full gap-0.5">
        {showBreadcrumbs ? <Breadcrumbs items={breadcrumbs ?? []} /> : null}
        <View className="min-w-0 max-w-full flex-row items-center gap-2.5">
          {showBreadcrumbs ? null : back}
          {onTitlePress ? (
            <PressableTitle
              title={title}
              actionLabel={titleActionLabel || title}
              onPress={onTitlePress}
              className={`${titleFontClass} ${titleSizeClass}`}
              anchorRef={titleAnchorRef}
            />
          ) : (
            <Text
              accessibilityRole="header"
              className={`flex-shrink text-ink ${titleFontClass} ${titleSizeClass}`}
            >
              {title}
            </Text>
          )}
        </View>
      </View>
      {actions ? (
        <View className={`flex-row flex-wrap items-center gap-2 ${actionsWidthClass}`}>
          {actions}
        </View>
      ) : null}
    </View>
  );
}

export function Page({
  children,
  title,
  actions,
  mobileActions,
  back,
  hideHeader = false,
  scrollable = true,
  scrollRef,
  editorial = false,
  onTitlePress,
  titleActionLabel,
  titleAnchorRef,
  breadcrumbs,
}: PropsWithChildren<{
  title: string;
  /** Virtualized screens provide their own scrolling surface. */
  scrollable?: boolean;
  scrollRef?: Ref<NativeScrollView>;
  actions?: ReactNode;
  /** A single icon action in the mobile bar; other actions stay in the content toolbar. */
  mobileActions?: ReactNode;
  back?: ReactNode;
  /** Hide the desktop title row; mobile always retains its navigation bar. */
  hideHeader?: boolean;
  /** See `PageHeader`'s `editorial` prop — set false for administration screens. */
  editorial?: boolean;
  /** Makes the title itself a control (a context switcher), on both the mobile bar and desktop header. */
  onTitlePress?: () => void;
  /** Accessible name for the title control; required whenever onTitlePress is set. */
  titleActionLabel?: string;
  /** Anchors a popover opened by the title control, on both the mobile bar and desktop header. */
  titleAnchorRef?: RefObject<NativeView | null>;
  /** Links to this page's parents; the desktop web header shows them instead of `back`. */
  breadcrumbs?: Breadcrumb[];
}>) {
  const width = useWindowDimensions().width;
  const compact = width < 600;
  const mobile = width < 820;
  const path = usePathname();
  const fallback = pageBackFallback(path);
  const mobileBack =
    back ||
    (fallback ? (
      <IconButton icon="back" label="Back" kind="quiet" onPress={() => goBackOr(fallback)} />
    ) : undefined);
  const contentPaddingClass = compact ? 'gap-6 px-4 pb-8 pt-5' : 'gap-8 px-8 py-8';

  return (
    <SafeAreaView edges={mobile ? ['top', 'left', 'right'] : ['left', 'right']} style={{ flex: 1 }}>
      {Platform.OS === 'web' ? (
        <Head>
          <title>{`${title} · Aldus`}</title>
        </Head>
      ) : null}
      <View className="flex-1 bg-canvas">
        {mobile ? (
          <View className="min-h-14 flex-row items-center border-b border-line-subtle bg-canvas px-3 py-1">
            <View className="w-[72px] items-start">
              {mobileBack || (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Aldus home"
                  onPress={() => router.navigate('/home')}
                  className="min-h-11 min-w-11 items-center justify-center rounded-control focus-visible:bg-accent-soft active:bg-accent-soft"
                >
                  <Text className="font-editorial text-xl text-ink">Aldus</Text>
                </Pressable>
              )}
            </View>
            <View className="min-w-0 flex-1 items-center">
              {onTitlePress ? (
                <PressableTitle
                  title={title}
                  actionLabel={titleActionLabel || title}
                  onPress={onTitlePress}
                  className="text-base font-sans-semibold"
                  anchorRef={titleAnchorRef}
                />
              ) : (
                <Text
                  accessibilityRole="header"
                  numberOfLines={1}
                  className="text-center text-base font-sans-semibold text-ink"
                >
                  {title}
                </Text>
              )}
            </View>
            <View className="w-[72px] items-end">
              {mobileActions || (
                <IconButton
                  icon="account"
                  label="Open account"
                  kind="quiet"
                  onPress={() => router.navigate('/account')}
                />
              )}
            </View>
          </View>
        ) : hideHeader ? null : (
          <PageHeader
            title={title}
            actions={actions}
            back={back}
            compact={compact}
            editorial={editorial}
            onTitlePress={onTitlePress}
            titleActionLabel={titleActionLabel}
            titleAnchorRef={titleAnchorRef}
            breadcrumbs={breadcrumbs}
          />
        )}
        {scrollable ? (
          <ScrollView
            ref={scrollRef}
            role="main"
            className="flex-1"
            contentContainerClassName={`w-full max-w-[1240px] flex-grow self-center ${contentPaddingClass}`}
          >
            {mobile && actions && !mobileActions ? (
              <View className="flex-row flex-wrap gap-2">{actions}</View>
            ) : null}
            {children}
          </ScrollView>
        ) : (
          <View className="min-h-0 flex-1">{children}</View>
        )}
      </View>
    </SafeAreaView>
  );
}
