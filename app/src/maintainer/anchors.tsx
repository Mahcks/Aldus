import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  EPUBReader,
  type EPUBReaderHandle,
  type ReaderCapture,
} from '@/components/consumption/reader/EPUBReader';
import { Button as SharedButton, LoadingState, ErrorState } from '@/components/ui';
import { View as TWView } from '@/components/ui/tw';
import { FixturePicker, type AuthoringMedia } from '@/maintainer/FixturePicker';
import { emptyFixture, samePassage, storageKeys, validAnchors } from '@/maintainer/fixtures';
import type { Anchor, AnchorFixture, SeekDiagnostic } from '@/maintainer/anchors.types';

export default function AnchorAuthoring() {
  return (
    <FixturePicker>
      {(media) => <AnchorWorkspace key={media.definition.id} {...media} />}
    </FixturePicker>
  );
}

function AnchorWorkspace({ definition, epub, audio }: AuthoringMedia) {
  const storageKey = storageKeys(definition).anchors;
  const reader = useRef<EPUBReaderHandle>(null);
  const player = useAudioPlayer(audio, { updateInterval: 50 });
  const status = useAudioPlayerStatus(player);
  const [fixture, setFixture] = useState(() => emptyFixture(definition));
  const [capture, setCapture] = useState<ReaderCapture>();
  const [selectionVerified, setSelectionVerified] = useState(false);
  const [requestedMS, setRequestedMS] = useState(0);
  const [diagnostic, setDiagnostic] = useState<SeekDiagnostic>({
    requested_ms: 0,
    reported_ms: 0,
    difference_ms: 0,
  });
  const [editingID, setEditingID] = useState<string>();
  const [message, setMessage] = useState('Select a passage to begin.');

  const [loadError, setLoadError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(storageKey)
      .then((value) => {
        if (!active || !value) return;
        const stored = JSON.parse(value) as { persistence_version?: number; fixture?: unknown };
        if (stored.persistence_version !== 3 || !validAnchors(stored.fixture, definition)) {
          throw new Error('Saved anchors do not match this fixture. They have not been deleted.');
        }
        setFixture(stored.fixture);
      })
      .catch((error: unknown) => {
        if (active)
          setLoadError(error instanceof Error ? error.message : 'Could not load saved anchors.');
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [definition, storageKey]);

  async function persist(next: AnchorFixture) {
    await AsyncStorage.setItem(
      storageKey,
      JSON.stringify({ persistence_version: 3, fixture: next }),
    );
    setFixture(next);
  }

  async function seek(target: number) {
    const requested = Math.max(
      0,
      Math.min(Math.round(status.duration * 1000 || target), Math.round(target)),
    );
    setRequestedMS(requested);
    try {
      await player.seekTo(requested / 1000, 0, 0);
    } catch {
      setMessage('Could not seek the audiobook. Wait for it to load and retry.');
      return;
    }
    const reported = Math.round(player.currentTime * 1000);
    setDiagnostic({
      requested_ms: requested,
      reported_ms: reported,
      difference_ms: reported - requested,
    });
  }

  async function captureSelection() {
    setSelectionVerified(false);
    try {
      const next = reader.current?.captureSelection();
      if (!next) return setMessage('Select some text in the book first.');
      setCapture(next);
      const restored = await reader.current?.restoreSelection(next);
      const restoredCapture = reader.current?.captureSelection();
      const exact =
        restored === next.text && Boolean(restoredCapture && samePassage(next, restoredCapture));
      setSelectionVerified(exact);
      setMessage(
        exact
          ? 'Captured and restored the exact browser selection.'
          : 'Capture failed its immediate restore check.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not restore this passage.');
    }
  }

  async function restoreSelection() {
    setSelectionVerified(false);
    try {
      if (!capture) return;
      const restored = await reader.current?.restoreSelection(capture);
      const restoredCapture = reader.current?.captureSelection();
      const exact =
        restored === capture.text &&
        Boolean(restoredCapture && samePassage(capture, restoredCapture));
      setSelectionVerified(exact);
      setMessage(
        exact
          ? 'Restore exact: selected text and DOM boundaries match.'
          : 'Restore failed: selected text or DOM boundaries differ.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not restore this passage.');
    }
  }

  async function saveAnchor() {
    if (!capture || !selectionVerified)
      return setMessage('Capture and exactly restore an EPUB selection first.');
    if (
      !Number.isSafeInteger(requestedMS) ||
      requestedMS < 0 ||
      diagnostic.requested_ms !== requestedMS
    )
      return setMessage('Use Seek + capture to verify the requested timestamp before saving.');
    const id = editingID || nextID(fixture.anchors, definition.prefix);
    const anchor: Anchor = {
      id,
      text: capture.text,
      normalized_text: capture.normalized_text,
      epub: { href: capture.href, cfi: capture.cfi, start: capture.start, end: capture.end },
      audio: { resource: definition.audio, timestamp_ms: requestedMS, seek: diagnostic },
      canonical: { segment_id: id, offset: 0 },
      koreader_xpointer: fixture.anchors.find((item) => item.id === id)?.koreader_xpointer ?? '',
    };
    const anchors = [...fixture.anchors.filter((item) => item.id !== id), anchor].sort(
      (a, b) => a.audio.timestamp_ms - b.audio.timestamp_ms,
    );
    const next = { ...fixture, anchors };
    setSaving(true);
    try {
      await persist(next);
      setEditingID(undefined);
      setMessage(`Saved ${id} locally. Export to update the repository fixture.`);
    } catch {
      setMessage('Could not save this anchor. Keep this page open and retry.');
    } finally {
      setSaving(false);
    }
  }

  function edit(anchor: Anchor) {
    setEditingID(anchor.id);
    setCapture({ ...anchor.epub, text: anchor.text, normalized_text: anchor.normalized_text });
    setSelectionVerified(false);
    setRequestedMS(anchor.audio.timestamp_ms);
    setDiagnostic(anchor.audio.seek);
    setMessage(`Editing ${anchor.id}`);
  }

  async function remove(id: string) {
    const next = { ...fixture, anchors: fixture.anchors.filter((anchor) => anchor.id !== id) };
    setSaving(true);
    try {
      await persist(next);
      if (editingID === id) {
        setEditingID(undefined);
        setCapture(undefined);
        setSelectionVerified(false);
      }
    } catch {
      setMessage('Could not delete the saved anchor. Please retry.');
    } finally {
      setSaving(false);
    }
  }

  function exportFixture() {
    if (Platform.OS !== 'web') return;
    const blob = new Blob([`${JSON.stringify(fixture, null, 2)}\n`], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download =
      definition.id === 'alice-ch01-control' ? 'anchors.json' : `${definition.id}-anchors.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  if (loadError)
    return (
      <ErrorState title="Saved anchors could not be loaded">
        {loadError} Export or repair the stored data before continuing; reload to retry.
      </ErrorState>
    );
  if (!loaded) return <LoadingState label="Loading saved anchors" />;

  return (
    <TWView className="flex-1 bg-canvas">
      <View style={styles.header}>
        <TWView className="max-w-full">
          <Text style={styles.title}>{definition.label}: anchor authoring</Text>
          <Text style={styles.message}>{message}</Text>
        </TWView>
        <View style={styles.headerActions}>
          <Text style={styles.count}>{fixture.anchors.length} anchors</Text>
          <Button label="Export JSON" onPress={exportFixture} primary />
        </View>
      </View>
      <TWView className="flex-1 flex-col min-[820px]:flex-row">
        <TWView className="min-h-[400px] flex-1 p-4 min-[820px]:flex-[3]">
          <EPUBReader ref={reader} source={epub} onError={(error) => setMessage(error.message)} />
        </TWView>
        <ScrollView style={styles.inspector} contentContainerStyle={styles.inspectorContent}>
          <View style={styles.workflow}>
            <Text style={styles.step}>
              1. Highlight a passage in the selected EPUB, then capture the selection.
            </Text>
            <Text style={styles.step}>2. Play or seek the audiobook to that sentence.</Text>
            <Text style={styles.step}>3. Click Save Anchor.</Text>
          </View>

          <Button label="Capture selection" onPress={captureSelection} primary />

          <Text style={styles.sectionTitle}>Captured passage</Text>
          <TextInput
            multiline
            editable={false}
            value={
              capture?.text || 'Highlight a passage in the book, then click Capture selection.'
            }
            style={[styles.input, styles.capturedText]}
          />
          <Text style={styles.mono}>
            {capture?.href || '—'}
            {capture
              ? `\nstart ${capture.start.dom_path}:${capture.start.node_offset}\nend ${capture.end.dom_path}:${capture.end.node_offset}\n${capture.cfi}\nnormalized: ${capture.normalized_text}`
              : ''}
          </Text>
          <Button
            label="Restore captured selection"
            onPress={restoreSelection}
            disabled={!capture}
          />

          <Text style={styles.sectionTitle}>{definition.audio}</Text>
          <Text style={styles.clock}>{formatMS(Math.round(status.currentTime * 1000))}</Text>
          <Text style={styles.mono}>
            {Math.round(status.currentTime * 1000)} ms / {Math.round(status.duration * 1000)} ms
          </Text>
          <View style={styles.controls}>
            <Button
              label={status.playing ? 'Pause' : 'Play'}
              onPress={() => (status.playing ? player.pause() : player.play())}
              primary
              disabled={!selectionVerified || saving}
            />
            <Button
              label="Capture current"
              disabled={!selectionVerified || saving}
              onPress={() => {
                const current = Math.round(player.currentTime * 1000);
                setRequestedMS(current);
                setDiagnostic({ requested_ms: current, reported_ms: current, difference_ms: 0 });
              }}
            />
            {[-5000, -1000, -250, 250, 1000, 5000].map((amount) => (
              <Button
                key={amount}
                label={`${amount > 0 ? '+' : ''}${amount}`}
                disabled={!selectionVerified || saving}
                onPress={() => seek(requestedMS + amount)}
              />
            ))}
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Requested timestamp (ms)</Text>
            <TextInput
              editable={selectionVerified}
              keyboardType="numeric"
              value={String(requestedMS)}
              onChangeText={(value) => setRequestedMS(Number(value.replace(/\D/g, '')) || 0)}
              onSubmitEditing={() => seek(requestedMS)}
              style={styles.input}
            />
            <Button
              label="Seek + capture"
              disabled={!selectionVerified || saving}
              onPress={() => seek(requestedMS)}
            />
          </View>
          <Text style={styles.mono}>
            reported {diagnostic.reported_ms} ms · difference {signed(diagnostic.difference_ms)} ms
          </Text>

          <Button
            label={editingID ? 'Update anchor' : 'Save anchor'}
            onPress={saveAnchor}
            primary
            disabled={!selectionVerified || saving}
          />

          <Text style={styles.sectionTitle}>Saved anchors</Text>
          {fixture.anchors.map((anchor) => (
            <View key={anchor.id} style={styles.anchorRow}>
              <View style={styles.anchorText}>
                <Text style={styles.anchorID}>
                  {anchor.id} · {anchor.audio.timestamp_ms} ms
                </Text>
                <Text numberOfLines={2} style={styles.anchorPassage}>
                  {anchor.text}
                </Text>
              </View>
              <Button label="Edit" onPress={() => edit(anchor)} disabled={saving} />
              <Button label="Delete" onPress={() => remove(anchor.id)} danger disabled={saving} />
            </View>
          ))}
        </ScrollView>
      </TWView>
    </TWView>
  );
}

function Button({
  label,
  onPress,
  primary,
  danger,
  disabled,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <SharedButton
      label={label}
      onPress={onPress}
      disabled={disabled}
      kind={danger ? 'danger' : primary ? 'primary' : 'secondary'}
    />
  );
}

function nextID(anchors: Anchor[], prefix: string) {
  return `${prefix}-${String(Math.max(0, ...anchors.map((anchor) => Number(anchor.id.split('-').at(-1)) || 0)) + 1).padStart(2, '0')}`;
}
function formatMS(ms: number) {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}
function signed(ms: number) {
  return `${ms >= 0 ? '+' : ''}${ms}`;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f5f0e7' },
  header: {
    minHeight: 72,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#c9c0b3',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: { color: '#29231d', fontSize: 20, fontWeight: '700' },
  message: { color: '#655b51', fontSize: 12, marginTop: 3 },
  headerActions: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  count: { color: '#655b51', fontVariant: ['tabular-nums'] },
  workspace: { flex: 1, flexDirection: 'row' },
  reader: { flex: 3, padding: 16, borderRightWidth: 1, borderRightColor: '#c9c0b3' },
  inspector: { flex: 2, backgroundColor: '#eee7dc' },
  inspectorContent: { padding: 18, gap: 10 },
  sectionTitle: {
    color: '#29231d',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 10,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#c9c0b3',
  },
  workflow: { gap: 5, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#c9c0b3' },
  step: { color: '#40372f', fontSize: 13, lineHeight: 19, fontWeight: '600' },
  clock: { color: '#29231d', fontSize: 34, fontWeight: '600', fontVariant: ['tabular-nums'] },
  mono: { color: '#655b51', fontSize: 11, lineHeight: 17, fontFamily: 'monospace' },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  button: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#b7ac9e',
    borderRadius: 6,
    backgroundColor: '#f8f4ed',
  },
  buttonText: { color: '#40372f', fontSize: 12, fontWeight: '600' },
  primary: {
    backgroundColor: '#8b3a24',
    borderColor: '#8b3a24',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  primaryText: { color: '#fffaf2', fontSize: 12, fontWeight: '700' },
  danger: { borderColor: '#9c5547', backgroundColor: 'transparent' },
  dangerText: { color: '#81392d' },
  disabled: { opacity: 0.45 },
  field: { gap: 5 },
  label: { color: '#40372f', fontSize: 12, fontWeight: '600' },
  input: {
    backgroundColor: '#fffdf9',
    borderWidth: 1,
    borderColor: '#b7ac9e',
    borderRadius: 5,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: '#29231d',
    fontFamily: 'monospace',
  },
  capturedText: { minHeight: 84, textAlignVertical: 'top' },
  anchorRow: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#c9c0b3',
  },
  anchorText: { flex: 1 },
  anchorID: { color: '#29231d', fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  anchorPassage: { color: '#655b51', fontSize: 12, lineHeight: 17, marginTop: 2 },
});
