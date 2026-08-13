import type { AlignmentJob, Representation, Work } from '../../../../generated/api';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { choices, type MediaChoice } from '../../../../features/consumption';
import { useAuth } from '../../../../features/auth/AuthProvider';
import { TechnicalDetails } from '../../../../features/sources/TechnicalDetails';
import { Pressable, Text, View } from '../../../../features/tw';
import {
  Button,
  Empty,
  Field,
  Loading,
  Notice,
  Page,
  Row,
  Section,
  shared,
} from '../../../../features/ui';
import { api, errorMessage } from '../../../../lib/api';
import { goBackOr } from '../../../../lib/navigation';

const terminal = new Set(['ready', 'failed', 'stale']);

export default function ManageWorkScreen() {
  const {
    id,
    libraryId,
    role = '',
  } = useLocalSearchParams<{ id: string; libraryId: string; role?: string }>();
  const auth = useAuth();
  const [work, setWork] = useState<Work>();
  const [representations, setRepresentations] = useState<Representation[]>([]);
  const [media, setMedia] = useState<MediaChoice[]>([]);
  const [jobs, setJobs] = useState<AlignmentJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [kind, setKind] = useState('epub');
  const [label, setLabel] = useState('');
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [epubID, setEPUBID] = useState('');
  const [audioID, setAudioID] = useState('');

  async function load() {
    if (!id || !libraryId) return;
    try {
      const [nextWork, nextRepresentations, nextJobs] = await Promise.all([
        api.work(id),
        api.representations(id),
        api.alignmentJobs(id),
      ]);
      const revisions = await loadRevisions(libraryId, nextRepresentations);
      setWork(nextWork);
      setTitle(nextWork.title);
      setAuthor(nextWork.author || '');
      setRepresentations(nextRepresentations);
      setMedia(revisions);
      setJobs(nextJobs);
      setEPUBID((current) =>
        revisions.some((item) => item.id === current)
          ? current
          : (choices(nextRepresentations, revisions, ['epub'])[0]?.id ?? ''),
      );
      setAudioID((current) =>
        revisions.some((item) => item.id === current)
          ? current
          : (choices(nextRepresentations, revisions, ['audio', 'audiobook'])[0]?.id ?? ''),
      );
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, libraryId]);

  useEffect(() => {
    const active = jobs.filter((job) => !terminal.has(job.state));
    if (active.length === 0) return;
    let canceled = false;
    const timer = setTimeout(async () => {
      try {
        const updates = await Promise.all(active.map((job) => api.alignmentJob(job.id)));
        if (!canceled)
          setJobs((current) =>
            current.map((job) => updates.find((update) => update.id === job.id) || job),
          );
      } catch (value) {
        if (!canceled) setError(errorMessage(value));
      }
    }, 2000);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [jobs]);

  if (loading) return <Loading />;
  if (!work)
    return (
      <Page title="Manage work">
        <Notice danger>{error || 'Work unavailable.'}</Notice>
      </Page>
    );

  const canEdit = Boolean(auth.user?.admin || role === 'owner' || role === 'editor');
  const epubs = media.filter((item) => item.kind === 'epub');
  const audio = media.filter((item) => item.kind === 'audio' || item.kind === 'audiobook');
  const selectedEPUB = epubs.find((item) => item.id === epubID);
  const selectedAudio = audio.find((item) => item.id === audioID);

  function backToWork() {
    goBackOr(`/work/${id}?libraryId=${libraryId}&role=${role}`);
  }

  async function createRepresentation() {
    try {
      await api.createRepresentation(id, { kind, label });
      setLabel('');
      await load();
    } catch (value) {
      setError(errorMessage(value));
    }
  }

  async function enqueue() {
    if (!selectedEPUB || !selectedAudio) return;
    try {
      const job = await api.enqueueAlignment({
        epub_media_id: selectedEPUB.id,
        epub_sha256: selectedEPUB.sha256,
        audio_media_id: selectedAudio.id,
        audio_sha256: selectedAudio.sha256,
      });
      setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
    } catch (value) {
      setError(errorMessage(value));
    }
  }

  async function cancelJob(jobID: string) {
    try {
      await api.cancelAlignment(jobID);
      const update = await api.alignmentJob(jobID);
      setJobs((current) => current.map((item) => (item.id === update.id ? update : item)));
    } catch (value) {
      setError(errorMessage(value));
    }
  }

  async function saveWorkSettings() {
    try {
      await api.updateWork(id, { title, author });
      await load();
    } catch (value) {
      setError(errorMessage(value));
    }
  }

  function confirmDeleteWork() {
    Alert.alert('Delete work?', 'The work must have no representations.', [
      { text: 'Cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteWork(id);
            goBackOr(`/library/${libraryId}`);
          } catch (value) {
            setError(errorMessage(value));
          }
        },
      },
    ]);
  }

  if (!canEdit)
    return (
      <Page
        title="Manage work"
        back={<Button label="Work" icon="back" kind="quiet" onPress={backToWork} />}
      >
        <Notice danger>You don&apos;t have permission to manage this work.</Notice>
      </Page>
    );

  return (
    <Page
      title={`Manage · ${work.title}`}
      back={<Button label="Work" icon="back" kind="quiet" onPress={backToWork} />}
    >
      {error ? <Notice danger>{error}</Notice> : null}
      <Section title="Manage representations">
        {representations.length === 0 ? (
          <Empty>No representations yet.</Empty>
        ) : (
          representations.map((item) => {
            const revisions = media.filter((revision) => revision.representation_id === item.id);
            return (
              <Pressable
                accessibilityRole="link"
                key={item.id}
                className={shared.listItem}
                onPress={() =>
                  router.push(`/representation/${item.id}?libraryId=${libraryId}&role=${role}`)
                }
              >
                <Text className={shared.itemTitle}>{item.label}</Text>
                <Text className={shared.itemMeta}>
                  {item.kind} · {revisions.length} immutable revision
                  {revisions.length === 1 ? '' : 's'}
                </Text>
              </Pressable>
            );
          })
        )}
      </Section>
      <Section title="Add representation">
        <View className={shared.form}>
          <Field
            label="Kind (epub, audio, audiobook)"
            value={kind}
            onChangeText={setKind}
            autoCapitalize="none"
          />
          <Field
            label="Label"
            value={label}
            onChangeText={setLabel}
            placeholder="Narrated by… or 2026 EPUB"
          />
          <Button
            label="Create representation"
            kind="primary"
            disabled={!kind.trim() || !label.trim()}
            onPress={createRepresentation}
          />
        </View>
      </Section>
      <Section title="Alignment management">
        <Notice>Choose exact revisions to prepare synchronized switching.</Notice>
        <View className={shared.split}>
          <RevisionChoiceList
            title="EPUB revision"
            items={epubs}
            selected={epubID}
            onSelect={setEPUBID}
          />
          <RevisionChoiceList
            title="Audiobook revision"
            items={audio}
            selected={audioID}
            onSelect={setAudioID}
          />
        </View>
        <Row>
          <Button
            label="Start alignment"
            kind="primary"
            disabled={!selectedEPUB || !selectedAudio}
            onPress={enqueue}
          />
        </Row>
        {jobs.length === 0 ? (
          <Empty>No alignment jobs for this Work.</Empty>
        ) : (
          jobs.map((job) => (
            <View key={job.id} className={shared.listItem}>
              <Text className={shared.itemTitle}>Alignment {job.state}</Text>
              <Text className={shared.itemMeta}>
                {new Date(job.created_at).toLocaleString()}
                {job.error ? ` · ${job.error}` : ''}
              </Text>
              <TechnicalDetails
                rows={[
                  { label: 'Job ID', value: job.id, copyable: true },
                  { label: 'EPUB media ID', value: job.epub_media_id, copyable: true },
                  { label: 'Audio media ID', value: job.audio_media_id, copyable: true },
                  ...(job.alignment_id
                    ? [{ label: 'Alignment ID', value: job.alignment_id, copyable: true }]
                    : []),
                ]}
              />
              {!terminal.has(job.state) ? (
                <Button label="Cancel" kind="danger" onPress={() => void cancelJob(job.id)} />
              ) : null}
            </View>
          ))
        )}
      </Section>
      <Section title="Work settings">
        <View className={shared.form}>
          <Field label="Title" value={title} onChangeText={setTitle} />
          <Field label="Author" value={author} onChangeText={setAuthor} />
          <Row>
            <Button label="Save" onPress={() => void saveWorkSettings()} />
            <Button label="Delete work" icon="delete" kind="danger" onPress={confirmDeleteWork} />
          </Row>
        </View>
      </Section>
    </Page>
  );
}

async function loadRevisions(libraryId: string, representations: Representation[]) {
  const grouped = await Promise.all(
    representations.map(async (representation) =>
      (await api.media(libraryId, representation.id)).map((item) => ({
        ...item,
        representation,
      })),
    ),
  );
  return grouped.flat();
}

function RevisionChoiceList({
  title,
  items,
  selected,
  onSelect,
}: {
  title: string;
  items: MediaChoice[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <View className={shared.grow}>
      <Text className={shared.itemTitle}>{title}</Text>
      {items.length === 0 ? (
        <Empty>None available.</Empty>
      ) : (
        items.map((item) => (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ checked: selected === item.id }}
            key={item.id}
            className={shared.listItem}
            onPress={() => onSelect(item.id)}
          >
            <Text className={shared.itemTitle}>
              {selected === item.id ? '● ' : '○ '}
              {item.original_filename || item.representation.label}
            </Text>
            <Text className={shared.itemMeta}>
              {formatBytes(item.size_bytes)} · {item.representation.label}
            </Text>
          </Pressable>
        ))
      )}
    </View>
  );
}

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
