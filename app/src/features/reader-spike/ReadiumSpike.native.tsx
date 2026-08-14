import { File, Paths } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import {
  ReadiumView,
  type Locator,
  type PublicationReadyEvent,
  type ReadiumViewRef,
  type SelectionActionEvent,
} from 'react-native-readium';
import type { AlignmentSegment, CanonicalPosition } from '../../generated/api';
import { api } from '../../lib/api';
import { colors } from '../theme';
import { ScrollView, Text, View } from '../tw';
import { Button, Notice } from '../ui';
import {
  deserializeReadiumLocator,
  mapReadiumLocator,
  serializeReadiumLocator,
} from './readium-locator';

const ALICE_MEDIA_ID = 'alice-gutenberg-11-epub-media';
const ALICE_ALIGNMENT_ID = 'alice-hybrid-whisperx-alignment';

export function ReadiumSpike() {
  const reader = useRef<ReadiumViewRef>(null);
  const [fileURL, setFileURL] = useState('');
  const [segments, setSegments] = useState<AlignmentSegment[]>([]);
  const [positions, setPositions] = useState<Locator[]>([]);
  const [current, setCurrent] = useState<Locator>();
  const [saved, setSaved] = useState('');
  const [canonical, setCanonical] = useState<CanonicalPosition>();
  const [mounted, setMounted] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function prepare() {
      try {
        const [blob, alignment] = await Promise.all([
          api.mediaBlob(ALICE_MEDIA_ID),
          api.alignment(ALICE_ALIGNMENT_ID),
        ]);
        const file = new File(Paths.cache, 'aldus-readium-alice.epub');
        file.create({ overwrite: true });
        file.write(new Uint8Array(await blob.arrayBuffer()));
        if (!active) return;
        setFileURL(file.uri);
        setSegments(alignment.segments);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Unable to prepare Alice.');
      }
    }
    void prepare();
    return () => {
      active = false;
    };
  }, []);

  const handleLocation = useCallback((locator: Locator) => {
    setCurrent(locator);
    if (__DEV__) console.debug('Readium spike location', locator);
  }, []);

  const handleReady = useCallback((publication: PublicationReadyEvent) => {
    setPositions(publication.positions);
    if (__DEV__) console.debug('Readium spike publication', publication.metadata.title);
  }, []);

  const handleSelection = useCallback(
    async (event: SelectionActionEvent) => {
      const target = mapReadiumLocator(event.locator, segments);
      if (__DEV__) console.debug('Readium spike selection', event);
      if (!target) {
        setCanonical(undefined);
        setError('The selected passage did not map uniquely to an aligned Alice segment.');
        return;
      }
      try {
        setError('');
        setCanonical(await api.epubToCanonical(ALICE_ALIGNMENT_ID, target));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Canonical mapping failed.');
      }
    },
    [segments],
  );

  function saveLocation() {
    if (current) setSaved(serializeReadiumLocator(current));
  }

  function reopen() {
    setMounted(false);
    setCanonical(undefined);
    requestAnimationFrame(() => setMounted(true));
  }

  function goToKnownPosition() {
    const target = positions[Math.min(10, positions.length - 1)];
    if (target) reader.current?.goTo(target);
  }

  const initialLocation = deserializeReadiumLocator(saved);

  return (
    <View className="flex-1 bg-canvas">
      <View className="flex-row flex-wrap gap-2 border-b border-line bg-paper p-3">
        <Button label="Previous" kind="secondary" onPress={() => reader.current?.goBackward()} />
        <Button label="Next" kind="secondary" onPress={() => reader.current?.goForward()} />
        <Button label="Save location" kind="secondary" disabled={!current} onPress={saveLocation} />
        <Button label="Reopen saved" kind="secondary" disabled={!saved} onPress={reopen} />
        <Button
          label="Go to known position"
          kind="secondary"
          disabled={!positions.length}
          onPress={goToKnownPosition}
        />
      </View>

      {error ? <Notice danger>{error}</Notice> : null}
      {!fileURL ? (
        <View className="flex-1 items-center justify-center gap-3">
          <ActivityIndicator color={colors.accent} />
          <Text className="text-sm text-muted">Preparing frozen Alice EPUB…</Text>
        </View>
      ) : mounted ? (
        <ReadiumView
          ref={reader}
          file={{ url: fileURL, initialLocation }}
          preferences={{
            backgroundColor: colors.paper,
            textColor: colors.ink,
            pageMargins: 1,
            scroll: false,
            theme: 'light',
          }}
          selectionActions={[{ id: 'capture', label: 'Capture for sync' }]}
          onLocationChange={handleLocation}
          onPublicationReady={handleReady}
          onSelectionAction={handleSelection}
          style={{ flex: 1 }}
        />
      ) : (
        <View className="flex-1" />
      )}

      <ScrollView className="max-h-44 border-t border-line bg-paper p-3">
        <Text selectable className="font-mono text-xs leading-5 text-muted">
          {JSON.stringify({ current, saved: initialLocation, canonical }, null, 2)}
        </Text>
      </ScrollView>
    </View>
  );
}
