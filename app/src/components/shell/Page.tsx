import { type PropsWithChildren, type ReactNode } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Head from 'expo-router/head';
import { router, usePathname } from 'expo-router';
import { goBackOr, pageBackFallback } from '@/lib/navigation';
import { Pressable, ScrollView, Text, View } from '@/components/ui/tw';
import { IconButton } from '@/components/ui/Button';

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
}: {
  title: string;
  actions?: ReactNode;
  back?: ReactNode;
  compact: boolean;
  /** Screen titles use sans by default; editorial is reserved for a book title. */
  editorial?: boolean;
}) {
  const paddingClass = compact ? 'px-4' : 'px-6';
  const layoutClass = compact ? 'items-stretch' : 'items-center';
  const titleSizeClass = compact ? 'text-2xl leading-7' : 'text-[26px] leading-8';
  const actionsWidthClass = compact ? 'w-full' : '';
  const titleFontClass = editorial ? 'font-editorial-bold' : 'font-sans-bold';

  return (
    <View
      className={`min-h-[72px] flex-row flex-wrap justify-between gap-3 border-b border-line py-3 ${paddingClass} ${layoutClass}`}
    >
      <View className="min-w-0 max-w-full flex-row items-center gap-2.5">
        {back}
        <Text
          accessibilityRole="header"
          className={`flex-shrink text-ink ${titleFontClass} ${titleSizeClass}`}
        >
          {title}
        </Text>
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
  editorial = false,
}: PropsWithChildren<{
  title: string;
  /** Virtualized screens provide their own scrolling surface. */
  scrollable?: boolean;
  actions?: ReactNode;
  /** A single icon action in the mobile bar; other actions stay in the content toolbar. */
  mobileActions?: ReactNode;
  back?: ReactNode;
  /** Hide the desktop title row; mobile always retains its navigation bar. */
  hideHeader?: boolean;
  /** See `PageHeader`'s `editorial` prop — set false for administration screens. */
  editorial?: boolean;
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
            <Text
              accessibilityRole="header"
              numberOfLines={1}
              className="min-w-0 flex-1 text-center text-base font-sans-semibold text-ink"
            >
              {title}
            </Text>
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
          />
        )}
        {scrollable ? (
          <ScrollView
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
