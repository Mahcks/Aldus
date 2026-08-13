import type { AlignmentJob, Representation, Work } from '../../../generated/api';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { BookCover } from '../../../features/bookshelf';
import {
  choices,
  defaultPair,
  synchronizationLabel,
  type MediaChoice,
} from '../../../features/consumption';
import { useAuth } from '../../../features/auth/AuthProvider';
import { Pressable, Text, View } from '../../../features/tw';
import { Button, Empty, Loading, Notice, Page, Row, Section, shared } from '../../../features/ui';
import { api, errorMessage } from '../../../lib/api';
import { goBackOr } from '../../../lib/navigation';

export default function WorkScreen() {
  const {
    id,
    libraryId,
    role = '',
  } = useLocalSearchParams<{ id: string; libraryId: string; role?: string }>();
  const auth = useAuth();
  const [work, setWork] = useState<Work>();
  const [media, setMedia] = useState<MediaChoice[]>([]);
  const [jobs, setJobs] = useState<AlignmentJob[]>([]);
  const [hasProgress, setHasProgress] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [epubID, setEPUBID] = useState('');
  const [audioID, setAudioID] = useState('');

  async function load() {
    if (!id || !libraryId) return;
    try {
      const [nextWork, nextRepresentations, nextJobs, progress] = await Promise.all([
        api.work(id),
        api.representations(id),
        api.alignmentJobs(id),
        api.workProgress(id),
      ]);
      const revisions = await loadRevisions(libraryId, nextRepresentations);
      const pair = defaultPair(
        nextJobs,
        choices(nextRepresentations, revisions, ['epub']),
        choices(nextRepresentations, revisions, ['audio', 'audiobook']),
        progress?.alignment_id,
      );
      setWork(nextWork);
      setMedia(revisions);
      setJobs(nextJobs);
      setHasProgress(Boolean(progress));
      setEPUBID((current) =>
        revisions.some((item) => item.id === current) ? current : (pair.epub?.id ?? ''),
      );
      setAudioID((current) =>
        revisions.some((item) => item.id === current) ? current : (pair.audio?.id ?? ''),
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

  if (loading) return <Loading />;
  if (!work)
    return (
      <Page title="Work">
        <Notice danger>{error || 'Work unavailable.'}</Notice>
      </Page>
    );

  const canEdit = Boolean(auth.user?.admin || role === 'owner' || role === 'editor');
  const epubs = media.filter((item) => item.kind === 'epub');
  const audio = media.filter((item) => item.kind === 'audio' || item.kind === 'audiobook');
  const selectedEPUB = epubs.find((item) => item.id === epubID);
  const selectedAudio = audio.find((item) => item.id === audioID);
  const syncLabel = synchronizationLabel(jobs, epubID, audioID);

  function consume(mode: 'read' | 'listen') {
    router.push(`/consume/${id}?mode=${mode}&epub=${epubID}&audio=${audioID}`);
  }

  function openManage() {
    router.push(`/work/${id}/manage?libraryId=${libraryId}&role=${role}`);
  }

  return (
    <Page
      title={work.title}
      back={
        <Button
          label="Library"
          icon="back"
          kind="quiet"
          onPress={() => goBackOr(`/library/${libraryId}`)}
        />
      }
      actions={
        canEdit ? (
          <Button label="Manage this work" icon="settings" kind="secondary" onPress={openManage} />
        ) : null
      }
    >
      {error ? <Notice danger>{error}</Notice> : null}
      <View className="flex-row flex-wrap items-center gap-7 py-3">
        <BookCover title={work.title} author={work.author} compact />
        <View className="min-w-[250px] flex-1 items-start gap-2">
          <Text className="max-w-[680px] font-editorial text-3xl font-extrabold leading-9 text-ink">
            {work.title}
          </Text>
          <Text className="text-lg text-muted">{work.author || 'Unknown author'}</Text>
          <Text className="mt-1.5 text-sm font-bold text-ink">
            {hasProgress ? 'Continue where you left off' : 'Ready to begin'}
          </Text>
          <Text className="text-sm font-bold text-accent">{syncLabel}</Text>
          <Row>
            <Button
              label={hasProgress ? 'Continue reading' : 'Read'}
              icon="read"
              kind="primary"
              disabled={!selectedEPUB}
              onPress={() => consume('read')}
            />
            <Button
              label={hasProgress ? 'Continue listening' : 'Listen'}
              icon="listen"
              disabled={!selectedAudio}
              onPress={() => consume('listen')}
            />
          </Row>
          {!selectedEPUB ? <Notice>This edition isn&apos;t available to read yet.</Notice> : null}
          {!selectedAudio ? (
            <Notice>This edition isn&apos;t available as an audiobook yet.</Notice>
          ) : null}
        </View>
      </View>
      {epubs.length > 1 || audio.length > 1 ? (
        <Section title="Choose your edition">
          <View className={shared.split}>
            <EditionChoiceList
              title="Reading edition"
              items={epubs}
              selected={epubID}
              onSelect={setEPUBID}
            />
            <EditionChoiceList
              title="Narration"
              items={audio}
              selected={audioID}
              onSelect={setAudioID}
            />
          </View>
        </Section>
      ) : null}
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

function EditionChoiceList({
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
