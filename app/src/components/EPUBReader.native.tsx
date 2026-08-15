import { File, Paths } from 'expo-file-system';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ReadiumView,
  type Locator,
  type ReadiumViewRef,
  type SearchResult,
  type SelectionActionEvent,
} from 'react-native-readium';
import type { AlignmentSegment, EPUBLocator } from '../generated/api';
import {
  mapReadiumLocator,
  mapReadiumSelection,
  parseReadiumLocator,
  readiumSearchQuery,
  segmentForEPUBLocator,
} from '../features/reader-spike/readium-locator';
import { colors } from '../features/theme';
import { Text, View } from '../features/tw';
import { IconButton } from '../features/ui';

type ReaderLocation = {
  href: string;
  cfi: string;
  sync?: ReturnType<typeof mapReadiumLocator>;
  syncState?: 'full' | 'partial' | 'none';
  reason?: 'relocate' | 'forward' | 'explicit' | 'restore';
};
type ReaderPreferences = {
  layout: 'paginated' | 'scrolled';
  zoom: number;
  lineHeight: number;
  margin: number;
  theme: 'paper' | 'sepia';
};
type EPUBReaderHandle = {
  captureSelection: () => null;
  restoreSelection: () => Promise<string>;
  restoreLocation: (location: unknown, highlight?: boolean) => Promise<boolean>;
};

function savedLocator(value: unknown) {
  if (!value || typeof value !== 'object') return undefined;
  const stored = value as { cfi?: unknown };
  if (typeof stored.cfi !== 'string') return parseReadiumLocator(value);
  try {
    return parseReadiumLocator(JSON.parse(stored.cfi));
  } catch {
    return undefined;
  }
}

export const EPUBReader = forwardRef<
  EPUBReaderHandle,
  {
    source?: string | Blob;
    product?: boolean;
    segments?: unknown[];
    preferences?: ReaderPreferences;
    compactChrome?: boolean;
    statusLabel?: string;
    onLocation?: (location: ReaderLocation) => void;
    onReady?: () => void;
    onError?: (error: Error) => void;
  }
>(function EPUBReader(
  { source, segments = [], preferences, compactChrome, statusLabel, onLocation, onReady, onError },
  ref,
) {
  const insets = useSafeAreaInsets();
  const reader = useRef<ReadiumViewRef>(null);
  const onErrorRef = useRef(onError);
  const segmentsRef = useRef(segments);
  const lastProgression = useRef<number | undefined>(undefined);
  const direction = useRef<'forward' | 'backward' | undefined>(undefined);
  const locationRequest = useRef(0);
  const pendingRestore = useRef<EPUBLocator | undefined>(undefined);
  const [fileURL, setFileURL] = useState('');
  onErrorRef.current = onError;
  segmentsRef.current = segments;

  useEffect(() => {
    let active = true;
    async function prepare() {
      try {
        if (!source) return;
        if (typeof source === 'string') {
          setFileURL(source);
          return;
        }
        const file = new File(Paths.cache, 'aldus-current.epub');
        file.create({ overwrite: true });
        file.write(new Uint8Array(await source.arrayBuffer()));
        if (active) setFileURL(file.uri);
      } catch (cause) {
        if (active)
          onErrorRef.current?.(cause instanceof Error ? cause : new Error('Unable to open EPUB.'));
      }
    }
    setFileURL('');
    void prepare();
    return () => {
      active = false;
    };
  }, [source]);

  useImperativeHandle(
    ref,
    () => ({
      captureSelection: () => null,
      restoreSelection: async () => '',
      restoreLocation: async (location) => {
        const view = reader.current;
        if (!view) return false;
        const saved = savedLocator(location);
        if (saved) {
          view.goTo(saved);
          return true;
        }
        if (!location || typeof location !== 'object') return false;
        const target = location as EPUBLocator;
        const segment = segmentForEPUBLocator(target, segmentsRef.current as AlignmentSegment[]);
        if (!segment) return false;
        const query = readiumSearchQuery(segment, target.offset);
        if (!query) return false;
        if (
          typeof view.search !== 'function' ||
          typeof view.loadMoreSearchResults !== 'function' ||
          typeof view.cancelSearch !== 'function'
        ) {
          if (__DEV__) console.warn('Aldus native EPUB search bridge is unavailable.');
          onErrorRef.current?.(new Error('Synchronized navigation is unavailable on this device.'));
          return false;
        }
        try {
          let page = await view.search(query, {
            caseSensitive: false,
            diacriticSensitive: false,
            wholeWord: false,
          });
          if (!page.isSupported) return false;
          const matches: SearchResult[] = [];
          while (true) {
            matches.push(
              ...page.results.filter(
                (result) =>
                  normalizeHref(result.locator.href) === normalizeHref(segment.epub_href) &&
                  normalize(result.highlight ?? result.locator.text?.highlight ?? '') ===
                    normalize(query),
              ),
            );
            if (!page.hasMore || matches.length > 1) break;
            page = await view.loadMoreSearchResults();
          }
          if (matches.length !== 1) return false;
          pendingRestore.current = target;
          view.goTo(matches[0].locator);
          return true;
        } catch (cause) {
          if (__DEV__) console.warn('Aldus native EPUB search failed.', cause);
          onErrorRef.current?.(new Error('Synchronized navigation is unavailable on this device.'));
          return false;
        } finally {
          try {
            view.cancelSearch();
          } catch {
            // An older native binary has no search iterator to cancel.
          }
        }
      },
    }),
    [],
  );

  async function handleLocation(locator: Locator) {
    const request = ++locationRequest.current;
    const currentSegments = segmentsRef.current as AlignmentSegment[];
    const restored = pendingRestore.current;
    if (restored && normalizeHref(restored.href) === normalizeHref(locator.href)) {
      pendingRestore.current = undefined;
      onLocation?.({
        href: locator.href,
        cfi: JSON.stringify(locator),
        sync: restored,
        syncState: 'full',
        reason: 'restore',
      });
      return;
    }
    let visible: Locator | undefined;
    try {
      visible = await reader.current?.currentVisibleLocation();
    } catch {
      // The installed native client predates the visible-location bridge.
    }
    if (request !== locationRequest.current) return;
    const sync = mapReadiumLocator(visible ?? locator, currentSegments);
    if (__DEV__)
      console.debug('Aldus native EPUB location', {
        locator: visible ?? locator,
        segmentCount: currentSegments.length,
        sync,
      });
    const progression = locator.locations?.totalProgression;
    const reason =
      direction.current === 'forward' ||
      (progression != null &&
        lastProgression.current != null &&
        progression > lastProgression.current)
        ? 'forward'
        : 'relocate';
    direction.current = undefined;
    lastProgression.current = progression;
    onLocation?.({
      href: locator.href,
      cfi: JSON.stringify(locator),
      sync,
      syncState: sync ? 'full' : 'none',
      reason,
    });
  }

  function handleSelection(event: SelectionActionEvent) {
    locationRequest.current += 1;
    const currentSegments = segmentsRef.current as AlignmentSegment[];
    const sync = mapReadiumSelection(event.locator, event.selectedText, currentSegments);
    if (__DEV__)
      console.debug('Aldus native EPUB selection', {
        locator: event.locator,
        segmentCount: currentSegments.length,
        sync,
      });
    onLocation?.({
      href: event.locator.href,
      cfi: JSON.stringify(event.locator),
      sync,
      syncState: sync ? 'full' : 'none',
      reason: 'explicit',
    });
  }

  if (!fileURL)
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-paper">
        <ActivityIndicator color={colors.accent} />
        <Text className="text-sm text-muted">Opening EPUB…</Text>
      </View>
    );

  return (
    <View className="min-h-0 flex-1 bg-paper">
      <View className="min-h-0 flex-1">
        <ReadiumView
          ref={reader}
          file={{ url: fileURL }}
          preferences={{
            backgroundColor: colors.paper,
            textColor: colors.ink,
            scroll: preferences?.layout === 'scrolled',
            fontSize: preferences?.zoom,
            lineHeight: preferences?.lineHeight,
            pageMargins: preferences?.margin,
            theme: preferences?.theme === 'sepia' ? 'sepia' : 'light',
          }}
          selectionActions={[{ id: 'listen-here', label: 'Listen from here' }]}
          onLocationChange={handleLocation}
          onPublicationReady={onReady}
          onSelectionAction={handleSelection}
        />
      </View>
      {compactChrome || preferences?.layout !== 'scrolled' ? (
        <View
          className="min-h-12 shrink-0 flex-row items-center justify-between border-t border-line bg-paper px-2"
          style={compactChrome ? { paddingBottom: insets.bottom } : undefined}
        >
          {preferences?.layout !== 'scrolled' ? (
            <IconButton
              icon="previousPage"
              label="Previous page"
              kind="quiet"
              onPress={() => {
                direction.current = 'backward';
                reader.current?.goBackward();
              }}
            />
          ) : (
            <View className="h-11 w-11" />
          )}
          <Text
            accessibilityLiveRegion="polite"
            accessibilityLabel={
              statusLabel ? `Synchronization status: ${statusLabel}` : 'Page navigation'
            }
            numberOfLines={1}
            className="flex-shrink text-center text-xs text-muted"
          >
            {statusLabel ?? 'Page navigation'}
          </Text>
          {preferences?.layout !== 'scrolled' ? (
            <IconButton
              icon="nextPage"
              label="Next page"
              kind="quiet"
              onPress={() => {
                direction.current = 'forward';
                reader.current?.goForward();
              }}
            />
          ) : (
            <View className="h-11 w-11" />
          )}
        </View>
      ) : null}
    </View>
  );
});

const normalize = (value: string) =>
  value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const normalizeHref = (value: string) =>
  decodeURIComponent(value).replace(/^\/+/, '').split('#')[0];
