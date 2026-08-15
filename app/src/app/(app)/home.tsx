import type { Library, WorkSummary } from '../../generated/api';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import { useAuth } from '../../features/auth/AuthProvider';
import { ContinueCard, WorkCard } from '../../features/bookshelf';
import { listItemEnter } from '../../features/motion';
import { ScrollView, Text, View } from '../../features/tw';
import { Button, EmptyState, IconRow, Loading, Notice, Page, Section } from '../../features/ui';
import { api, errorMessage } from '../../lib/api';

/** Dense horizontal shelf of recently added Works, distinct from the browse grid's flex-wrap layout. */
function RecentShelf({
  works,
  onOpen,
}: {
  works: WorkSummary[];
  onOpen: (work: WorkSummary) => void;
}) {
  const narrow = useWindowDimensions().width < 600;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="flex-row gap-4 pb-1"
    >
      {works.map((work, index) => (
        <Animated.View key={work.id} entering={listItemEnter(index)}>
          <WorkCard
            title={work.title}
            author={work.author}
            availability={work}
            progress={work.in_progress ? `${work.completion_percent}% complete` : undefined}
            context={work.library_name}
            narrow={narrow}
            onPress={() => onOpen(work)}
          />
        </Animated.View>
      ))}
    </ScrollView>
  );
}

export default function HomeScreen() {
  const auth = useAuth();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [continuing, setContinuing] = useState<WorkSummary[]>([]);
  const [recent, setRecent] = useState<WorkSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const hasContinuing = continuing.length > 0;
  const hasAnyWorks = hasContinuing || recent.length > 0;

  useEffect(() => {
    let canceled = false;
    async function load() {
      try {
        const [nextLibraries, progressPage, recentPage] = await Promise.all([
          api.libraries(),
          api.browseWorks({ availability: 'in_progress', sort: 'progress', limit: 6 }),
          api.browseWorks({ sort: 'recent', limit: 12 }),
        ]);
        if (!canceled) {
          setLibraries(nextLibraries);
          setContinuing(progressPage.items);
          setRecent(recentPage.items);
        }
      } catch (value) {
        if (!canceled) setError(errorMessage(value));
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

  function consumeWork(work: WorkSummary, mode: 'read' | 'listen') {
    router.push(`/consume/${work.id}?mode=${mode}`);
  }

  function openLibrary(library: Library) {
    router.push(`/library/${library.id}`);
  }

  function goToLibraries() {
    router.push('/libraries');
  }

  if (loading) return <Loading />;

  return (
    <Page title="Home" hideHeader>
      {error ? <Notice danger>{error}</Notice> : null}
      <View>
        <Text className="font-editorial text-2xl font-bold leading-7 text-ink">
          Welcome back{auth.user?.display_name ? `, ${auth.user.display_name}` : ''}.
        </Text>
        {hasContinuing ? (
          <View className="mt-5">
            <Section title="Continue">
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerClassName="flex-row gap-4 pb-1"
              >
                {continuing.map((work, index) => (
                  <Animated.View key={work.id} entering={listItemEnter(index)}>
                    <ContinueCard
                      title={work.title}
                      author={work.author}
                      context={work.library_name}
                      availability={work}
                      continueMode={work.last_mode || (work.readable ? 'read' : 'listen')}
                      progress={`${work.completion_percent}% complete${work.active_seconds ? ` · ${Math.max(1, Math.round(work.active_seconds / 60))} min` : ''}`}
                      onOpen={() => openWork(work)}
                      onContinue={() => continueWork(work)}
                      onRead={() => consumeWork(work, 'read')}
                      onListen={() => consumeWork(work, 'listen')}
                    />
                  </Animated.View>
                ))}
              </ScrollView>
            </Section>
          </View>
        ) : null}
        <View className={hasContinuing ? 'mt-9' : 'mt-5'}>
          <Section
            title={hasContinuing ? 'Recently added' : 'Start reading'}
            action={<Button label="View all" kind="quiet" onPress={() => router.push('/search')} />}
          >
            {recent.length ? (
              <RecentShelf works={recent} onOpen={openWork} />
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
        <View className="mt-9">
          <Section title="Libraries">
            <View className="max-w-[720px] gap-3">
              {libraries.map((library, index) => (
                <Animated.View key={library.id} entering={listItemEnter(index)}>
                  <IconRow
                    icon="libraries"
                    title={library.name}
                    subtitle={library.role || 'Administrator access'}
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
