import type { AppIconName } from '../../features/icons';
import type { Library, WorkSummary } from '../../generated/api';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import { useAuth } from '../../features/auth/AuthProvider';
import { ContinueCard, coverPresentation, LibraryCard, WorkCard } from '../../features/bookshelf';
import { AppIcon } from '../../features/icons';
import { colors } from '../../features/theme';
import { listItemEnter } from '../../features/motion';
import { ScrollView, Text, View } from '../../features/tw';
import { Button, EmptyState, Loading, Notice, Page, Section } from '../../features/ui';
import { APIError, api, errorMessage } from '../../lib/api';
import { type HomeLayout, useHomeLayout } from '../../lib/home-layout';
import {
  offlineLibraries,
  offlineWorkSummaries,
  rememberOfflineLibraries,
} from '../../lib/offline-library';

function StatChip({ icon, label }: { icon: AppIconName; label: string }) {
  return (
    <View className="flex-row items-center gap-1.5 rounded-pill bg-canvas px-3 py-1.5">
      <AppIcon name={icon} size={14} color={colors.accent} />
      <Text className="text-xs font-bold text-ink">{label}</Text>
    </View>
  );
}

/**
 * One global segmented toggle for how every section on Home lays out its
 * works — a horizontal scrolling shelf, or a wrapped grid that shows more
 * at a glance without scrolling sideways. Lives once, near the top of the
 * page, rather than repeated per section, since it's a single preference.
 */
function LayoutToggle({
  layout,
  onChange,
}: {
  layout: HomeLayout;
  onChange: (value: HomeLayout) => void;
}) {
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Home layout"
      className="flex-row gap-1.5"
    >
      <Button
        label="Shelf view"
        icon="shelfLayout"
        iconOnly
        kind="secondary"
        selected={layout === 'shelf'}
        accessibilityRole="radio"
        onPress={() => onChange('shelf')}
      />
      <Button
        label="Grid view"
        icon="gridLayout"
        iconOnly
        kind="secondary"
        selected={layout === 'grid'}
        accessibilityRole="radio"
        onPress={() => onChange('grid')}
      />
    </View>
  );
}

/** Dense horizontal shelf of Works, or a wrapped grid — see `LayoutToggle`. */
function RecentShelf({
  works,
  layout,
  onOpen,
}: {
  works: WorkSummary[];
  layout: HomeLayout;
  onOpen: (work: WorkSummary) => void;
}) {
  const narrow = useWindowDimensions().width < 600;

  const cards = works.map((work, index) => (
    <Animated.View key={work.id} entering={listItemEnter(index)}>
      <WorkCard
        title={work.title}
        author={work.author}
        coverURL={work.cover_url}
        coverPresentation={coverPresentation(work)}
        availability={work}
        progress={work.in_progress ? `${work.completion_percent}% complete` : undefined}
        context={work.library_name}
        narrow={narrow}
        onPress={() => onOpen(work)}
      />
    </Animated.View>
  ));

  if (layout === 'grid') {
    return <View className="flex-row flex-wrap items-start gap-x-4 gap-y-6">{cards}</View>;
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="flex-row gap-4 pb-1"
    >
      {cards}
    </ScrollView>
  );
}

/** Same shelf/grid split as `RecentShelf`, for `ContinueCard`'s narrower footprint and resume action. */
function ContinueShelf({
  works,
  layout,
  onOpen,
  onContinue,
}: {
  works: WorkSummary[];
  layout: HomeLayout;
  onOpen: (work: WorkSummary) => void;
  onContinue: (work: WorkSummary) => void;
}) {
  const cards = works.map((work, index) => (
    <Animated.View key={work.id} entering={listItemEnter(index)}>
      <ContinueCard
        title={work.title}
        author={work.author}
        coverURL={work.cover_url}
        coverPresentation={coverPresentation(work)}
        availability={work}
        continueMode={work.last_mode || (work.readable ? 'read' : 'listen')}
        progress={`${work.completion_percent}%`}
        onOpen={() => onOpen(work)}
        onContinue={() => onContinue(work)}
      />
    </Animated.View>
  ));

  if (layout === 'grid') {
    return <View className="flex-row flex-wrap gap-3">{cards}</View>;
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="flex-row gap-3 pb-1"
    >
      {cards}
    </ScrollView>
  );
}

export default function HomeScreen() {
  const auth = useAuth();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [continuing, setContinuing] = useState<WorkSummary[]>([]);
  const [recent, setRecent] = useState<WorkSummary[]>([]);
  const [wantToRead, setWantToRead] = useState<WorkSummary[]>([]);
  const [finished, setFinished] = useState<WorkSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);
  const [layout, setLayout] = useHomeLayout();

  const hasContinuing = continuing.length > 0;
  const hasAnyWorks = hasContinuing || recent.length > 0 || wantToRead.length > 0;

  useEffect(() => {
    let canceled = false;
    async function load() {
      try {
        const [nextLibraries, progressPage, recentPage, wantPage, finishedPage] = await Promise.all(
          [
            api.libraries(),
            api.browseWorks({ availability: 'in_progress', sort: 'progress', limit: 6 }),
            api.browseWorks({ sort: 'recent', limit: 12 }),
            api.browseWorks({ status: 'want_to_read', sort: 'updated', limit: 12 }),
            api.browseWorks({ status: 'finished', sort: 'updated', limit: 12 }),
          ],
        );
        if (!canceled) {
          await rememberOfflineLibraries(nextLibraries).catch(() => {});
          setLibraries(nextLibraries);
          setContinuing(progressPage.items);
          setRecent(recentPage.items);
          setWantToRead(wantPage.items);
          setFinished(finishedPage.items);
        }
      } catch (value) {
        if (!(value instanceof APIError && value.status === 0)) {
          if (!canceled) setError(errorMessage(value));
          return;
        }
        const [savedLibraries, savedWorks] = await Promise.all([
          offlineLibraries(),
          offlineWorkSummaries(),
        ]);
        if (!canceled) {
          setLibraries(savedLibraries);
          setContinuing(savedWorks.filter((work) => work.in_progress));
          setRecent(savedWorks);
          setWantToRead(savedWorks.filter((work) => work.reading_status === 'want_to_read'));
          setFinished(savedWorks.filter((work) => work.reading_status === 'finished'));
          setOffline(true);
          if (!savedWorks.length) setError(errorMessage(value));
        }
      } finally {
        if (!canceled) setLoading(false);
      }
    }
    void load();
    return () => {
      canceled = true;
    };
  }, []);

  function openWork(work: WorkSummary) {
    router.push(`/work/${work.id}?libraryId=${work.library_id}&role=${work.library_role ?? ''}`);
  }

  function continueWork(work: WorkSummary) {
    const mode = work.last_mode || (work.readable ? 'read' : 'listen');
    router.push(`/consume/${work.id}?mode=${mode}`);
  }

  function openLibrary(library: Library) {
    router.push(`/library/${library.id}`);
  }

  function goToLibraries() {
    router.push('/libraries');
  }

  if (loading) return <Loading label="Loading your home…" />;

  return (
    <Page title="Home" hideHeader>
      {offline ? <Notice>Offline · showing downloads on this device.</Notice> : null}
      {error ? <Notice danger>{error}</Notice> : null}
      <View>
        <View className="gap-3 rounded-card bg-accent-soft p-5 shadow-sm">
          <Text className="font-editorial text-2xl font-bold leading-7 text-ink">
            Welcome back{auth.user?.display_name ? `, ${auth.user.display_name}` : ''}.
          </Text>
          <View className="flex-row flex-wrap gap-2">
            <StatChip
              icon="libraries"
              label={`${libraries.length} librar${libraries.length === 1 ? 'y' : 'ies'}`}
            />
            {hasContinuing ? (
              <StatChip icon="read" label={`${continuing.length} in progress`} />
            ) : null}
          </View>
        </View>
        {hasAnyWorks ? (
          <View className="mt-5 flex-row justify-end">
            <LayoutToggle layout={layout} onChange={setLayout} />
          </View>
        ) : null}
        {hasContinuing ? (
          <View className={hasAnyWorks ? 'mt-2' : 'mt-5'}>
            <Section title="Continue">
              <ContinueShelf
                works={continuing}
                layout={layout}
                onOpen={openWork}
                onContinue={continueWork}
              />
            </Section>
          </View>
        ) : null}
        {wantToRead.length ? (
          <View className="mt-9">
            <Section title="Want to read">
              <RecentShelf works={wantToRead} layout={layout} onOpen={openWork} />
            </Section>
          </View>
        ) : null}
        <View className={hasContinuing ? 'mt-9' : 'mt-5'}>
          <Section
            title={hasContinuing ? 'Recently added' : 'Start reading'}
            action={<Button label="View all" kind="quiet" onPress={() => router.push('/search')} />}
          >
            {recent.length ? (
              <RecentShelf works={recent} layout={layout} onOpen={openWork} />
            ) : hasAnyWorks ? (
              <EmptyState title="Nothing new to show">
                Check back once new works are added to your libraries.
              </EmptyState>
            ) : (
              <EmptyState
                title="Your shelves are waiting"
                action={
                  <Button
                    label="Browse libraries"
                    kind="primary"
                    icon="libraries"
                    onPress={goToLibraries}
                  />
                }
              >
                Open a Library and add your first Work to begin reading or listening, or create a
                new Library to get started.
              </EmptyState>
            )}
          </Section>
        </View>
        {finished.length ? (
          <View className="mt-9">
            <Section title="Finished">
              <RecentShelf works={finished} layout={layout} onOpen={openWork} />
            </Section>
          </View>
        ) : null}
        <View className="mt-9">
          <Section title="Libraries">
            <View className="flex-row flex-wrap gap-3">
              {libraries.map((library, index) => (
                <Animated.View key={library.id} entering={listItemEnter(index)}>
                  <LibraryCard
                    name={library.name}
                    role={library.role}
                    onPress={() => openLibrary(library)}
                  />
                </Animated.View>
              ))}
            </View>
          </Section>
        </View>
      </View>
    </Page>
  );
}
