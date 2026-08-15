import type { WorkSummary } from '../../generated/api';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import Animated from 'react-native-reanimated';
import { WorkRow } from '../../features/bookshelf';
import { BrowseControls } from '../../features/browse';
import { listItemEnter } from '../../features/motion';
import { View } from '../../features/tw';
import { Button, EmptyState, Loading, Notice, Page, SectionHeader } from '../../features/ui';
import { api, errorMessage } from '../../lib/api';

export default function SearchScreen() {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('recent');
  const [availability, setAvailability] = useState('all');
  const [works, setWorks] = useState<WorkSummary[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load(offset = 0) {
    setLoading(true);
    setError('');
    try {
      const page = await api.browseWorks({ q: query, sort, availability, limit: 24, offset });
      setWorks((current) => (offset ? [...current, ...page.items] : page.items));
      setHasMore(page.has_more);
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
    // `load` intentionally follows the current controls and is debounced here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, sort, availability]);

  return (
    <Page title="Search">
      {error ? <Notice danger>{error}</Notice> : null}
      <BrowseControls
        query={query}
        sort={sort}
        availability={availability}
        onQueryChange={setQuery}
        onSortChange={setSort}
        onAvailabilityChange={setAvailability}
      />
      {loading && works.length === 0 ? (
        <Loading label="Searching your libraries…" />
      ) : works.length ? (
        <View className="max-w-[900px] items-stretch gap-1">
          <SectionHeader
            title={`${works.length}${hasMore ? '+' : ''} result${works.length === 1 ? '' : 's'}`}
          />
          {works.map((work, index) => (
            <Animated.View key={work.id} entering={listItemEnter(index)}>
              <WorkRow
                title={work.title}
                author={work.author}
                context={work.library_name}
                availability={work}
                progress={work.in_progress ? `${work.completion_percent}% complete` : undefined}
                onPress={() =>
                  router.push(
                    `/work/${work.id}?libraryId=${work.library_id}&role=${work.library_role ?? ''}`,
                  )
                }
              />
            </Animated.View>
          ))}
          {hasMore ? (
            <Button
              label={loading ? 'Loading…' : 'Load more'}
              disabled={loading}
              onPress={() => void load(works.length)}
            />
          ) : null}
        </View>
      ) : (
        <EmptyState icon="search" title={query ? 'No matching works' : 'No works to search'}>
          {query
            ? 'Try another title, author, or availability filter.'
            : 'Works from every Library you can access will appear here.'}
        </EmptyState>
      )}
    </Page>
  );
}
