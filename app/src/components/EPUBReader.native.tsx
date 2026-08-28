import { File, Paths } from 'expo-file-system';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ReadiumView,
  type DecorationGroup,
  type Link,
  type Locator,
  type Preferences,
  type PublicationReadyEvent,
  type ReadiumViewRef,
  type SearchResult,
  type SelectionActionEvent,
} from 'react-native-readium';
import type { AlignmentSegment, EPUBLocator } from '@/generated/api';
import {
  mapReadiumLocator,
  mapReadiumSelection,
  parseReadiumLocator,
  preferredReadiumLocator,
  readiumLocationReason,
  readiumResumeDecorations,
  readiumRestoreDisposition,
  readiumSearchQueries,
  segmentForEPUBLocator,
} from '@/features/reader-spike/readium-locator';
import { colors } from '@/features/theme';
import { flattenReaderContents } from '@/features/reader-navigation';
import { Text, View } from '@/features/tw';
import { IconButton } from '@/features/ui';

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
  theme: 'paper' | 'sepia' | 'night';
  fontFamily: 'publisher' | 'serif' | 'sans' | 'dyslexic';
};
export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  layout: 'paginated',
  zoom: 1,
  lineHeight: 1.72,
  margin: 2,
  theme: 'paper',
  fontFamily: 'serif',
};
export type ReaderNavigationItem = { title: string; location: unknown; depth: number };
export type ReaderSearchResult = { title: string; excerpt: string; location: unknown };
export type EPUBReaderHandle = {
  captureSelection: () => null;
  restoreSelection: () => Promise<string>;
  restoreLocation: (location: unknown, highlight?: boolean) => Promise<boolean>;
  navigate: (location: unknown) => Promise<boolean>;
  search: (query: string) => Promise<ReaderSearchResult[]>;
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
    onListenFromLocation?: (location: ReaderLocation) => void;
    onReady?: (contents: ReaderNavigationItem[]) => void;
    onError?: (error: Error) => void;
  }
>(function EPUBReader(
  {
    source,
    segments = [],
    preferences = DEFAULT_READER_PREFERENCES,
    compactChrome,
    statusLabel,
    onLocation,
    onListenFromLocation,
    onReady,
    onError,
  },
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
  const [resumeDecorations, setResumeDecorations] = useState<DecorationGroup[]>([]);
  const readiumPreferences = useMemo<Preferences>(
    () => ({
      backgroundColor: preferences.theme === 'night' ? colors.readerNightPaper : colors.paper,
      textColor: preferences.theme === 'night' ? colors.readerNightInk : colors.ink,
      scroll: preferences.layout === 'scrolled',
      fontSize: preferences.zoom,
      fontFamily:
        preferences.fontFamily === 'publisher'
          ? undefined
          : preferences.fontFamily === 'sans'
            ? 'sans-serif'
            : preferences.fontFamily === 'dyslexic'
              ? 'OpenDyslexic'
              : 'serif',
      lineHeight: preferences.lineHeight,
      pageMargins: preferences.margin,
      theme:
        preferences.theme === 'night'
          ? ('dark' as const)
          : preferences.theme === 'sepia'
            ? ('sepia' as const)
            : ('light' as const),
    }),
    [
      preferences.fontFamily,
      preferences.layout,
      preferences.lineHeight,
      preferences.margin,
      preferences.theme,
      preferences.zoom,
    ],
  );
  onErrorRef.current = onError;
  segmentsRef.current = segments;

  useEffect(() => {
    let active = true;
    locationRequest.current += 1;
    pendingRestore.current = undefined;
    setResumeDecorations([]);
    direction.current = undefined;
    lastProgression.current = undefined;
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
      navigate: async (location) => {
        const view = reader.current;
        if (!view || !location || typeof location !== 'object') return false;
        pendingRestore.current = undefined;
        setResumeDecorations([]);
        direction.current = 'backward';
        view.goTo(location as Locator);
        return true;
      },
      search: async (query) => {
        const view = reader.current;
        if (!view || !query.trim()) return [];
        try {
          let page = await view.search(query.trim(), {
            caseSensitive: false,
            diacriticSensitive: false,
          });
          if (!page.isSupported) return [];
          const results: SearchResult[] = [];
          for (let pageCount = 0; pageCount < 100 && results.length < 100; pageCount += 1) {
            results.push(...page.results.slice(0, 100 - results.length));
            if (!page.hasMore) break;
            page = await view.loadMoreSearchResults();
          }
          return results.map((result) => ({
            title: result.locator.title?.trim() || 'Search result',
            excerpt: [result.before, result.highlight, result.after].filter(Boolean).join(''),
            location: result.locator,
          }));
        } finally {
          try {
            view.cancelSearch();
          } catch {
            // Older native reader binaries may not implement search cleanup yet.
          }
        }
      },
      restoreLocation: async (location, highlight = false) => {
        const view = reader.current;
        if (!view) {
          if (__DEV__) console.debug('Aldus native EPUB restore skipped: reader is not ready');
          return false;
        }
        const saved = savedLocator(location);
        if (saved) {
          if (__DEV__) console.debug('Aldus native EPUB restoring saved Readium locator', saved);
          setResumeDecorations([]);
          view.goTo(saved);
          return true;
        }
        if (!location || typeof location !== 'object') {
          if (__DEV__) console.debug('Aldus native EPUB restore skipped: invalid target', location);
          return false;
        }
        const target = location as EPUBLocator;
        const segment = segmentForEPUBLocator(target, segmentsRef.current as AlignmentSegment[]);
        if (!segment) {
          if (__DEV__)
            console.debug('Aldus native EPUB restore skipped: alignment segment not found', target);
          return false;
        }
        const queries = readiumSearchQueries(
          segment,
          target.offset,
          segmentsRef.current as AlignmentSegment[],
        );
        if (!queries[0]) {
          if (__DEV__)
            console.debug('Aldus native EPUB restore skipped: empty search query', target);
          return false;
        }
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
          let matches: SearchResult[] = [];
          let matchedQuery = '';
          for (const query of queries) {
            let page = await view.search(query, {
              caseSensitive: false,
              diacriticSensitive: false,
              wholeWord: !query.includes(' '),
            });
            if (!page.isSupported) {
              if (__DEV__)
                console.debug('Aldus native EPUB restore skipped: search is unsupported');
              pendingRestore.current = undefined;
              return false;
            }
            matches = [];
            for (let pageCount = 0; pageCount < 100; pageCount += 1) {
              matches.push(
                ...page.results.filter(
                  (result) => readiumRestoreDisposition(target, result.locator.href) === 'restore',
                ),
              );
              if (!page.hasMore || matches.length > 1) break;
              page = await view.loadMoreSearchResults();
            }
            if (page.hasMore && matches.length <= 1) matches = [];
            if (matches.length === 1) {
              matchedQuery = query;
              break;
            }
          }
          if (matches.length !== 1) {
            if (__DEV__)
              console.debug('Aldus native EPUB restore search was not unique', {
                href: target.href,
                queries,
                matches: matches.length,
              });
            pendingRestore.current = undefined;
            return false;
          }
          if (__DEV__)
            console.debug('Aldus native EPUB restoring canonical target', {
              segment_id: segment.id,
              offset: target.offset,
              href: target.href,
              query: matchedQuery,
            });
          pendingRestore.current = target;
          setResumeDecorations(
            readiumResumeDecorations(matches[0].locator, highlight, colors.accentSoft),
          );
          view.goTo(matches[0].locator);
          return true;
        } catch (cause) {
          pendingRestore.current = undefined;
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
    const restoreDisposition = readiumRestoreDisposition(restored, locator.href);
    if (restoreDisposition === 'suppress') return;
    let visible: Locator | undefined;
    try {
      visible = await reader.current?.currentVisibleLocation();
    } catch {
      // The installed native client predates the visible-location bridge.
    }
    if (request !== locationRequest.current) return;
    const readingLocator = preferredReadiumLocator(locator, visible);
    const sync = mapReadiumLocator(readingLocator, currentSegments);
    if (restoreDisposition === 'restore' && restored) {
      pendingRestore.current = undefined;
      onLocation?.({
        href: readingLocator.href,
        cfi: JSON.stringify(readingLocator),
        sync: restored,
        syncState: 'full',
        reason: 'restore',
      });
      return;
    }
    if (__DEV__)
      console.debug('Aldus native EPUB location', {
        locator: visible ?? locator,
        segmentCount: currentSegments.length,
        sync,
      });
    const progression =
      locator.locations?.totalProgression ??
      locator.locations?.position ??
      locator.locations?.progression;
    const disposition = readiumLocationReason(
      direction.current,
      progression,
      lastProgression.current,
      Boolean(sync),
    );
    direction.current = disposition.pendingDirection;
    if (sync) lastProgression.current = progression;
    onLocation?.({
      href: readingLocator.href,
      cfi: JSON.stringify(readingLocator),
      sync,
      syncState: sync ? 'full' : 'none',
      reason: disposition.reason,
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
    const location: ReaderLocation = {
      href: event.locator.href,
      cfi: JSON.stringify(event.locator),
      sync,
      syncState: sync ? 'full' : 'none',
      reason: 'explicit',
    };
    onLocation?.(location);
    if (event.actionId === 'listen-here') onListenFromLocation?.(location);
  }

  function handleReady(event?: PublicationReadyEvent) {
    onReady?.(
      flattenReaderContents(event?.tableOfContents as Link[] | undefined).map((item) => ({
        title: item.title,
        location: { href: item.href, type: 'application/xhtml+xml', title: item.title },
        depth: item.depth,
      })),
    );
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
          key={fileURL}
          ref={reader}
          file={{ url: fileURL }}
          preferences={readiumPreferences}
          decorations={resumeDecorations}
          selectionActions={[{ id: 'listen-here', label: 'Listen from here' }]}
          onLocationChange={handleLocation}
          onPublicationReady={handleReady}
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
                pendingRestore.current = undefined;
                setResumeDecorations([]);
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
                pendingRestore.current = undefined;
                setResumeDecorations([]);
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
