import { useEffect } from 'react';
import { useWindowDimensions } from 'react-native';
import Animated, {
  cancelAnimation,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { View, Text } from './tw';

type SkeletonLayout =
  | 'rows'
  | 'grid'
  | 'library-grid'
  | 'home'
  | 'home-feed'
  | 'details'
  | 'work'
  | 'title-list'
  | 'activity'
  | 'notification-list'
  | 'section-list'
  | 'list-rows'
  | 'tabbed-form'
  | 'player'
  | 'controls'
  | 'form'
  | 'text';

function Block({ className }: { className: string }) {
  return <View className={`rounded-control bg-line ${className}`} />;
}

function Lines() {
  return (
    <View className="flex-1 gap-3 py-1">
      <Block className="h-4 w-4/5" />
      <Block className="h-3 w-3/5" />
      <Block className="h-3 w-2/5" />
    </View>
  );
}

function BookGrid() {
  return (
    <View className="flex-row gap-4">
      {/* Keep server and client markup identical; responsive CSS chooses the visible tiles. */}
      {[
        '',
        '',
        'hidden min-[820px]:flex',
        'hidden min-[820px]:flex',
        'hidden min-[1280px]:flex',
        'hidden min-[1280px]:flex',
      ].map((visibility, item) => (
        <View key={item} className={`min-w-0 flex-1 gap-3 ${visibility}`}>
          <Block className="aspect-[2/3] w-full" />
          <Block className="h-4 w-4/5" />
          <Block className="h-3 w-3/5" />
        </View>
      ))}
    </View>
  );
}

/**
 * Mirrors `LibraryGrid`: a wrapped grid of portrait covers several rows
 * deep, sized to the same column breakpoints Library itself uses — a
 * single row (2 tiles on a phone) reads as sparse and empty, nothing like
 * the scrollable grid that's actually about to load in.
 */
function LibraryGridSkeleton() {
  const { width } = useWindowDimensions();
  const columns = width < 600 ? 2 : width < 900 ? 3 : width < 1280 ? 4 : 6;
  const rows = 3;
  return (
    <View className="flex-row flex-wrap">
      {Array.from({ length: columns * rows }, (_, item) => (
        <View key={item} style={{ width: `${100 / columns}%` }} className="gap-2 px-1.5 pb-6">
          <Block className="aspect-[148/218] w-full" />
          <Block className="h-4 w-4/5" />
          <Block className="h-3 w-3/5" />
        </View>
      ))}
    </View>
  );
}

/** One placeholder shelf tile: a portrait cover plus a two-line caption. */
function ShelfTile() {
  return (
    <View className="w-[124px] gap-2">
      <Block className="aspect-[148/218] w-full" />
      <Block className="h-4 w-4/5" />
      <Block className="h-3 w-3/5" />
    </View>
  );
}

/** A horizontal row of shelf tiles, clipped rather than sized to the screen — the real shelves scroll past their fold too. */
function Shelf({ count }: { count: number }) {
  return (
    <View className="flex-row gap-4 overflow-hidden">
      {Array.from({ length: count }, (_, item) => (
        <ShelfTile key={item} />
      ))}
    </View>
  );
}

/** Mirrors `ContinueSpotlight`: a cover beside a title, a progress bar, and a button. */
function Spotlight() {
  return (
    <View className="flex-row gap-4 rounded-card bg-line/40 p-4">
      <Block className="h-44 w-32" />
      <View className="flex-1 justify-between gap-4">
        <View className="gap-2">
          <Block className="h-5 w-4/5" />
          <Block className="h-3 w-2/5" />
        </View>
        <View className="gap-2">
          <Block className="h-1 w-full" />
          <Block className="h-11 w-full" />
        </View>
      </View>
    </View>
  );
}

/** Mirrors `CollectionCard`: an icon dot beside two lines, two per row. */
function CollectionRow() {
  return (
    <View className="flex-row flex-wrap gap-3">
      {[0, 1].map((item) => (
        <View
          key={item}
          className="min-h-11 grow basis-[47%] flex-row items-center gap-3 rounded-card p-3"
        >
          <Block className="h-10 w-10 rounded-pill" />
          <View className="min-w-0 flex-1 gap-2">
            <Block className="h-3 w-3/5" />
            <Block className="h-3 w-2/5" />
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * Home's real feed is several distinct sections (spotlight, shelves,
 * collections), not one uniform grid — the generic `home` layout's single
 * cover-plus-row reads as "two books" on a phone and nothing like the page
 * that actually loads in. This mirrors that section structure instead.
 */
function HomeFeed() {
  return (
    <View className="gap-7">
      <View className="gap-2">
        <Block className="h-7 w-1/2" />
        <Block className="h-3 w-1/3" />
      </View>
      <Spotlight />
      <View className="gap-3">
        <Block className="h-4 w-20" />
        <Shelf count={3} />
      </View>
      <View className="gap-3">
        <Block className="h-4 w-28" />
        <Shelf count={5} />
      </View>
      <View className="gap-3">
        <Block className="h-4 w-24" />
        <CollectionRow />
      </View>
    </View>
  );
}

function BookDetails() {
  return (
    <View className="flex-row gap-5">
      <Block className="h-48 w-32" />
      <View className="flex-1 justify-between">
        <Lines />
        <Block className="h-11 w-full" />
      </View>
    </View>
  );
}

/**
 * Mirrors the player's fixed bottom block: scrubber and times, the chapter
 * row, the rewind/play/forward row, then speed, sleep timer and read along.
 */
function PlayerControls() {
  return (
    <View className="w-full">
      <View className="gap-3 pt-4">
        <Block className="h-2 w-full" />
        <View className="flex-row justify-between">
          <Block className="h-3 w-12" />
          <Block className="h-3 w-12" />
        </View>
      </View>
      <Block className="mt-4 h-[62px] w-full" />
      <View className="mt-5 flex-row items-center justify-center gap-10">
        <Block className="h-11 w-11" />
        <Block className="h-16 w-16 rounded-full" />
        <Block className="h-11 w-11" />
      </View>
      <View className="mt-3 flex-row items-center justify-around">
        <Block className="h-11 w-12 rounded-pill" />
        <Block className="h-11 w-11" />
        <Block className="h-11 w-11" />
      </View>
    </View>
  );
}

/** Mirrors the player above its controls: the cover, then the title block, centered in the space left over. */
function PlayerTop() {
  return (
    <View className="flex-1 items-center justify-center gap-5 pt-4">
      <Block className="aspect-square w-full max-w-[260px]" />
      <View className="w-full items-center gap-2">
        <Block className="h-8 w-3/4" />
        <Block className="h-4 w-1/3" />
        <Block className="h-4 w-1/4" />
      </View>
    </View>
  );
}

/** Mirrors a Discover result: a small portrait cover, a title, two detail lines, and a chevron. */
function TitleList() {
  return (
    <View>
      {[0, 1, 2, 3, 4, 5].map((row) => (
        <View
          key={row}
          className="min-h-16 flex-row items-center gap-4 border-b border-line-subtle py-4"
        >
          <Block className="h-20 w-14" />
          <View className="min-w-0 flex-1 gap-2">
            <Block className="h-5 w-4/5" />
            <Block className="h-3.5 w-1/2" />
            <Block className="h-3.5 w-1/3" />
          </View>
          <Block className="h-5 w-5" />
        </View>
      ))}
    </View>
  );
}

/** Mirrors an Activity update: a small cover, title, status line, summary, and an action button. */
function NotificationList() {
  const { width } = useWindowDimensions();
  const sideBySide = width >= 640;

  return (
    <View>
      {[0, 1, 2, 3].map((row) => (
        <View key={row} className="flex-row gap-4 border-b border-line py-5">
          <Block className="h-20 w-14" />
          <View className={`min-w-0 flex-1 gap-3 ${sideBySide ? 'flex-row items-start' : ''}`}>
            <View className="min-w-0 flex-1 gap-2">
              <Block className="h-6 w-2/3" />
              <View className="flex-row items-center gap-2">
                <Block className="h-6 w-24" />
                <Block className="h-3 w-14" />
              </View>
              <Block className="h-4 w-3/4" />
            </View>
            <Block className="h-11 w-28" />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Activity's filter button above its updates, so the filter never appears after the list does. */
function ActivityPage() {
  return (
    <View className="gap-4">
      <Block className="h-11 w-40" />
      <NotificationList />
    </View>
  );
}

/** A quiet list of rows: a leading tile, two lines of text, and a chevron. */
function ListRows({ count = 5 }: { count?: number }) {
  return (
    <View className="border-t border-line">
      {Array.from({ length: count }, (_, row) => (
        <View key={row} className="min-h-16 flex-row items-center gap-3 border-b border-line py-3">
          <Block className="h-10 w-10" />
          <View className="min-w-0 flex-1 gap-2">
            <Block className="h-4 w-1/2" />
            <Block className="h-3 w-3/4" />
          </View>
          <Block className="h-5 w-5" />
        </View>
      ))}
    </View>
  );
}

/** A section title with an action on its right, then a list: Collections, Libraries, Sources, System. */
function SectionList() {
  return (
    <View className="gap-2">
      <View className="min-h-11 flex-row items-center justify-between gap-3">
        <Block className="h-6 w-40" />
        <Block className="h-11 w-36" />
      </View>
      <ListRows />
    </View>
  );
}

/** A row of tabs above a form: Acquisitions and Manage. */
function TabbedForm() {
  return (
    <View className="gap-6">
      <View className="flex-row gap-2 border-b border-line pb-0">
        {[0, 1, 2, 3].map((tab) => (
          <Block key={tab} className="h-11 w-20 rounded-b-none" />
        ))}
      </View>
      {[0, 1, 2].map((field) => (
        <View key={field} className="gap-3">
          <Block className="h-3 w-1/3" />
          <Block className="h-11 w-full" />
        </View>
      ))}
    </View>
  );
}

/** Mirrors the book page: a side panel with the cover and actions on wide screens, a centered hero with tabs elsewhere. */
function WorkPage() {
  const { width } = useWindowDimensions();
  const contentWidth = width - (width >= 820 ? 224 : 0);
  const about = (
    <View className="gap-3">
      <Block className="h-5 w-40" />
      <Block className="h-4 w-full" />
      <Block className="h-4 w-full" />
      <Block className="h-4 w-4/5" />
    </View>
  );

  if (contentWidth >= 900) {
    return (
      <View className="mx-auto w-full max-w-[1080px] flex-row items-start gap-14 pb-10 pt-2">
        <View className="w-[340px] shrink-0 gap-4">
          <Block className="aspect-[0.68] w-full" />
          <Block className="h-11 w-full" />
          <Block className="h-11 w-full" />
        </View>
        <View className="min-w-0 flex-1 gap-8 pt-1">
          <View className="gap-4">
            <Block className="h-3 w-24" />
            <Block className="h-[58px] w-3/4" />
            <Block className="h-6 w-1/3" />
            <View className="flex-row gap-2">
              <Block className="h-8 w-24" />
              <Block className="h-8 w-28" />
            </View>
            <View className="flex-row gap-2">
              <Block className="h-11 w-36" />
              <Block className="h-11 w-32" />
            </View>
          </View>
          {about}
        </View>
      </View>
    );
  }

  return (
    <View className="mx-auto w-full max-w-[720px] gap-6">
      <View className="items-center gap-4 rounded-dialog bg-line/40 px-5 pb-6 pt-8">
        <Block className="h-[300px] w-[204px]" />
        <View className="w-full items-center gap-2">
          <Block className="h-3 w-24" />
          <Block className="h-9 w-3/4" />
          <Block className="h-5 w-1/2" />
        </View>
        <View className="w-full gap-3 pt-1">
          <Block className="h-11 w-full" />
          <View className="flex-row gap-2">
            <Block className="h-11 flex-1" />
            <Block className="h-11 w-11" />
            <Block className="h-11 w-11" />
          </View>
        </View>
      </View>
      <View className="flex-row gap-6 border-b border-line pb-3">
        <Block className="h-4 w-14" />
        <Block className="h-4 w-14" />
        <Block className="h-4 w-16" />
      </View>
      {about}
    </View>
  );
}

/** One opacity animation per loading region; placeholders never receive input. */
export function LoadingState({
  label = 'Loading…',
  layout = 'rows',
}: {
  label?: string;
  layout?: SkeletonLayout;
}) {
  const reducedMotion = useReducedMotion();
  // These skeletons sit exactly where the real page's content will, so they carry no visible
  // caption or extra padding; the label stays available to screen readers.
  const mirrorsPage = [
    'work',
    'home-feed',
    'library-grid',
    'title-list',
    'activity',
    'notification-list',
    'section-list',
    'list-rows',
    'tabbed-form',
    'player',
    'controls',
  ].includes(layout);
  const fillsPage = layout === 'player';
  const opacity = useSharedValue(1);
  const pulse = useAnimatedStyle(() => ({ opacity: opacity.get() }));

  useEffect(() => {
    if (!reducedMotion) {
      opacity.set(
        withRepeat(
          withTiming(0.5, { duration: 1000, reduceMotion: ReduceMotion.System }),
          -1,
          true,
          undefined,
          ReduceMotion.System,
        ),
      );
    }
    return () => cancelAnimation(opacity);
  }, [opacity, reducedMotion]);

  return (
    <View
      accessible
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      accessibilityState={{ busy: true }}
      aria-busy={true}
      testID={`loading-${layout}`}
      className={`w-full ${mirrorsPage ? '' : 'py-4'} ${fillsPage ? 'flex-1' : ''}`}
    >
      {mirrorsPage ? null : <Text className="mb-5 text-sm text-muted">{label}</Text>}
      <Animated.View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={pulse}
        className={fillsPage ? 'flex-1' : undefined}
      >
        <View className={`gap-7 ${fillsPage ? 'flex-1' : ''}`}>
          {layout === 'home-feed' ? <HomeFeed /> : null}
          {layout === 'library-grid' ? <LibraryGridSkeleton /> : null}
          {layout === 'home' || layout === 'details' ? <BookDetails /> : null}
          {layout === 'grid' || layout === 'home' ? <BookGrid /> : null}
          {layout === 'details' || layout === 'text' ? <Lines /> : null}
          {layout === 'work' ? <WorkPage /> : null}
          {layout === 'title-list' ? <TitleList /> : null}
          {layout === 'activity' ? <ActivityPage /> : null}
          {layout === 'notification-list' ? <NotificationList /> : null}
          {layout === 'section-list' ? <SectionList /> : null}
          {layout === 'list-rows' ? <ListRows /> : null}
          {layout === 'tabbed-form' ? <TabbedForm /> : null}
          {layout === 'player' ? <PlayerTop /> : null}
          {layout === 'player' || layout === 'controls' ? <PlayerControls /> : null}
          {layout === 'rows'
            ? [0, 1, 2].map((row) => (
                <View key={row} className="flex-row gap-4">
                  <Block className="h-14 w-14" />
                  <Lines />
                </View>
              ))
            : null}
          {layout === 'form'
            ? [0, 1, 2].map((field) => (
                <View key={field} className="gap-3">
                  <Block className="h-3 w-1/3" />
                  <Block className="h-11 w-full" />
                </View>
              ))
            : null}
        </View>
      </Animated.View>
    </View>
  );
}
