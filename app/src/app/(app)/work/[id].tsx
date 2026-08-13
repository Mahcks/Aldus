import type { AlignmentJob, Representation, Work } from '../../../generated/api';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { BookCover } from '../../../features/bookshelf';
import { choices, defaultPair, synchronizationLabel, type MediaChoice } from '../../../features/consumption';
import { useAuth } from '../../../features/auth/AuthProvider';
import { Button, Empty, Field, Loading, Notice, Page, Row, Section, colors, shared } from '../../../features/ui';
import { api, errorMessage } from '../../../lib/api';

const terminal = new Set(['ready', 'failed', 'stale']);

export default function WorkScreen() {
  const { id, libraryId, role = '' } = useLocalSearchParams<{ id: string; libraryId: string; role?: string }>(); const auth = useAuth();
  const [work, setWork] = useState<Work>(); const [representations, setRepresentations] = useState<Representation[]>([]); const [media, setMedia] = useState<MediaChoice[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [kind, setKind] = useState('epub'); const [label, setLabel] = useState(''); const [title, setTitle] = useState(''); const [author, setAuthor] = useState(''); const [epubID, setEPUBID] = useState(''); const [audioID, setAudioID] = useState(''); const [jobs, setJobs] = useState<AlignmentJob[]>([]); const [hasProgress, setHasProgress] = useState(false); const [managing, setManaging] = useState(false);
  async function load() {
    if (!id || !libraryId) return;
    try {
      const [nextWork, nextRepresentations, nextJobs, progress] = await Promise.all([api.work(id), api.representations(id), api.alignmentJobs(id), api.workProgress(id)]);
      const revisions = (await Promise.all(nextRepresentations.map(async (representation) => (await api.media(libraryId, representation.id)).map((item) => ({ ...item, representation }))))).flat();
      const pair = defaultPair(nextJobs, choices(nextRepresentations, revisions, ['epub']), choices(nextRepresentations, revisions, ['audio', 'audiobook']), progress?.alignment_id);
      setWork(nextWork); setTitle(nextWork.title); setAuthor(nextWork.author || ''); setRepresentations(nextRepresentations); setMedia(revisions); setJobs(nextJobs);
      setHasProgress(Boolean(progress));
      setEPUBID((current) => revisions.some((item) => item.id === current) ? current : pair.epub?.id ?? '');
      setAudioID((current) => revisions.some((item) => item.id === current) ? current : pair.audio?.id ?? '');
    } catch (value) { setError(errorMessage(value)); } finally { setLoading(false); }
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [id, libraryId]);
  useEffect(() => { const active = jobs.filter((job) => !terminal.has(job.state)); if (active.length === 0) return; let canceled = false; const timer = setTimeout(async () => { try { const updates = await Promise.all(active.map((job) => api.alignmentJob(job.id))); if (!canceled) setJobs((current) => current.map((job) => updates.find((update) => update.id === job.id) || job)); } catch (value) { if (!canceled) setError(errorMessage(value)); } }, 2000); return () => { canceled = true; clearTimeout(timer); }; }, [jobs]);
  if (loading) return <Loading />;
  if (!work) return <Page title="Work"><Notice danger>{error || 'Work unavailable.'}</Notice></Page>;
  const canEdit = Boolean(auth.user?.admin || role === 'owner' || role === 'editor'); const epubs = media.filter((item) => item.kind === 'epub'); const audio = media.filter((item) => item.kind === 'audio' || item.kind === 'audiobook'); const selectedEPUB = epubs.find((item) => item.id === epubID); const selectedAudio = audio.find((item) => item.id === audioID);
  const syncLabel = synchronizationLabel(jobs, epubID, audioID);
  async function createRepresentation() { try { await api.createRepresentation(id, { kind, label }); setLabel(''); await load(); } catch (value) { setError(errorMessage(value)); } }
  async function enqueue() { if (!selectedEPUB || !selectedAudio) return; try { const job = await api.enqueueAlignment({ epub_media_id: selectedEPUB.id, epub_sha256: selectedEPUB.sha256, audio_media_id: selectedAudio.id, audio_sha256: selectedAudio.sha256 }); setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]); } catch (value) { setError(errorMessage(value)); } }
  const consume = (mode: 'read' | 'listen') => router.push(`/consume/${id}?mode=${mode}&epub=${epubID}&audio=${audioID}`);

  return <Page title={work.title} back={<Button label="Library" kind="quiet" onPress={() => router.back()} />} actions={canEdit ? <Button label={managing ? 'Done' : 'Manage work'} kind="quiet" onPress={() => setManaging((value) => !value)} /> : null}>
    {error ? <Notice danger>{error}</Notice> : null}
    <View style={styles.hero}>
      <BookCover title={work.title} author={work.author} compact />
      <View style={styles.summary}><Text style={styles.workTitle}>{work.title}</Text><Text style={styles.author}>{work.author || 'Unknown author'}</Text><Text style={styles.progress}>{hasProgress ? 'Continue where you left off' : 'Ready to begin'}</Text><Text style={styles.status}>{syncLabel}</Text><Row><Button label={hasProgress ? 'Continue reading' : 'Read'} kind="primary" disabled={!selectedEPUB} onPress={() => consume('read')} /><Button label={hasProgress ? 'Continue listening' : 'Listen'} disabled={!selectedAudio} onPress={() => consume('listen')} /></Row></View>
    </View>
    {(epubs.length > 1 || audio.length > 1) ? <Section title="Choose your edition"><View style={shared.split}><ChoiceList title="Reading edition" items={epubs} selected={epubID} onSelect={setEPUBID} /><ChoiceList title="Narration" items={audio} selected={audioID} onSelect={setAudioID} /></View></Section> : null}
    {canEdit && managing ? <View style={styles.management}>
      <Section title="Manage representations">{representations.length === 0 ? <Empty>No representations yet.</Empty> : representations.map((item) => { const revisions = media.filter((revision) => revision.representation_id === item.id); return <Pressable accessibilityRole="link" key={item.id} style={shared.listItem} onPress={() => router.push(`/representation/${item.id}?libraryId=${libraryId}&role=${role}`)}><Text style={shared.itemTitle}>{item.label}</Text><Text style={shared.itemMeta}>{item.kind} · {revisions.length} immutable revision{revisions.length === 1 ? '' : 's'}</Text></Pressable>; })}</Section>
      <Section title="Add representation"><View style={shared.form}><Field label="Kind (epub, audio, audiobook)" value={kind} onChangeText={setKind} autoCapitalize="none" /><Field label="Label" value={label} onChangeText={setLabel} placeholder="Narrated by… or 2026 EPUB" /><Button label="Create representation" kind="primary" disabled={!kind.trim() || !label.trim()} onPress={createRepresentation} /></View></Section>
      <Section title="Alignment management"><Text style={shared.itemMeta}>Choose exact revisions to prepare synchronized switching.</Text><View style={shared.split}><ChoiceList title="EPUB revision" items={epubs} selected={epubID} onSelect={setEPUBID} /><ChoiceList title="Audiobook revision" items={audio} selected={audioID} onSelect={setAudioID} /></View><Row><Button label="Start alignment" kind="primary" disabled={!selectedEPUB || !selectedAudio} onPress={enqueue} /></Row>{jobs.length === 0 ? <Empty>No alignment jobs for this Work.</Empty> : jobs.map((job) => <View key={job.id} style={shared.listItem}><Text style={shared.itemTitle}>Alignment {job.state}</Text><Text style={shared.itemMeta}>{new Date(job.created_at).toLocaleString()} · EPUB {job.epub_media_id} · audio {job.audio_media_id}{job.error ? ` · ${job.error}` : ''}</Text><Text style={shared.mono}>job {job.id}{job.alignment_id ? ` · alignment ${job.alignment_id}` : ''}</Text>{!terminal.has(job.state) ? <Button label="Cancel" kind="danger" onPress={async () => { try { await api.cancelAlignment(job.id); const update = await api.alignmentJob(job.id); setJobs((current) => current.map((item) => item.id === update.id ? update : item)); } catch (value) { setError(errorMessage(value)); } }} /> : null}</View>)}</Section>
      <Section title="Work settings"><View style={shared.form}><Field label="Title" value={title} onChangeText={setTitle} /><Field label="Author" value={author} onChangeText={setAuthor} /><Row><Button label="Save" onPress={async () => { try { await api.updateWork(id, { title, author }); await load(); } catch (value) { setError(errorMessage(value)); } }} /><Button label="Delete work" kind="danger" onPress={() => Alert.alert('Delete work?', 'The work must have no representations.', [{ text: 'Cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { try { await api.deleteWork(id); router.back(); } catch (value) { setError(errorMessage(value)); } } }])} /></Row></View></Section>
    </View> : null}
  </Page>;
}

function ChoiceList({ title, items, selected, onSelect }: { title: string; items: MediaChoice[]; selected: string; onSelect: (id: string) => void }) {
  return <View style={shared.grow}><Text style={shared.itemTitle}>{title}</Text>{items.length === 0 ? <Empty>None available.</Empty> : items.map((item) => <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected === item.id }} key={item.id} style={shared.listItem} onPress={() => onSelect(item.id)}><Text style={shared.itemTitle}>{selected === item.id ? '● ' : '○ '}{item.original_filename || item.representation.label}</Text><Text style={shared.itemMeta}>{formatBytes(item.size_bytes)} · {item.representation.label}</Text></Pressable>)}</View>;
}
function formatBytes(bytes: number) { return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 28, paddingVertical: 12 },
  summary: { flex: 1, minWidth: 250, alignItems: 'flex-start', gap: 9 }, workTitle: { maxWidth: 680, color: colors.ink, fontSize: 30, lineHeight: 36, fontWeight: '800' }, author: { color: colors.muted, fontSize: 17 }, progress: { color: colors.ink, fontSize: 14, fontWeight: '700', marginTop: 7 }, status: { color: colors.accent, fontSize: 14, fontWeight: '700' }, management: { paddingTop: 22, borderTopWidth: 1, borderTopColor: colors.line, gap: 26 },
});
