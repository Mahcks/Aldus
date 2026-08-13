import type { Alignment, AudioLocator, CanonicalPosition, RepresentationState, Work } from '../../../generated/api';
import type { AudioSource } from 'expo-audio';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { EPUBReader, type EPUBReaderHandle, type ReaderLocation } from '../../../components/EPUBReader';
import { choices, defaultPair, listenToRead, readToListen, readyJob, synchronizationLabel, type MediaChoice } from '../../../features/consumption';
import { Button, Loading, Notice, colors } from '../../../features/ui';
import { APIError, api, errorMessage } from '../../../lib/api';
import { productAudioSource } from '../../../lib/media';

type Mode = 'read' | 'listen';

export default function ConsumeWorkScreen() {
  const params = useLocalSearchParams<{ id: string; mode?: Mode; epub?: string; audio?: string }>();
  const [work, setWork] = useState<Work>();
  const [mode, setMode] = useState<Mode>(params.mode === 'listen' ? 'listen' : 'read');
  const [epubs, setEPUBs] = useState<MediaChoice[]>([]); const [audio, setAudio] = useState<MediaChoice[]>([]);
  const [epubID, setEPUBID] = useState(params.epub ?? ''); const [audioID, setAudioID] = useState(params.audio ?? '');
  const [jobs, setJobs] = useState<Awaited<ReturnType<typeof api.alignmentJobs>>>([]);
  const [alignment, setAlignment] = useState<Alignment>(); const [progress, setProgress] = useState<CanonicalPosition | null>(null);
  const [epubState, setEPUBState] = useState<RepresentationState | null>(null); const [audioState, setAudioState] = useState<RepresentationState | null>(null);
  const [epubBlob, setEPUBBlob] = useState<Blob>(); const [source, setSource] = useState<AudioSource>(null);
  const [readerLocation, setReaderLocation] = useState<ReaderLocation>(); const [readerTarget, setReaderTarget] = useState<unknown>();
  const [initialAudioMS, setInitialAudioMS] = useState<number>(); const [seekText, setSeekText] = useState('');
  const [syncAvailable, setSyncAvailable] = useState(false); const [audioReady, setAudioReady] = useState(false); const [notice, setNotice] = useState(''); const [loading, setLoading] = useState(true);
  const reader = useRef<EPUBReaderHandle>(null); const readerReady = useRef(false); const restoredAudio = useRef('');
  const lastAudioSave = useRef(-1);
  const player = useAudioPlayer(source, { updateInterval: 500 }); const status = useAudioPlayerStatus(player);
  const selectedEPUB = epubs.find((item) => item.id === epubID); const selectedAudio = audio.find((item) => item.id === audioID);
  const job = readyJob(jobs, epubID, audioID); const alignmentID = job?.alignment_id;

  useEffect(() => {
    let canceled = false;
    async function load() {
      if (!params.id) return;
      try {
        const [nextWork, representations, nextJobs, nextProgress] = await Promise.all([api.work(params.id), api.representations(params.id), api.alignmentJobs(params.id), api.workProgress(params.id)]);
        const revisions = (await Promise.all(representations.map((representation) => api.media(nextWork.library_id, representation.id)))).flat();
        const nextEPUBs = choices(representations, revisions, ['epub']); const nextAudio = choices(representations, revisions, ['audio', 'audiobook']);
        const pair = defaultPair(nextJobs, nextEPUBs, nextAudio, nextProgress?.alignment_id);
        const nextEPUB = nextEPUBs.find((item) => item.id === params.epub) ?? pair.epub;
        const nextAudioChoice = nextAudio.find((item) => item.id === params.audio) ?? pair.audio;
        if (canceled) return;
        setWork(nextWork); setEPUBs(nextEPUBs); setAudio(nextAudio); setJobs(nextJobs); setProgress(nextProgress);
        setEPUBID(nextEPUB?.id ?? ''); setAudioID(nextAudioChoice?.id ?? '');
      } catch (error) { if (!canceled) setNotice(errorMessage(error)); } finally { if (!canceled) setLoading(false); }
    }
    void load(); return () => { canceled = true; };
  }, [params.id, params.epub, params.audio]);

  useEffect(() => {
    let canceled = false;
    async function loadSelection() {
      setAlignment(undefined); setReaderTarget(undefined); setInitialAudioMS(undefined); setSyncAvailable(false); setAudioReady(false); readerReady.current = false;
      try {
        const selectedJob = readyJob(jobs, epubID, audioID);
        const [nextEPUBState, nextAudioState, nextAlignment, blob, audioSource] = await Promise.all([
          selectedEPUB ? api.representationState(selectedEPUB.representation.id) : null,
          selectedAudio ? api.representationState(selectedAudio.representation.id) : null,
          selectedJob?.alignment_id ? api.alignment(selectedJob.alignment_id) : undefined,
          selectedEPUB ? api.mediaBlob(selectedEPUB.id) : undefined,
          selectedAudio ? productAudioSource(selectedAudio.id) : null,
        ]);
        if (canceled) return;
        setEPUBState(nextEPUBState); setAudioState(nextAudioState); setAlignment(nextAlignment); setEPUBBlob(blob); setSource(audioSource);
        const canonical = progress?.resolvable && progress.alignment_id === selectedJob?.alignment_id ? progress : null;
        if (canonical && selectedJob?.alignment_id) {
          try {
            const [epubTarget, audioTarget] = await Promise.all([api.canonicalToEPUB(selectedJob.alignment_id, canonical), api.canonicalToAudio(selectedJob.alignment_id, canonical)]);
            if (!canceled) { setReaderTarget(epubTarget); setInitialAudioMS(audioTarget.timestamp_ms); setSyncAvailable(true); }
          } catch { if (!canceled) { setReaderTarget(nextEPUBState?.epub_locator); setInitialAudioMS(nextAudioState?.audio_timestamp_ms); } }
        } else {
          setReaderTarget(nextEPUBState?.epub_locator); setInitialAudioMS(nextAudioState?.audio_timestamp_ms);
        }
      } catch (error) { if (!canceled) setNotice(errorMessage(error)); }
    }
    if (work) void loadSelection(); return () => { canceled = true; };
  // Selection changes reload media; progress revision changes must not reload active playback.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work, epubID, audioID, jobs, progress?.alignment_id, progress?.resolvable]);

  useEffect(() => {
    if (!readerReady.current || !readerTarget) return;
    void reader.current?.restoreLocation(readerTarget, Boolean(progress?.resolvable && progress.alignment_id === alignmentID));
  }, [readerTarget, progress?.resolvable, progress?.alignment_id, alignmentID]);

  useEffect(() => {
    if (!status.isLoaded) return;
    if (initialAudioMS == null) return;
    if (restoredAudio.current === `${audioID}:${initialAudioMS}`) return;
    restoredAudio.current = `${audioID}:${initialAudioMS}`;
    void (async () => { await player.seekTo(initialAudioMS / 1000, 0, 0); if (audioState?.playback_speed) player.setPlaybackRate(audioState.playback_speed); setAudioReady(true); })();
  }, [status.isLoaded, initialAudioMS, audioID, audioState?.playback_speed, player]);

  const onReaderLocation = useCallback((location: ReaderLocation) => { setReaderLocation(location); }, []);
  const onReaderReady = useCallback(() => { readerReady.current = true; if (readerTarget) void reader.current?.restoreLocation(readerTarget, Boolean(progress?.resolvable && progress.alignment_id === alignmentID)); }, [readerTarget, progress?.resolvable, progress?.alignment_id, alignmentID]);

  useEffect(() => {
    if (mode !== 'read' || !readerLocation || !selectedEPUB) return;
    const timer = setTimeout(() => { void saveReadingPosition(readerLocation); }, 900);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, readerLocation, selectedEPUB?.id, alignmentID]);

  useEffect(() => {
    if (mode !== 'listen' || !status.isLoaded || (initialAudioMS != null && !audioReady) || !selectedAudio) return;
    const timestamp = Math.round(status.currentTime * 1000);
    if (lastAudioSave.current >= 0 && Math.abs(timestamp - lastAudioSave.current) < 2000) return;
    lastAudioSave.current = timestamp;
    void saveListeningPosition(timestamp);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, status.currentTime, status.isLoaded, audioReady, selectedAudio?.id, alignmentID]);

  async function saveRepresentation(kind: 'epub' | 'audio', value: unknown) {
    const selected = kind === 'epub' ? selectedEPUB : selectedAudio; const state = kind === 'epub' ? epubState : audioState;
    if (!selected) return;
    try {
      const next = await api.updateRepresentationState(selected.representation.id, kind === 'epub'
        ? { epub_locator: value, reader_layout: 'paginated', expected_revision: state?.revision ?? 0 }
        : { audio_timestamp_ms: value as number, playback_speed: status.playbackRate || 1, expected_revision: state?.revision ?? 0 });
      if (kind === 'epub') setEPUBState(next); else setAudioState(next);
    } catch (error) {
      if (error instanceof APIError && error.status === 409) {
        const current = await api.representationState(selected.representation.id);
        if (kind === 'epub') setEPUBState(current); else setAudioState(current);
      } else setNotice(errorMessage(error));
    }
  }

  async function saveCanonical(canonical: CanonicalPosition) {
    if (!work || !alignmentID) return false;
    try {
      const next = await api.updateWorkProgress(work.id, { alignment_id: alignmentID, segment_id: canonical.segment_id, offset: canonical.offset, expected_revision: progress?.revision ?? 0, source_device: Platform.OS });
      setProgress(next); setSyncAvailable(true); return true;
    } catch (error) {
      if (error instanceof APIError && error.status === 409) {
        setProgress(await api.workProgress(work.id)); setNotice('Progress changed on another device. The newer saved position was kept.');
      } else if (error instanceof APIError && error.status === 404) setSyncAvailable(false);
      else setNotice(errorMessage(error));
      return false;
    }
  }

  async function saveReadingPosition(location: ReaderLocation) {
    await saveRepresentation('epub', { href: location.href, cfi: location.cfi });
    if (!alignmentID || !location.sync) return;
    try { await saveCanonical(await api.epubToCanonical(alignmentID, location.sync)); } catch (error) { if (error instanceof APIError && error.status === 404) setSyncAvailable(false); else setNotice(errorMessage(error)); }
  }

  async function saveListeningPosition(timestampMS: number) {
    await saveRepresentation('audio', timestampMS);
    if (!alignmentID || !alignment?.segments[0]) return;
    const locator: AudioLocator = { resource: alignment.segments[0].audio_resource, timestamp_ms: timestampMS };
    try { await saveCanonical(await api.audioToCanonical(alignmentID, locator)); } catch (error) { if (error instanceof APIError && error.status === 404) setSyncAvailable(false); else setNotice(errorMessage(error)); }
  }

  async function switchToListen() {
    if (!work || !readerLocation?.sync || !alignmentID) return setNotice('Synchronized listening is unavailable at this passage.');
    try {
      const { progress: next, target } = await readToListen(api, work.id, alignmentID, readerLocation.sync, progress?.revision ?? 0, Platform.OS);
      setProgress(next);
      setAudioReady(false); setInitialAudioMS(target.timestamp_ms); setMode('listen'); setNotice('');
      if (status.isLoaded) { await player.seekTo(target.timestamp_ms / 1000, 0, 0); setAudioReady(true); player.play(); }
    } catch (error) { if (error instanceof APIError && error.status === 409) { setProgress(await api.workProgress(work.id)); setNotice('Progress changed on another device. The newer saved position was kept.'); } else { setSyncAvailable(false); setNotice(error instanceof APIError && error.status === 404 ? 'Synchronized listening is unavailable at this passage.' : errorMessage(error)); } }
  }

  async function switchToRead() {
    if (!work || !alignmentID || !alignment?.segments[0]) return setNotice('Synchronized reading is unavailable at this point.');
    try {
      const { progress: next, target } = await listenToRead(api, work.id, alignmentID, { resource: alignment.segments[0].audio_resource, timestamp_ms: Math.round(status.currentTime * 1000) }, progress?.revision ?? 0, Platform.OS);
      setProgress(next);
      player.pause(); setReaderTarget(target); setMode('read'); setNotice(''); setSyncAvailable(true);
    } catch (error) { if (error instanceof APIError && error.status === 409) { setProgress(await api.workProgress(work.id)); setNotice('Progress changed on another device. The newer saved position was kept.'); } else { setSyncAvailable(false); setNotice(error instanceof APIError && error.status === 404 ? 'Synchronized reading is unavailable at this point.' : errorMessage(error)); } }
  }

  if (loading || !work) return loading ? <Loading /> : <View style={styles.page}><Notice danger>{notice || 'Work unavailable.'}</Notice></View>;
  const syncLabel = synchronizationLabel(jobs, epubID, audioID);
  return <View style={styles.page}>
    <View style={styles.toolbar}>
      <Button label="Work" kind="quiet" onPress={() => router.back()} />
      <View style={styles.identity}><Text numberOfLines={1} style={styles.title}>{work.title}</Text><Text numberOfLines={1} style={styles.byline}>{work.author || 'Unknown author'}</Text></View>
      <View style={styles.modeSwitch}>{selectedEPUB ? <Button label="Read" kind={mode === 'read' ? 'primary' : 'secondary'} onPress={() => setMode('read')} /> : null}{selectedAudio ? <Button label="Listen" kind={mode === 'listen' ? 'primary' : 'secondary'} onPress={() => setMode('listen')} /> : null}</View>
    </View>
    <View style={styles.syncLine}><Text style={styles.syncText}>{syncAvailable ? 'Synchronized here' : syncLabel}</Text></View>
    {notice ? <View style={styles.notice}><Notice danger>{notice}</Notice></View> : null}
    {mode === 'read' ? selectedEPUB && epubBlob ? <View style={styles.reader}><EPUBReader ref={reader} source={epubBlob} product onLocation={onReaderLocation} onReady={onReaderReady} /><View style={styles.switchBar}><Text style={styles.helper}>{syncAvailable ? 'Continue with the narration at this passage.' : 'Reading still works outside synchronized passages.'}</Text><Button label="Listen from here" disabled={!syncAvailable} onPress={() => void switchToListen()} /></View></View> : <EmptyMode text="No EPUB is available for this Work." />
      : selectedAudio ? <View style={styles.listener}><View style={styles.artwork}><Text style={styles.monogram}>{work.title.slice(0, 1).toUpperCase()}</Text></View><Text style={styles.listenTitle}>{work.title}</Text><Text style={styles.narration}>{selectedAudio.representation.label}</Text><Text style={styles.time}>{formatTime(status.currentTime)} <Text style={styles.duration}>/ {formatTime(status.duration)}</Text></Text><View style={styles.controls}><Button label="−15 sec" onPress={() => void player.seekTo(Math.max(0, status.currentTime - 15))} /><Button label={status.playing ? 'Pause' : 'Play'} kind="primary" onPress={() => { if (status.playing) { player.pause(); void saveListeningPosition(Math.round(status.currentTime * 1000)); } else player.play(); }} /><Button label="+15 sec" onPress={() => void player.seekTo(Math.min(status.duration || Infinity, status.currentTime + 15))} /></View><View style={styles.seek}><TextInput accessibilityLabel="Seek time in seconds" keyboardType="numeric" value={seekText} onChangeText={setSeekText} placeholder="Seconds" style={styles.seekInput} /><Button label="Seek" disabled={!Number.isFinite(Number(seekText)) || Number(seekText) < 0} onPress={() => void player.seekTo(Number(seekText))} /></View><View style={styles.switchBar}><Text style={styles.helper}>{syncAvailable ? 'Return to the corresponding passage.' : 'Playback continues without synchronized text here.'}</Text><Button label="Read from here" disabled={!syncAvailable} onPress={() => void switchToRead()} /></View></View> : <EmptyMode text="No audiobook is available for this Work." />}
  </View>;
}

function EmptyMode({ text }: { text: string }) { return <View style={styles.empty}><Text style={styles.helper}>{text}</Text></View>; }
function formatTime(seconds: number) { if (!Number.isFinite(seconds)) return '0:00'; const whole = Math.max(0, Math.floor(seconds)); return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`; }

const styles = StyleSheet.create({
  page: { flex: 1, minHeight: '100%', backgroundColor: colors.canvas },
  toolbar: { minHeight: 70, paddingHorizontal: 18, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.paper, flexDirection: 'row', alignItems: 'center', gap: 14 },
  identity: { flex: 1, minWidth: 0 }, title: { color: colors.ink, fontSize: 18, fontWeight: '800' }, byline: { color: colors.muted, fontSize: 12, marginTop: 2 }, modeSwitch: { flexDirection: 'row', gap: 7 },
  syncLine: { minHeight: 30, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.panel }, syncText: { color: colors.muted, fontSize: 12, fontWeight: '600' }, notice: { paddingHorizontal: 20, paddingTop: 12 },
  reader: { flex: 1, width: '100%', maxWidth: 1100, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 10 },
  listener: { flex: 1, width: '100%', maxWidth: 620, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  artwork: { width: 220, height: 280, backgroundColor: '#73402f', borderWidth: 1, borderColor: '#5f3326', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }, monogram: { color: '#f8eee3', fontSize: 80, fontWeight: '800' },
  listenTitle: { color: colors.ink, fontSize: 25, lineHeight: 31, fontWeight: '800', textAlign: 'center' }, narration: { color: colors.muted, fontSize: 14 }, time: { color: colors.ink, fontVariant: ['tabular-nums'], fontSize: 24, marginTop: 12 }, duration: { color: colors.muted, fontSize: 16 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }, seek: { width: '100%', maxWidth: 330, flexDirection: 'row', gap: 8 }, seekInput: { flex: 1, minHeight: 40, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, color: colors.ink, paddingHorizontal: 10 },
  switchBar: { width: '100%', minHeight: 62, borderTopWidth: 1, borderTopColor: colors.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 10 }, helper: { flex: 1, color: colors.muted, fontSize: 13, lineHeight: 19 }, empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
});
