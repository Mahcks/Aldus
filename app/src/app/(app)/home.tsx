import type { Library, WorkSummary } from '../../generated/api';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useAuth } from '../../features/auth/AuthProvider';
import { WorkCard } from '../../features/bookshelf';
import { summaryBadges, WorkGrid } from '../../features/browse';
import { AppIcon } from '../../features/icons';
import { Pressable, ScrollView, Text, View } from '../../features/tw';
import { Button, colors, EmptyState, Loading, Notice, Page, Section } from '../../features/ui';
import { api, errorMessage } from '../../lib/api';

/**
 * Duplicates the list-row markup in `libraries.tsx`. A future pass could
 * extract a shared `features/libraries.tsx` list-row component; not required
 * for this redesign.
 */
function LibraryRow({ library, onPress }: { library: Library; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      className="flex-row items-center justify-between gap-4 rounded-card border border-line bg-paper px-4 py-3.5"
    >
      <View className="min-w-0 flex-1 flex-row items-center gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-full bg-accent-soft">
          <AppIcon name="libraries" size={18} color={colors.accent} />
        </View>
        <View className="min-w-0 flex-1 gap-0.5">
          <Text numberOfLines={1} className="text-base font-bold text-ink">
            {library.name}
          </Text>
          <Text numberOfLines={1} className="text-sm text-muted">
            {library.role || 'Administrator access'}
          </Text>
        </View>
      </View>
      <AppIcon name="chevron" size={20} color={colors.subtle} />
    </Pressable>
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

  function openLibrary(library: Library) {
    router.push(`/library/${library.id}`);
  }

  function goToLibraries() {
    router.push('/libraries');
  }

  if (loading) return <Loading />;

  return (
    <Page title={`Welcome back${auth.user?.display_name ? `, ${auth.user.display_name}` : ''}`}>
      {error ? <Notice danger>{error}</Notice> : null}
      {hasContinuing ? (
        <Section title="Continue">
          <View className="gap-4 rounded-card border border-line bg-panel p-4">
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerClassName="flex-row gap-6"
            >
              {continuing.map((work) => (
                <WorkCard
                  key={work.id}
                  title={work.title}
                  author={work.author}
                  badges={summaryBadges(work)}
                  progress="Continue where you left off"
                  context={work.library_name}
                  onPress={() => openWork(work)}
                />
              ))}
            </ScrollView>
          </View>
        </Section>
      ) : null}
      <Section title={hasContinuing ? 'Recently added' : 'Start reading'}>
        {recent.length ? (
          <WorkGrid works={recent} showLibrary onOpen={openWork} />
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
            Open a Library and add your first Work to begin reading or listening, or create a new
            Library to get started.
          </EmptyState>
        )}
      </Section>
      <Section title="Libraries">
        <View className="max-w-[720px] gap-3">
          {libraries.map((library) => (
            <LibraryRow key={library.id} library={library} onPress={() => openLibrary(library)} />
          ))}
        </View>
      </Section>
    </Page>
  );
}
