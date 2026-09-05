import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import type { CatalogGroup, Library, WorkSummary } from '@/generated/api';
import { CatalogGroupSection } from '@/features/catalog-groups';
import { BrowseControls, BrowseFacet, WorkGrid } from '@/features/browse';
import { offlineBrowseWorks } from '@/features/offline-browse';
import { View } from '@/features/tw';
import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  IconButton,
  IconRow,
  LoadingState,
  Notice,
  Page,
  SearchField,
  Section,
} from '@/features/ui';
import { APIError, api, errorMessage } from '@/lib/api';
import { offlineWorkSummaries } from '@/lib/offline-library';
import { goBackOr } from '@/lib/navigation';

export default function BooksScreen() {
  const { status = '' } = useLocalSearchParams<{ status?: string }>();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('recent');
  const [availability, setAvailability] = useState('all');
  const [libraryID, setLibraryID] = useState('');
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [works, setWorks] = useState<WorkSummary[]>([]);
  const [series, setSeries] = useState<CatalogGroup[]>([]);
  const [narrators, setNarrators] = useState<CatalogGroup[]>([]);
  const [catalogError, setCatalogError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState('');
  const [offset, setOffset] = useState(0);
  const [more, setMore] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const q = query.trim();
  const heading =
    status === 'want_to_read'
      ? 'Want to read or listen'
      : status === 'finished'
        ? 'Finished'
        : 'Library';

  useEffect(() => {
    let canceled = false;
    void api
      .libraries()
      .then((items) => {
        if (!canceled) setLibraries(items.filter((item) => item.effective));
      })
      .catch(() => {});
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    let canceled = false;
    const timer = setTimeout(
      async () => {
        setLoading(true);
        setError('');
        try {
          const page = await api.browseWorks({
            q,
            sort,
            availability,
            libraryID,
            status,
            limit: 24,
            offset,
          });
          if (canceled) return;
          setWorks((current) => (offset ? [...current, ...page.items] : page.items));
          setMore(page.has_more);
          setOffline(false);
        } catch (value) {
          if (canceled) return;
          if (value instanceof APIError && value.status === 0) {
            try {
              const saved = offlineBrowseWorks(await offlineWorkSummaries(libraryID || undefined), {
                sort,
                availability,
                status,
              }).filter((work) =>
                `${work.title} ${work.author || ''} ${work.series || ''}`
                  .toLocaleLowerCase()
                  .includes(q.toLocaleLowerCase()),
              );
              if (canceled) return;
              setWorks(saved);
              setMore(false);
              setOffline(true);
            } catch (storageError) {
              if (!canceled) setError(errorMessage(storageError));
            }
          } else setError(errorMessage(value));
        } finally {
          if (!canceled) setLoading(false);
        }
      },
      q ? 250 : 0,
    );
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [q, sort, availability, libraryID, status, offset, retry]);

  useEffect(() => {
    let canceled = false;
    const timer = setTimeout(
      async () => {
        const pages = await Promise.allSettled([
          api.catalogGroups('series', q),
          api.catalogGroups('narrators', q),
        ]);
        if (canceled) return;
        setSeries(pages[0].status === 'fulfilled' ? pages[0].value.items : []);
        setNarrators(pages[1].status === 'fulfilled' ? pages[1].value.items : []);
        setCatalogError(pages.some((page) => page.status === 'rejected'));
      },
      q ? 250 : 0,
    );
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [q, retry]);

  function search(value: string) {
    setQuery(value);
    setOffset(0);
    setWorks([]);
    setSeries([]);
    setNarrators([]);
    setLoading(true);
  }

  return (
    <Page
      title={heading}
      editorial={false}
      back={
        status ? (
          <IconButton icon="back" label="Back" kind="quiet" onPress={() => goBackOr('/books')} />
        ) : undefined
      }
    >
      <SearchField
        label="Search your library"
        hideLabel
        placeholder="Your books, authors, series, or narrators"
        value={query}
        onChangeText={search}
      />
      {!q && !status ? (
        <IconRow
          icon="collections"
          title="Collections"
          subtitle="Your saved book lists"
          onPress={() => router.push('/collections')}
        />
      ) : null}
      {offline ? <Notice>Offline · showing books downloaded to this device.</Notice> : null}
      {q && catalogError && !offline ? (
        <Notice>Series and narrator search is unavailable. You can still search your books.</Notice>
      ) : null}
      {q && !offline ? (
        <>
          <CatalogGroupSection kind="series" groups={series} searching />
          <CatalogGroupSection kind="narrators" groups={narrators} searching />
        </>
      ) : null}
      <Section
        title={q ? 'Books' : 'Your books'}
        action={
          <Button
            label="Filter & sort"
            icon="filter"
            kind="quiet"
            onPress={() => setFiltersOpen(true)}
          />
        }
      >
        {error ? (
          <ErrorState
            title="Couldn't load your books"
            action={<Button label="Retry" onPress={() => setRetry((value) => value + 1)} />}
          >
            {error}
          </ErrorState>
        ) : loading && offset === 0 ? (
          <LoadingState label="Loading your library…" />
        ) : works.length ? (
          <>
            <WorkGrid works={works} onOpen={(work) => router.push(`/work/${work.id}`)} />
            {more ? (
              <View className="self-start">
                <Button
                  label="Load more books"
                  loading={loading}
                  onPress={() => {
                    setLoading(true);
                    setOffset((value) => value + 24);
                  }}
                />
              </View>
            ) : null}
          </>
        ) : (
          <EmptyState
            icon="libraries"
            title={q ? 'No matching books' : 'No books to show'}
            action={
              !q ? (
                <Button label="Find a book to request" onPress={() => router.navigate('/search')} />
              ) : undefined
            }
          >
            {q
              ? 'Try a different title or author, or open a matching series or narrator above.'
              : 'Try another filter, or find something new in Discover.'}
          </EmptyState>
        )}
      </Section>
      {!q && !status && !offline ? (
        <>
          <CatalogGroupSection kind="series" groups={series} searching={false} />
          <CatalogGroupSection kind="narrators" groups={narrators} searching={false} />
        </>
      ) : null}
      <Dialog
        title="Filter & sort books"
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
      >
        <View className="gap-5">
          {libraries.length > 1 ? (
            <BrowseFacet
              label="Library"
              options={[
                { value: '', label: 'All libraries' },
                ...libraries.map((library) => ({ value: library.id, label: library.name })),
              ]}
              value={libraryID}
              onChange={(value) => {
                setLibraryID(value);
                setOffset(0);
              }}
            />
          ) : null}
          <BrowseControls
            sort={sort}
            availability={availability}
            onSortChange={(value) => {
              setSort(value);
              setOffset(0);
            }}
            onAvailabilityChange={(value) => {
              setAvailability(value);
              setOffset(0);
            }}
          />
          <Button label="Show books" kind="primary" onPress={() => setFiltersOpen(false)} />
          <Button
            label="Reset filters"
            kind="quiet"
            onPress={() => {
              setSort('recent');
              setAvailability('all');
              setLibraryID('');
              setOffset(0);
            }}
          />
        </View>
      </Dialog>
    </Page>
  );
}
