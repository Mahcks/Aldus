import type { AlignmentJob, Representation, WorkDetail } from '../../../generated/api';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import { AvailabilityIcons, BookCover } from '../../../features/bookshelf';
import {
  choices,
  defaultPair,
  synchronizationLabel,
  type MediaChoice,
} from '../../../features/consumption';
import { useAuth } from '../../../features/auth/AuthProvider';
import { formatDuration } from '../../../features/format';
import { fadeIn, listItemEnter } from '../../../features/motion';
import { Text, View } from '../../../features/tw';
import {
  Button,
  Empty,
  Loading,
  Notice,
  Page,
  Radio,
  IconButton,
  Row,
  Section,
  shared,
} from '../../../features/ui';
import { api, errorMessage } from '../../../lib/api';
import { goBackOr } from '../../../lib/navigation';

export default function WorkScreen() {
  const compact = useWindowDimensions().width < 600;
  const {
    id,
    libraryId,
    role = '',
  } = useLocalSearchParams<{ id: string; libraryId: string; role?: string }>();
  const auth = useAuth();
  const [work, setWork] = useState<WorkDetail>();
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

  if (loading) return <Loading label="Loading work…" />;
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
      title="Work"
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
          compact ? (
            <IconButton icon="settings" label="Manage this work" onPress={openManage} />
          ) : (
            <Button
              label="Manage this work"
              icon="settings"
              kind="secondary"
              onPress={openManage}
            />
          )
        ) : null
      }
    >
      {error ? <Notice danger>{error}</Notice> : null}
      <Animated.View entering={fadeIn}>
        <View className="flex-row flex-wrap items-center gap-8 border-b border-line py-5 pb-10">
          <BookCover title={work.title} author={work.author} coverURL={work.cover_url} compact />
          <View className="min-w-[250px] flex-1 items-start gap-3">
            <Text
              numberOfLines={3}
              className={`${compact ? 'text-3xl leading-9' : 'text-4xl leading-[44px]'} max-w-[720px] font-editorial font-extrabold text-ink`}
            >
              {work.title}
            </Text>
            <Text numberOfLines={2} className="text-lg text-muted">
              {work.author || 'Unknown author'}
            </Text>
            <AvailabilityIcons
              value={{
                readable: Boolean(selectedEPUB),
                listenable: Boolean(selectedAudio),
                synchronized: syncLabel === 'Read + Listen available',
              }}
            />
            {work.in_progress ? (
              <View className="w-full max-w-md gap-1.5 py-1">
                <View
                  className="h-1.5 overflow-hidden rounded-full bg-line"
                  accessibilityRole="progressbar"
                  accessibilityValue={{ min: 0, max: 100, now: work.completion_percent }}
                >
                  <View
                    className="h-full rounded-full bg-accent-strong"
                    style={{ width: `${work.completion_percent}%` }}
                  />
                </View>
                <Text className="text-sm text-muted">
                  {work.completion_percent}% complete
                  {work.active_seconds > 0
                    ? ` · ${formatDuration(work.active_seconds)} active`
                    : ''}
                </Text>
              </View>
            ) : null}
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
            {selectedEPUB || selectedAudio ? (
              <View className="mt-1 gap-0.5">
                {selectedEPUB ? (
                  <Text numberOfLines={1} className="text-sm text-muted">
                    Reading: {selectedEPUB.representation.label}
                  </Text>
                ) : null}
                {selectedAudio ? (
                  <Text numberOfLines={1} className="text-sm text-muted">
                    Listening: {selectedAudio.representation.label}
                  </Text>
                ) : null}
              </View>
            ) : null}
            {!selectedEPUB && !selectedAudio ? (
              <Notice>This work isn&apos;t available to read or listen to yet.</Notice>
            ) : !selectedEPUB ? (
              <Notice>This edition isn&apos;t available to read yet.</Notice>
            ) : !selectedAudio ? (
              <Notice>This edition isn&apos;t available as an audiobook yet.</Notice>
            ) : null}
          </View>
        </View>
      </Animated.View>
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
        items.map((item, index) => (
          <Animated.View key={item.id} entering={listItemEnter(index)}>
            <View className={shared.listItem}>
              <Radio
                label={item.representation.label}
                selected={selected === item.id}
                onPress={() => onSelect(item.id)}
              />
              <Text className="pl-8 text-xs text-muted">{formatBytes(item.size_bytes)}</Text>
            </View>
          </Animated.View>
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
