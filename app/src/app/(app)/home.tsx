import type { Library, Work } from '../../generated/api';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { WorkCard } from '../../features/bookshelf';
import { useAuth } from '../../features/auth/AuthProvider';
import { Loading, Notice, Page, Section, colors, space, shared, type } from '../../features/ui';
import { api, errorMessage } from '../../lib/api';

type HomeWork = Work & { library: Library; badges: string[]; hasProgress: boolean };

export default function HomeScreen() {
  const auth = useAuth();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [works, setWorks] = useState<HomeWork[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let canceled = false;
    async function load() {
      try {
        const nextLibraries = await api.libraries();
        const groups = await Promise.all(
          nextLibraries.map(async (library) =>
            Promise.all(
              (await api.works(library.id)).map(async (work) => {
                const [representations, jobs, progress] = await Promise.all([
                  api.representations(work.id),
                  api.alignmentJobs(work.id),
                  api.workProgress(work.id),
                ]);
                const media = (
                  await Promise.all(
                    representations.map((representation) =>
                      api.media(library.id, representation.id),
                    ),
                  )
                ).flat();
                const badges = [
                  media.some((item) => item.kind === 'epub') ? 'EPUB' : '',
                  media.some((item) => item.kind === 'audio' || item.kind === 'audiobook')
                    ? 'Audio'
                    : '',
                  jobs.some((item) => item.state === 'ready') ? 'Synced' : '',
                ].filter(Boolean);
                return { ...work, library, badges, hasProgress: Boolean(progress) };
              }),
            ),
          ),
        );
        if (!canceled) {
          setLibraries(nextLibraries);
          setWorks(groups.flat());
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
  if (loading) return <Loading />;
  const continuing = works.filter((work) => work.hasProgress);
  return (
    <Page title={`Welcome back${auth.user?.display_name ? `, ${auth.user.display_name}` : ''}`}>
      {error ? <Notice danger>{error}</Notice> : null}
      {continuing.length ? (
        <Section title="Continue">
          <View style={styles.shelf}>
            {continuing.slice(0, 6).map((work) => (
              <WorkCard
                key={work.id}
                title={work.title}
                author={work.author}
                badges={work.badges}
                progress="Continue where you left off"
                onPress={() =>
                  router.push(
                    `/work/${work.id}?libraryId=${work.library_id}&role=${work.library.role}`,
                  )
                }
              />
            ))}
          </View>
        </Section>
      ) : null}
      <Section title={continuing.length ? 'Your books' : 'Start reading'}>
        {works.length ? (
          <View style={styles.shelf}>
            {works.slice(0, 12).map((work) => (
              <WorkCard
                key={work.id}
                title={work.title}
                author={work.author}
                badges={work.badges}
                onPress={() =>
                  router.push(
                    `/work/${work.id}?libraryId=${work.library_id}&role=${work.library.role}`,
                  )
                }
              />
            ))}
          </View>
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Your shelves are waiting</Text>
            <Text style={styles.emptyText}>
              Open a library and add your first Work to begin reading or listening.
            </Text>
          </View>
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
  shelf: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xl },
  libraryList: { maxWidth: 720 },
  empty: { minHeight: 180, justifyContent: 'center', gap: space.sm },
  emptyTitle: { color: colors.ink, ...type.pageTitle },
  emptyText: { color: colors.muted, ...type.body, maxWidth: 520 },
});
