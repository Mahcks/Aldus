import { File, Paths } from 'expo-file-system';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { ReadiumView, type Locator, type ReadiumViewRef } from 'react-native-readium';
import type { AlignmentSegment } from '../generated/api';
import { mapReadiumLocator, parseReadiumLocator } from '../features/reader-spike/readium-locator';
import { colors } from '../features/theme';
import { Text, View } from '../features/tw';

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
    onLocation?: (location: ReaderLocation) => void;
    onReady?: () => void;
    onError?: (error: Error) => void;
  }
>(function EPUBReader({ source, segments = [], preferences, onLocation, onReady, onError }, ref) {
  const reader = useRef<ReadiumViewRef>(null);
  const onErrorRef = useRef(onError);
  const [fileURL, setFileURL] = useState('');
  onErrorRef.current = onError;

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
        const target = savedLocator(location);
        if (!target) return false;
        reader.current?.goTo(target);
        return true;
      },
    }),
    [],
  );

  function handleLocation(locator: Locator) {
    const sync = mapReadiumLocator(locator, segments as AlignmentSegment[]);
    onLocation?.({
      href: locator.href,
      cfi: JSON.stringify(locator),
      sync,
      syncState: sync ? 'full' : 'none',
      reason: 'relocate',
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
        theme: 'light',
      }}
      onLocationChange={handleLocation}
      onPublicationReady={onReady}
      style={{ flex: 1 }}
    />
  );
});
