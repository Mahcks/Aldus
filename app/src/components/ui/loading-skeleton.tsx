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
  const { width } = useWindowDimensions();
  const count = width >= 1280 ? 6 : width >= 820 ? 4 : 2;

  return (
    <View className="flex-row gap-4">
      {Array.from({ length: count }, (_, item) => (
        <View key={item} className="min-w-0 flex-1 gap-3">
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

function PlayerControls() {
  return (
    <View className="gap-6">
      <Block className="h-2 w-full" />
      <View className="flex-row justify-between">
        <Block className="h-3 w-12" />
        <Block className="h-3 w-12" />
      </View>
      <View className="items-center gap-3">
        <Block className="h-4 w-3/5" />
        <Block className="h-3 w-2/5" />
      </View>
      <View className="flex-row items-center justify-evenly">
        <Block className="h-7 w-7" />
        <Block className="h-16 w-16 rounded-full" />
        <Block className="h-7 w-7" />
      </View>
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
      className="w-full py-4"
    >
      <Text className="mb-5 text-sm text-muted">{label}</Text>
      <Animated.View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={pulse}
      >
        <View className="gap-7">
          {layout === 'home-feed' ? <HomeFeed /> : null}
          {layout === 'library-grid' ? <LibraryGridSkeleton /> : null}
          {layout === 'home' || layout === 'details' ? <BookDetails /> : null}
          {layout === 'grid' || layout === 'home' ? <BookGrid /> : null}
          {layout === 'details' || layout === 'text' ? <Lines /> : null}
          {layout === 'player' ? (
            <View className="items-center gap-5">
              <Block className="aspect-square w-full max-w-72" />
              <Block className="h-6 w-3/4" />
              <Block className="h-4 w-1/2" />
            </View>
          ) : null}
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
