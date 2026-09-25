import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Platform,
  type LayoutChangeEvent,
  type ScrollView as NativeScrollView,
} from 'react-native';
import {
  interpolateColor,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { AlignmentSegment } from '@/generated/api';
import type { audioPassage } from '@/lib/consumption/consumption';
import {
  readAlongChunkIndex,
  readAlongChunks,
  readAlongWindow,
  type ReadAlongChunk,
} from '@/lib/consumption/read-along';
import { Button } from '@/components/ui';
import { useThemeColors } from '@/components/ui/theme';
import { fadeIn, fadeOut, phraseEnter } from '@/components/ui/motion';
import { AnimatedText, AnimatedView, Pressable, ScrollView, View } from '@/components/ui/tw';

/** Where the phrase being read rests in the panel, as a fraction of its height. */
const ANCHOR = 0.3;

type Layout = { y: number; height: number };

// Chunking is pure and a segment object never changes, so cache by identity.
const chunkCache = new WeakMap<AlignmentSegment, ReadAlongChunk[]>();

function chunksFor(segment: AlignmentSegment) {
  let chunks = chunkCache.get(segment);
  if (!chunks) {
    chunks = readAlongChunks(segment);
    chunkCache.set(segment, chunks);
  }
  return chunks;
}
type ScrollNode = {
  addEventListener(type: string, listener: () => void, options?: { passive: boolean }): void;
  removeEventListener(type: string, listener: () => void): void;
};

/**
 * The text of the passage being narrated, one phrase in focus with what was
 * just read above it and what's coming below. A view of the playing passage
 * only: it never writes progress or chooses a position. Tapping a phrase asks
 * the player to seek there, the same seek the scrubber makes.
 */
export function ReadAlongPanel({
  passage,
  timestampMS,
  scrollEnabled = true,
  onSeek,
}: {
  passage: NonNullable<ReturnType<typeof audioPassage>>;
  timestampMS: number;
  scrollEnabled?: boolean;
  onSeek: (seconds: number) => void;
}) {
  const reducedMotion = useReducedMotion();
  const scroll = useRef<NativeScrollView>(null);
  const settledToken = useRef(-1);
  const snapUntil = useRef(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [layouts, setLayouts] = useState<Record<string, Layout>>({});
  const [detached, setDetached] = useState(false);
  const [view, setView] = useState(() => ({
    ...readAlongWindow([], passage),
    spacer: 0,
    token: 0,
    lastId: passage.current.id,
  }));

  function segmentHeight(segment: AlignmentSegment) {
    return chunksFor(segment).reduce(
      (total, _chunk, index) => total + (layouts[`${segment.id}:${index}`]?.height ?? 0),
      0,
    );
  }

  // Text already read stays where it is as the narration moves on. When the
  // oldest segments leave the window their height becomes spacer, so nothing
  // below them moves; a seek outside the window rebuilds it from scratch.
  if (view.lastId !== passage.current.id) {
    const next = readAlongWindow(view.segments, passage);
    const droppedHeight = next.dropped.reduce(
      (total, segment) => total + segmentHeight(segment),
      0,
    );
    setView({
      segments: next.segments,
      dropped: next.dropped,
      reset: next.reset,
      spacer: next.reset ? 0 : view.spacer + droppedHeight,
      token: next.reset ? view.token + 1 : view.token,
      lastId: passage.current.id,
    });
  }

  const currentChunks = chunksFor(passage.current);
  const activeIndex = readAlongChunkIndex(currentChunks, timestampMS);
  const activeKey = `${passage.current.id}:${activeIndex}`;
  const shown = [...view.segments, passage.next, passage.following].filter(
    (segment): segment is AlignmentSegment => Boolean(segment),
  );

  useEffect(() => {
    if (detached || viewportHeight === 0) return;
    const layout = layouts[activeKey];
    if (!layout) return;

    // The first placement, and any placement after a seek, snaps; following
    // the narration from one phrase to the next glides. Placements stay
    // instant for a moment after that too: web fonts finishing loading reflow
    // the text, and correcting for that must not show up as a slide.
    if (settledToken.current !== view.token) {
      settledToken.current = view.token;
      snapUntil.current = Date.now() + 700;
    }
    const snap = Date.now() < snapUntil.current;
    scroll.current?.scrollTo({
      y: Math.max(0, layout.y - viewportHeight * ANCHOR),
      animated: !snap && !reducedMotion,
    });
  }, [activeKey, layouts, viewportHeight, detached, view.token, reducedMotion]);

  // Touch drags are reported by the scroll view; a mouse wheel on web is not.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = (
      scroll.current as unknown as { getScrollableNode?: () => ScrollNode } | null
    )?.getScrollableNode?.();
    if (!node) return;
    const detach = () => setDetached(true);
    node.addEventListener('wheel', detach, { passive: true });
    return () => node.removeEventListener('wheel', detach);
  }, []);

  const items = shown.flatMap((segment) =>
    chunksFor(segment).map((chunk, index) => ({ key: `${segment.id}:${index}`, chunk })),
  );
  const activePosition = Math.max(
    0,
    items.findIndex((item) => item.key === activeKey),
  );

  // Development only: shows in Metro when the text mounts or rebuilds, and where.
  useEffect(() => {
    if (__DEV__) console.debug('Aldus read-along: window built', view.token, passage.current.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.token]);

  const handleMeasured = useCallback((key: string, y: number, height: number) => {
    setLayouts((current) => {
      const known = current[key];
      return known && known.y === y && known.height === height
        ? current
        : { ...current, [key]: { y, height } };
    });
  }, []);

  const handleSeek = useCallback(
    (startMS: number) => {
      setDetached(false);
      onSeek(startMS / 1000);
    },
    [onSeek],
  );

  return (
    <AnimatedView
      entering={fadeIn.delay(220)}
      exiting={fadeOut}
      className="mt-3 min-h-[220px] w-full flex-1 border-t border-line pt-2"
    >
      <View className="relative min-h-[160px] w-full flex-1">
        <ScrollView
          ref={scroll}
          scrollEnabled={scrollEnabled}
          bounces={false}
          alwaysBounceVertical={false}
          accessibilityLabel="Read along text"
          className="w-full flex-1"
          contentContainerClassName="pr-2 pt-4"
          contentContainerStyle={{ paddingBottom: Math.round(viewportHeight * (1 - ANCHOR)) }}
          onLayout={(event: LayoutChangeEvent) =>
            setViewportHeight(event.nativeEvent.layout.height)
          }
          onScrollBeginDrag={() => setDetached(true)}
        >
          {view.spacer > 0 ? <View style={{ height: view.spacer }} /> : null}
          {items.map((item, position) => (
            <ChunkBlock
              key={item.key}
              blockKey={item.key}
              chunk={item.chunk}
              active={item.key === activeKey}
              enterRank={Math.abs(position - activePosition)}
              onMeasured={handleMeasured}
              onSeek={handleSeek}
            />
          ))}
        </ScrollView>
        <EdgeFade edge="top" />
        <EdgeFade edge="bottom" />
        {detached ? (
          <View pointerEvents="box-none" className="absolute inset-x-0 bottom-3 items-center">
            <Button
              label="Back to narration"
              icon="moveDown"
              kind="primary"
              onPress={() => setDetached(false)}
            />
          </View>
        ) : null}
      </View>
    </AnimatedView>
  );
}

/** Flat stepped layers rather than a gradient: `expo-linear-gradient` is a native module a Metro reload can't add. */
function EdgeFade({ edge }: { edge: 'top' | 'bottom' }) {
  const layers = ['bg-canvas/95', 'bg-canvas/65', 'bg-canvas/30'];
  const ordered = edge === 'top' ? layers : [...layers].reverse();
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={`absolute inset-x-0 ${edge === 'top' ? 'top-0' : 'bottom-0'}`}
    >
      {ordered.map((layer) => (
        <View key={layer} className={`h-2.5 ${layer}`} />
      ))}
    </View>
  );
}

const ChunkBlock = memo(function ChunkBlock({
  blockKey,
  chunk,
  active,
  enterRank,
  onMeasured,
  onSeek,
}: {
  blockKey: string;
  chunk: ReadAlongChunk;
  active: boolean;
  enterRank: number;
  onMeasured: (key: string, y: number, height: number) => void;
  onSeek: (startMS: number) => void;
}) {
  const colors = useThemeColors();
  const progress = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    progress.set(withTiming(active ? 1 : 0, { duration: 260, reduceMotion: ReduceMotion.System }));
  }, [active, progress]);

  const textStyle = useAnimatedStyle(() => ({
    color: interpolateColor(progress.get(), [0, 1], [colors.muted, colors.ink]),
  }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={chunk.text}
      accessibilityHint="Plays the narration from here"
      accessibilityState={{ selected: active }}
      aria-selected={active}
      onLayout={(event: LayoutChangeEvent) =>
        onMeasured(blockKey, event.nativeEvent.layout.y, event.nativeEvent.layout.height)
      }
      onPress={() => onSeek(chunk.startMS)}
      className="rounded-control pb-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
    >
      <AnimatedText
        entering={phraseEnter(enterRank)}
        className="font-reading text-[22px] leading-[34px]"
        style={textStyle}
      >
        {chunk.text}
      </AnimatedText>
    </Pressable>
  );
});
