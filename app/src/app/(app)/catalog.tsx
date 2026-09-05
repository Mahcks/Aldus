import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import type { CatalogGroup, WorkSummary } from '@/generated/api';
import { CatalogGroupRow } from '@/features/catalog-groups';
import { WorkRow, coverPresentation } from '@/features/bookshelf';
import { Text, View } from '@/features/tw';
import {
  IconButton,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Page,
  SearchField,
} from '@/features/ui';
import { goBackOr } from '@/lib/navigation';
import { APIError, api, errorMessage } from '@/lib/api';

export default function CatalogScreen() {
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  return <CatalogContent key={kind || 'series'} />;
}

function CatalogContent() {
  const {
    series,
    narrator,
    library_id,
    kind: routeKind,
  } = useLocalSearchParams<{
    kind?: string;
    series?: string;
    narrator?: string;
    library_id?: string;
  }>();
  const kind = routeKind === 'narrators' ? 'narrators' : 'series';
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [groups, setGroups] = useState<CatalogGroup[]>([]);
  const [works, setWorks] = useState<WorkSummary[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const selected = series || narrator;

  useEffect(() => {
    let canceled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        // Older servers ignore unknown work filters; check support before requesting filtered books.
        const groupPage = await api.catalogGroups(kind, query, selected ? 0 : offset);
        if (selected) {
          const result = await api.browseWorks({
            series,
            narrator,
            libraryID: library_id,
            sort: series ? 'series' : 'title',
            offset,
          });
          if (!canceled) {
            setWorks(result.items);
            setMore(result.has_more);
          }
        } else if (!canceled) {
          setGroups(groupPage.items);
          setMore(groupPage.has_more);
        }
      } catch (value) {
        if (!canceled)
          setError(
            value instanceof APIError && value.status === 404
              ? 'Update your Aldus server to browse series and narrators. Your books are still available in Library.'
              : errorMessage(value),
          );
      } finally {
        if (!canceled) setLoading(false);
      }
    }
    void load();
    return () => {
      canceled = true;
    };
  }, [kind, query, offset, series, narrator, library_id, selected, retry]);

  function search(value: string) {
    setQuery(value);
    setOffset(0);
  }
  function openGroup(group: CatalogGroup) {
    setOffset(0);
    router.push({
      pathname: '/catalog',
      params:
        kind === 'series'
          ? { series: group.name, library_id: group.library_id }
          : { narrator: group.name },
    });
  }

  return (
    <Page
      title={
        selected || (kind === 'series' ? 'Series in your library' : 'Narrators in your library')
      }
      editorial={Boolean(series)}
      back={<IconButton icon="back" kind="quiet" label="Back" onPress={() => goBackOr('/books')} />}
    >
      {selected ? (
        <Text className="text-base text-muted">
          {series
            ? 'In reading order. Books without a number appear last.'
            : `Audiobooks narrated by ${narrator}.`}
        </Text>
      ) : (
        <View className="gap-4">
          <Text className="text-base text-muted">
            {kind === 'series'
              ? 'Browse series in your libraries, in reading order.'
              : 'Find audiobooks by the people who narrate them.'}
          </Text>
          <SearchField
            label={kind === 'series' ? 'Find a series' : 'Find a narrator'}
            value={query}
            onChangeText={search}
            placeholder={kind === 'series' ? 'Search your series' : 'Search your narrators'}
          />
        </View>
      )}
      {loading ? (
        <LoadingState label="Loading your catalog…" />
      ) : error ? (
        <ErrorState
          title="Couldn't load the catalog"
          action={<Button label="Retry" onPress={() => setRetry((value) => value + 1)} />}
        >
          {error}
        </ErrorState>
      ) : selected ? (
        works.length ? (
          <View>
            {works.map((work) => (
              <WorkRow
                key={work.id}
                title={work.title}
                author={work.author}
                coverURL={work.cover_url}
                coverPresentation={coverPresentation(work)}
                availability={work}
                progress={
                  series && work.series_position ? `Book ${work.series_position}` : undefined
                }
                onPress={() => router.push(`/work/${work.id}`)}
              />
            ))}
          </View>
        ) : (
          <EmptyState title="No books here yet">
            Only books available to your account appear here.
          </EmptyState>
        )
      ) : groups.length ? (
        <View>
          {groups.map((group) => (
            <CatalogGroupRow
              key={`${group.library_id}:${group.name}`}
              group={group}
              onPress={() => openGroup(group)}
            />
          ))}
        </View>
      ) : (
        <EmptyState title={query ? 'No matches' : `No ${kind} yet`}>
          {query
            ? 'Try another name. Only series and narrators saved in your libraries appear here.'
            : kind === 'series'
              ? 'Series appear here once their names are saved on your books. To add one, open a book, tap its settings, then Details → Series.'
              : 'Narrators appear here once their names are saved on audiobook editions. Existing narration labels are not automatically converted.'}
        </EmptyState>
      )}
      {!loading && !error && (offset > 0 || more) ? (
        <View className="flex-row gap-3">
          {offset > 0 ? (
            <Button
              label="Previous page"
              kind="secondary"
              onPress={() => setOffset(Math.max(0, offset - 50))}
            />
          ) : null}
          {more ? (
            <Button label="Next page" kind="secondary" onPress={() => setOffset(offset + 50)} />
          ) : null}
        </View>
      ) : null}
    </Page>
  );
}
