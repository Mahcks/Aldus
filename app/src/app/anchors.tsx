import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { EPUBReader, type EPUBReaderHandle, type ReaderCapture } from '../components/EPUBReader';
import { mediaURL } from '../lib/media';
import type { Anchor, AnchorFixture, SeekDiagnostic } from '../types/anchors';

const oldStorageKeys = ['aldus:alice:anchors:v1', 'aldus:alice:anchors:v2'];
const storageKey = 'aldus:alice:anchors:v3';
const persistenceVersion = 3;
const audioResource = 'alice-chapter-01.mp3';
const emptyFixture: AnchorFixture = {
  version: 1,
  epub_sha256: '6b79f2d23b804172816e81c463dbcea689593bbde63ef200d52b6c0da7ef629c',
  audio_sha256: '6c58be3679f82e5d20b2c5efea6f377ee0ed985a4e2b4dbd5201ea656312757a',
  koreader_document_hash: 'abb11be65399f96116fd90ab861dda0e',
  anchors: [],
};

export default function AnchorAuthoring() {
  const reader = useRef<EPUBReaderHandle>(null);
  const player = useAudioPlayer(mediaURL('alice-chapter-01.mp3'), { updateInterval: 50 });
  const status = useAudioPlayerStatus(player);
  const [fixture, setFixture] = useState(emptyFixture);
  const [capture, setCapture] = useState<ReaderCapture>();
  const [selectionVerified, setSelectionVerified] = useState(false);
  const [requestedMS, setRequestedMS] = useState(0);
  const [diagnostic, setDiagnostic] = useState<SeekDiagnostic>({
    requested_ms: 0,
    reported_ms: 0,
    difference_ms: 0,
  });
  const [editingID, setEditingID] = useState<string>();
  const [message, setMessage] = useState('Ready for a real Alice anchor.');

  useEffect(() => {
    Promise.all([
      ...oldStorageKeys.map((key) => AsyncStorage.removeItem(key)),
      AsyncStorage.getItem(storageKey),
    ]).then(async (values) => {
      const value = values.at(-1);
      if (!value) return;
      try {
        const stored = JSON.parse(value) as {
          persistence_version?: number;
          fixture?: AnchorFixture;
        };
        if (
          stored.persistence_version === persistenceVersion &&
          stored.fixture &&
          isAliceFixture(stored.fixture)
        ) {
          setFixture(stored.fixture);
          return;
        }
      } catch {}
      await AsyncStorage.removeItem(storageKey);
    });
  }, []);

  async function seek(target: number) {
    const requested = Math.max(
      0,
      Math.min(Math.round(status.duration * 1000 || 864310), Math.round(target)),
    );
    setRequestedMS(requested);
    await player.seekTo(requested / 1000, 0, 0);
    const reported = Math.round(player.currentTime * 1000);
    setDiagnostic({
      requested_ms: requested,
      reported_ms: reported,
      difference_ms: reported - requested,
    });
  }

  async function captureSelection() {
    const next = reader.current?.captureSelection();
    if (!next) return setMessage('Select some text in the book first.');
    setCapture(next);
    const restored = await reader.current?.restoreSelection(next);
    const exact = restored === next.text;
    setSelectionVerified(exact);
    setMessage(
      exact
        ? 'Captured and restored the exact browser selection.'
        : 'Capture failed its immediate restore check.',
    );
  }

  async function restoreSelection() {
    if (!capture) return;
    const restored = await reader.current?.restoreSelection(capture);
    const exact = restored === capture.text;
    setSelectionVerified(exact);
    setMessage(
      exact
        ? 'Restore exact: selected text matches the captured text.'
        : 'Restore failed: selected text differs from the captured text.',
    );
  }

  async function saveAnchor() {
    if (!capture || !selectionVerified)
      return setMessage('Capture and exactly restore an EPUB selection first.');
    const id = editingID || nextID(fixture.anchors);
    const anchor: Anchor = {
      id,
      text: capture.text,
      normalized_text: capture.normalized_text,
      epub: { href: capture.href, cfi: capture.cfi, start: capture.start, end: capture.end },
      audio: { resource: audioResource, timestamp_ms: requestedMS, seek: diagnostic },
      canonical: { segment_id: id, offset: 0 },
      koreader_xpointer: fixture.anchors.find((item) => item.id === id)?.koreader_xpointer ?? '',
    };
    const anchors = [...fixture.anchors.filter((item) => item.id !== id), anchor].sort(
      (a, b) => a.audio.timestamp_ms - b.audio.timestamp_ms,
    );
    const next = { ...fixture, anchors };
    setFixture(next);
    await persist(next);
    setEditingID(undefined);
    setMessage(`Saved ${id} locally. Export to update the repository fixture.`);
  }

  function edit(anchor: Anchor) {
    setEditingID(anchor.id);
    setCapture({ ...anchor.epub, text: anchor.text, normalized_text: anchor.normalized_text });
    setSelectionVerified(true);
    setRequestedMS(anchor.audio.timestamp_ms);
    setDiagnostic(anchor.audio.seek);
    setMessage(`Editing ${anchor.id}`);
  }

  async function remove(id: string) {
    const next = { ...fixture, anchors: fixture.anchors.filter((anchor) => anchor.id !== id) };
    setFixture(next);
    await persist(next);
  }

  function exportFixture() {
    if (Platform.OS !== 'web') return;
    const blob = new Blob([`${JSON.stringify(fixture, null, 2)}\n`], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'anchors.json';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Alice anchor authoring</Text>
          <Text style={styles.message}>{message}</Text>
        </View>
        <View style={styles.headerActions}>
          <Text style={styles.count}>{fixture.anchors.length} anchors</Text>
          <Pressable style={styles.primary} onPress={exportFixture}>
            <Text style={styles.primaryText}>Export JSON</Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.workspace}>
        <View style={styles.reader}>
          <EPUBReader ref={reader} source={mediaURL('alice.epub')} />
        </View>
        <ScrollView style={styles.inspector} contentContainerStyle={styles.inspectorContent}>
          <View style={styles.workflow}>
            <Text style={styles.step}>
              1. Highlight a passage in the real Alice EPUB, then capture the selection.
            </Text>
            <Text style={styles.step}>2. Play or seek the audiobook to that sentence.</Text>
            <Text style={styles.step}>3. Click Save Anchor.</Text>
          </View>

          <Button label="Capture selection" onPress={captureSelection} primary />

          <Text style={styles.sectionTitle}>Captured Alice passage</Text>
          <TextInput
            multiline
            editable={false}
            value={capture?.text || 'Highlight a passage in Alice, then click Capture selection.'}
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

          <Text style={styles.sectionTitle}>Alice audiobook · Chapter 1</Text>
          <Text style={styles.clock}>{formatMS(Math.round(status.currentTime * 1000))}</Text>
          <Text style={styles.mono}>
            {Math.round(status.currentTime * 1000)} ms / {Math.round(status.duration * 1000)} ms
          </Text>
          <View style={styles.controls}>
            <Button
              label={status.playing ? 'Pause' : 'Play'}
              onPress={() => (status.playing ? player.pause() : player.play())}
              primary
              disabled={!selectionVerified}
            />
            <Button
              label="Capture current"
              disabled={!selectionVerified}
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
                disabled={!selectionVerified}
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
              disabled={!selectionVerified}
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
            disabled={!selectionVerified}
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
              <Button label="Edit" onPress={() => edit(anchor)} />
              <Button label="Delete" onPress={() => remove(anchor.id)} danger />
            </View>
          ))}
        </ScrollView>
      </View>
    </SafeAreaView>
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
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        primary && styles.primary,
        danger && styles.danger,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.buttonText, primary && styles.primaryText, danger && styles.dangerText]}>
        {label}
      </Text>
    </Pressable>
  );
}

function nextID(anchors: Anchor[]) {
  return `alice-ch01-${String(Math.max(0, ...anchors.map((anchor) => Number(anchor.id.split('-').at(-1)) || 0)) + 1).padStart(2, '0')}`;
}
function persist(fixture: AnchorFixture) {
  return AsyncStorage.setItem(
    storageKey,
    JSON.stringify({ persistence_version: persistenceVersion, fixture }),
  );
}
function isAliceFixture(fixture: AnchorFixture) {
  return (
    fixture.version === 1 &&
    fixture.epub_sha256 === emptyFixture.epub_sha256 &&
    fixture.audio_sha256 === emptyFixture.audio_sha256 &&
    Array.isArray(fixture.anchors) &&
    fixture.anchors.every(
      (anchor) =>
        anchor.epub?.href?.startsWith('OEBPS/') &&
        anchor.epub.start?.dom_path &&
        anchor.epub.end?.dom_path &&
        typeof anchor.normalized_text === 'string' &&
        anchor.audio?.resource === audioResource,
    )
  );
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
