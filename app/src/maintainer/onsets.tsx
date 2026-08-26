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

import { mediaURL } from '../lib/media';
import type { AnchorFixture, OnsetAnchor, OnsetFixture } from '../maintainer/anchors.types';

const sourceStorageKey = 'aldus:alice:anchors:v3';
const storageKey = 'aldus:alice:onsets:v1';
const epubSHA = '6b79f2d23b804172816e81c463dbcea689593bbde63ef200d52b6c0da7ef629c';
const audioSHA = '6c58be3679f82e5d20b2c5efea6f377ee0ed985a4e2b4dbd5201ea656312757a';

export default function OnsetAuthoring() {
  const player = useAudioPlayer(mediaURL('alice-chapter-01.mp3'), { updateInterval: 20 });
  const status = useAudioPlayerStatus(player);
  const loopEnd = useRef<number | undefined>(undefined);
  const [source, setSource] = useState<AnchorFixture>();
  const [annotations, setAnnotations] = useState<OnsetAnchor[]>([]);
  const [index, setIndex] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [windowMS, setWindowMS] = useState(250);
  const [notes, setNotes] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState('Load the existing manual anchors to begin.');

  const anchor = source?.anchors[index];

  useEffect(() => {
    Promise.all([AsyncStorage.getItem(sourceStorageKey), AsyncStorage.getItem(storageKey)]).then(
      ([sourceValue, onsetValue]) => {
        let fixture: AnchorFixture | undefined;
        let savedOnsets: OnsetAnchor[] = [];
        if (sourceValue) {
          try {
            const stored = JSON.parse(sourceValue) as { fixture?: AnchorFixture };
            if (stored.fixture && validSource(stored.fixture)) fixture = stored.fixture;
          } catch {}
        }
        if (onsetValue) {
          try {
            const stored = JSON.parse(onsetValue) as OnsetFixture;
            if (validOnsets(stored)) savedOnsets = stored.anchors;
          } catch {}
        }
        if (fixture) {
          setSource(fixture);
          const saved = savedOnsets.find((item) => item.anchor_id === fixture.anchors[0].id);
          setCursor(saved?.audible_onset_timestamp_ms ?? fixture.anchors[0].audio.timestamp_ms);
          setNotes(saved?.annotation_notes ?? '');
        }
        setAnnotations(savedOnsets);
      },
    );
  }, []);

  useEffect(() => {
    if (
      status.playing &&
      loopEnd.current !== undefined &&
      status.currentTime * 1000 >= loopEnd.current
    ) {
      player.pause();
      loopEnd.current = undefined;
    }
  }, [player, status.currentTime, status.playing]);

  async function importAnchors() {
    const fixture = await pickJSON<AnchorFixture>();
    if (!fixture) return;
    if (!validSource(fixture))
      return setMessage('Expected the frozen Alice anchors.json with exactly ten anchors.');
    setSource(fixture);
    setIndex(0);
    const saved = annotations.find((item) => item.anchor_id === fixture.anchors[0].id);
    setCursor(saved?.audible_onset_timestamp_ms ?? fixture.anchors[0].audio.timestamp_ms);
    setNotes(saved?.annotation_notes ?? '');
    setConfirmed(false);
    await AsyncStorage.setItem(
      sourceStorageKey,
      JSON.stringify({ persistence_version: 3, fixture }),
    );
    setMessage('Loaded the ten immutable manual anchors.');
  }

  async function seek(timestamp: number) {
    const next = Math.max(
      0,
      Math.min(Math.round(status.duration * 1000 || 864310), Math.round(timestamp)),
    );
    setCursor(next);
    setConfirmed(false);
    await player.seekTo(next / 1000, 0, 0);
  }

  async function playSlice(start: number, end: number) {
    player.pause();
    loopEnd.current = end;
    await player.seekTo(start / 1000, 0, 0);
    player.play();
  }

  async function save() {
    if (!anchor || !confirmed || !notes.trim())
      return setMessage('Listen, add annotation notes, and confirm the onset was human-authored.');
    const annotation: OnsetAnchor = {
      anchor_id: anchor.id,
      manual_seek_timestamp_ms: anchor.audio.timestamp_ms,
      audible_onset_timestamp_ms: cursor,
      opening_word: openingWord(anchor.normalized_text),
      annotation_notes: notes.trim(),
      manual_minus_onset_ms: anchor.audio.timestamp_ms - cursor,
    };
    const next = [...annotations.filter((item) => item.anchor_id !== anchor.id), annotation].sort(
      (a, b) => a.anchor_id.localeCompare(b.anchor_id),
    );
    setAnnotations(next);
    await AsyncStorage.setItem(storageKey, JSON.stringify(onsetFixture(next)));
    setMessage(`Saved human onset for ${anchor.id}.`);
    if (index < 9) selectAnchor(index + 1, next);
  }

  function selectAnchor(nextIndex: number, values = annotations) {
    const nextAnchor = source?.anchors[nextIndex];
    if (!nextAnchor) return;
    const saved = values.find((item) => item.anchor_id === nextAnchor.id);
    setIndex(nextIndex);
    setCursor(saved?.audible_onset_timestamp_ms ?? nextAnchor.audio.timestamp_ms);
    setNotes(saved?.annotation_notes ?? '');
    setConfirmed(false);
  }

  function exportOnsets() {
    if (Platform.OS !== 'web' || annotations.length !== 10)
      return setMessage('Annotate all ten passages before exporting.');
    const blob = new Blob([`${JSON.stringify(onsetFixture(annotations), null, 2)}\n`], {
      type: 'application/json',
    });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'onset-anchors.json';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Alice audible-onset annotations</Text>
          <Text style={styles.message}>{message}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.count}>{annotations.length}/10 complete</Text>
          <Button label="Import anchors.json" onPress={importAnchors} />
          <Button
            label="Export onset-anchors.json"
            onPress={exportOnsets}
            primary
            disabled={annotations.length !== 10}
          />
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {!anchor ? (
          <Text style={styles.empty}>
            Import the existing test-fixtures/alice/anchors.json, or author anchors in /anchors
            first.
          </Text>
        ) : (
          <>
            <View style={styles.navigation}>
              <Button
                label="Previous"
                disabled={index === 0}
                onPress={() => selectAnchor(index - 1)}
              />
              <Text style={styles.anchorID}>
                {anchor.id} · {index + 1} of 10
              </Text>
              <Button label="Next" disabled={index === 9} onPress={() => selectAnchor(index + 1)} />
            </View>

            <Text style={styles.passage}>{anchor.text}</Text>
            <Text style={styles.detail}>Opening word: {openingWord(anchor.normalized_text)}</Text>
            <Text style={styles.detail}>
              Existing manual-seek timestamp: {anchor.audio.timestamp_ms} ms
            </Text>

            <View style={styles.rule}>
              <Text style={styles.ruleTitle}>Annotation rule</Text>
              <Text style={styles.ruleText}>
                Choose the earliest point at which the opening spoken word audibly begins. Do not
                use word completion, recognition time, or a model timestamp.
              </Text>
            </View>

            <Text style={styles.clock}>{formatMS(cursor)}</Text>
            <Text style={styles.detail}>
              candidate boundary: {cursor} ms · manual minus onset:{' '}
              {signed(anchor.audio.timestamp_ms - cursor)} ms
            </Text>
            <View style={styles.row}>
              <Button
                label={status.playing ? 'Pause' : 'Play'}
                primary
                onPress={() => (status.playing ? player.pause() : player.play())}
              />
              <Button
                label="Use current playback position"
                onPress={() => seek(player.currentTime * 1000)}
              />
            </View>
            <Text style={styles.label}>Audition length</Text>
            <View style={styles.row}>
              {[100, 250, 500, 1000].map((amount) => (
                <Button
                  key={amount}
                  label={`${amount} ms`}
                  primary={windowMS === amount}
                  onPress={() => setWindowMS(amount)}
                />
              ))}
            </View>
            <View style={styles.row}>
              <Button
                label={`Play ${windowMS} ms before boundary`}
                onPress={() => playSlice(Math.max(0, cursor - windowMS), cursor)}
              />
              <Button
                label={`Play ${windowMS} ms after boundary`}
                onPress={() => playSlice(cursor, cursor + windowMS)}
              />
            </View>
            <Text style={styles.detail}>
              Move the boundary until “before” contains no opening-word sound and “after” begins
              with it.
            </Text>
            <View style={styles.row}>
              {[-500, -100, -25, 25, 100, 500].map((amount) => (
                <Button
                  key={amount}
                  label={`${amount > 0 ? '+' : ''}${amount} ms`}
                  onPress={() => seek(cursor + amount)}
                />
              ))}
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Audible-onset timestamp (ms)</Text>
              <TextInput
                keyboardType="numeric"
                value={String(cursor)}
                onChangeText={(value) => {
                  setCursor(Number(value.replace(/\D/g, '')) || 0);
                  setConfirmed(false);
                }}
                onSubmitEditing={() => seek(cursor)}
                style={styles.input}
              />
              <Button label="Seek" onPress={() => seek(cursor)} />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Annotation notes</Text>
              <TextInput
                multiline
                value={notes}
                onChangeText={(value) => {
                  setNotes(value);
                  setConfirmed(false);
                }}
                placeholder="What did you hear at this boundary?"
                style={[styles.input, styles.notes]}
              />
            </View>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: confirmed }}
              onPress={() => setConfirmed(!confirmed)}
              style={styles.confirm}
            >
              <Text style={styles.check}>{confirmed ? '☑' : '☐'}</Text>
              <Text style={styles.confirmText}>
                I selected this timestamp by listening; model diagnostics did not determine it.
              </Text>
            </Pressable>
            <Button
              label="Save human onset"
              onPress={save}
              primary
              disabled={!confirmed || !notes.trim()}
            />

            <Text style={styles.sectionTitle}>Saved audible onsets</Text>
            {source.anchors.map((item, itemIndex) => {
              const saved = annotations.find((annotation) => annotation.anchor_id === item.id);
              return (
                <Pressable
                  key={item.id}
                  onPress={() => selectAnchor(itemIndex)}
                  style={styles.savedRow}
                >
                  <Text style={styles.anchorID}>{item.id}</Text>
                  <Text style={styles.savedValue}>
                    {saved
                      ? `${saved.audible_onset_timestamp_ms} ms · Δ ${signed(saved.manual_minus_onset_ms)} ms`
                      : 'not annotated'}
                  </Text>
                </Pressable>
              );
            })}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Button({
  label,
  onPress,
  primary,
  disabled,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, primary && styles.primary, disabled && styles.disabled]}
    >
      <Text style={[styles.buttonText, primary && styles.primaryText]}>{label}</Text>
    </Pressable>
  );
}

function onsetFixture(anchors: OnsetAnchor[]): OnsetFixture {
  return {
    version: 1,
    semantics: 'earliest point at which the opening spoken word audibly begins',
    epub_sha256: epubSHA,
    audio_sha256: audioSHA,
    anchors,
  };
}

function validSource(value: AnchorFixture) {
  return (
    value.version === 1 &&
    value.epub_sha256 === epubSHA &&
    value.audio_sha256 === audioSHA &&
    value.anchors?.length === 10
  );
}

function validOnsets(value: OnsetFixture) {
  return (
    value.version === 1 &&
    value.epub_sha256 === epubSHA &&
    value.audio_sha256 === audioSHA &&
    Array.isArray(value.anchors)
  );
}

function openingWord(text: string) {
  return text.match(/[\p{L}’'-]+/u)?.[0] ?? '';
}
function formatMS(ms: number) {
  return `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}
function signed(ms: number) {
  return `${ms >= 0 ? '+' : ''}${ms}`;
}

async function pickJSON<T>() {
  if (Platform.OS !== 'web') return undefined;
  return new Promise<T | undefined>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(undefined);
      try {
        resolve(JSON.parse(await file.text()) as T);
      } catch {
        resolve(undefined);
      }
    };
    input.click();
  });
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
    gap: 16,
  },
  title: { color: '#29231d', fontSize: 20, fontWeight: '700' },
  message: { color: '#655b51', fontSize: 12, marginTop: 3 },
  count: { color: '#655b51', fontVariant: ['tabular-nums'] },
  content: { width: '100%', maxWidth: 920, alignSelf: 'center', padding: 24, gap: 14 },
  empty: { color: '#40372f', fontSize: 15 },
  navigation: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7 },
  passage: {
    color: '#29231d',
    fontSize: 17,
    lineHeight: 26,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#c9c0b3',
  },
  anchorID: { color: '#29231d', fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  detail: { color: '#655b51', fontSize: 12, fontFamily: 'monospace' },
  rule: { borderLeftWidth: 3, borderLeftColor: '#8b3a24', paddingLeft: 12, gap: 4 },
  ruleTitle: { color: '#29231d', fontWeight: '700' },
  ruleText: { color: '#40372f', lineHeight: 20 },
  clock: { color: '#29231d', fontSize: 38, fontWeight: '600', fontVariant: ['tabular-nums'] },
  button: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#b7ac9e',
    borderRadius: 6,
    backgroundColor: '#f8f4ed',
  },
  buttonText: { color: '#40372f', fontSize: 12, fontWeight: '600' },
  primary: { backgroundColor: '#8b3a24', borderColor: '#8b3a24' },
  primaryText: { color: '#fffaf2' },
  disabled: { opacity: 0.45 },
  field: { gap: 6 },
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
  notes: { minHeight: 72, textAlignVertical: 'top' },
  confirm: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
  check: { color: '#29231d', fontSize: 20 },
  confirmText: { color: '#40372f', flex: 1 },
  sectionTitle: {
    color: '#29231d',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 10,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#c9c0b3',
  },
  savedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#c9c0b3',
  },
  savedValue: { color: '#655b51', fontFamily: 'monospace', fontSize: 12 },
});
