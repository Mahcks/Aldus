import type { Library, WorkSummary } from '../../generated/api';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { WorkGrid } from '../../features/browse';
import { useAuth } from '../../features/auth/AuthProvider';
import { EmptyState, Loading, Notice, Page, Section, shared } from '../../features/ui';
import { api, errorMessage } from '../../lib/api';

export default function HomeScreen() {
  const auth = useAuth();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [continuing, setContinuing] = useState<WorkSummary[]>([]);
  const [recent, setRecent] = useState<WorkSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  if (loading) return <Loading />;
  return (
    <Page title={`Welcome back${auth.user?.display_name ? `, ${auth.user.display_name}` : ''}`}>
      {error ? <Notice danger>{error}</Notice> : null}
      {continuing.length ? (
        <Section title="Continue">
          <WorkGrid works={continuing} showLibrary onOpen={openWork} />
        </Section>
      ) : null}
      <Section title={continuing.length ? 'Recently added' : 'Start reading'}>
        {recent.length ? (
          <WorkGrid works={recent} showLibrary onOpen={openWork} />
        ) : (
          <EmptyState title="Your shelves are waiting">
            Open a Library and add your first Work to begin reading or listening.
          </EmptyState>
        )}
      </Section>
      <Section title="Libraries">
        <View style={styles.libraryList}>
          {libraries.map((library) => (
            <Pressable
              accessibilityRole="link"
              key={library.id}
              style={shared.listItem}
              onPress={() => router.push(`/library/${library.id}`)}
            >
              <Text style={shared.itemTitle}>{library.name}</Text>
              <Text style={shared.itemMeta}>{library.role || 'Administrator access'}</Text>
            </Pressable>
          ))}
        </View>
      </Section>
    </Page>
  );
}

const styles = StyleSheet.create({
  libraryList: { maxWidth: 720 },
});
