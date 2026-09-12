import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import type { CatalogGroup, Library, WorkSummary } from '@/generated/api';
import { CatalogGroupSection } from '@/features/catalog-groups';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/features/auth/AuthProvider';
import { getAPIBaseURL } from '@/lib/api-base';
import { LibraryGrid } from '@/features/library-grid';
import { libraryDensity, libraryDensityKey, type LibraryDensity } from '@/features/library-layout';
import { BrowseControls, BrowseFacet } from '@/features/browse';
import { offlineBrowseWorks } from '@/features/offline-browse';
import { workResumeMode } from '@/features/work-resume';
import { workQuickActions } from '@/features/work-actions';
import { Text, View } from '@/features/tw';
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
} from '@/features/ui';
import { APIError, api, errorMessage } from '@/lib/api';
import { offlineWorkSummaries } from '@/lib/offline-library';
import { goBackOr } from '@/lib/navigation';

type LibraryVisit = {
  scope: string;
  status: string;
  query: string;
  sort: string;
  availability: string;
  libraryID: string;
  works: WorkSummary[];
  series: CatalogGroup[];
  narrators: CatalogGroup[];
  offset: number;
  more: boolean;
  loading: boolean;
  offline: boolean;
  error: string;
  scrollOffset: number;
};
// Retain only the most recent library visit, scoped to its server/account, for Back navigation.
let lastVisit: LibraryVisit | undefined;

export default function BooksScreen() {
  const { status = '' } = useLocalSearchParams<{ status?: string }>();
  const auth = useAuth();
  const scope = JSON.stringify([getAPIBaseURL(), auth.user?.id]);
  return <LibraryBrowser key={JSON.stringify([scope, status])} scope={scope} status={status} />;
}

function LibraryBrowser({ scope, status }: { scope: string; status: string }) {
  const inProgress = status === 'in_progress';
  const [visit] = useState(() =>
    lastVisit?.scope === scope && lastVisit.status === status ? lastVisit : undefined,
  );
  const restoring = useRef(Boolean(visit && !visit.loading));
  useEffect(() => {
    lastVisit = undefined;
  }, []);
  const scrollOffset = useRef(visit?.scrollOffset ?? 0);
  const paging = useRef(false);
  const [density, setDensity] = useState<LibraryDensity>('comfortable');
  const [densityReady, setDensityReady] = useState(false);
  const [preferenceError, setPreferenceError] = useState('');
  const [query, setQuery] = useState(visit?.query ?? '');
  const [sort, setSort] = useState(visit?.sort ?? (inProgress ? 'progress' : 'recent'));
  const [availability, setAvailability] = useState(visit?.availability ?? 'all');
  const [libraryID, setLibraryID] = useState(visit?.libraryID ?? '');
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [works, setWorks] = useState<WorkSummary[]>(visit?.works ?? []);
  const [series, setSeries] = useState<CatalogGroup[]>(visit?.series ?? []);
  const [narrators, setNarrators] = useState<CatalogGroup[]>(visit?.narrators ?? []);
  const [catalogError, setCatalogError] = useState(false);
  const [loading, setLoading] = useState(visit?.loading ?? true);
  const [offline, setOffline] = useState(visit?.offline ?? false);
  const [error, setError] = useState(visit?.error ?? '');
  const [offset, setOffset] = useState(visit?.offset ?? 0);
  const [more, setMore] = useState(visit?.more ?? false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const q = query.trim();
  const heading = inProgress
    ? 'In progress'
    : status === 'want_to_read'
      ? 'Want to read or listen'
      : status === 'finished'
        ? 'Finished'
        : 'Library';

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(libraryDensityKey)
      .then((value) => {
        if (active) setDensity(libraryDensity(value));
      })
      .catch(() => {})
      .finally(() => {
        if (active) setDensityReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  async function chooseDensity(value: string) {
    const next = libraryDensity(value);
    setDensity(next);
    setPreferenceError('');
    try {
      await AsyncStorage.setItem(libraryDensityKey, next);
    } catch {
      setPreferenceError('This view could not be saved. It will apply until you close the app.');
    }
  }

  function loadMore() {
    if (loading || paging.current || error || !more || offline) return;
    paging.current = true;
    setLoading(true);
    if (offset === works.length) setRetry((value) => value + 1);
    else setOffset(works.length);
  }

  // Any navigation away from Library — opening a book, or picking a quick
  // action from its press-and-hold menu — needs this stashed first, or
  // Book → Back loses the scroll position and filters it's meant to restore.
  function stashVisit() {
    lastVisit = {
      scope,
      status,
      query,
      sort,
      availability,
      libraryID,
      works,
      series,
      narrators,
      offset,
      more,
      loading,
      offline,
      error,
      scrollOffset: scrollOffset.current,
    };
  }

  function openBook(work: WorkSummary) {
    stashVisit();
    const mode = workResumeMode(work);
    router.push(inProgress && mode ? `/consume/${work.id}?mode=${mode}` : `/work/${work.id}`);
  }

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
    if (restoring.current) {
      restoring.current = false;
      return;
    }
    let canceled = false;
    const timer = setTimeout(
      async () => {
        setLoading(true);
        setError('');
        try {
          const page = await api.browseWorks({
            q,
            sort,
            availability: inProgress ? 'in_progress' : availability,
            libraryID,
            status: inProgress ? '' : status,
            limit: 24,
            offset,
          });
          if (canceled) return;
          setWorks((current) => (offset ? [...current, ...page.items] : page.items));
          setMore(page.has_more && page.items.length > 0);
          setOffline(false);
        } catch (value) {
          if (canceled) return;
          if (offset === 0 && value instanceof APIError && value.status === 0) {
            try {
              const saved = offlineBrowseWorks(await offlineWorkSummaries(libraryID || undefined), {
                sort,
                availability: inProgress ? 'in_progress' : availability,
                status: inProgress ? '' : status,
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
          if (!canceled) {
            setLoading(false);
            paging.current = false;
          }
        }
      },
      q ? 250 : 0,
    );
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [q, sort, availability, libraryID, status, inProgress, offset, retry]);

  useEffect(() => {
    if (inProgress) return;

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
  }, [q, retry, inProgress]);

  function resetPage() {
    setRetry((value) => value + 1);
    paging.current = true;
    setLoading(true);
    setWorks([]);
    setOffset(0);
  }

  function search(value: string) {
    if (value.trim() === q) {
      setQuery(value);
      return;
    }
    paging.current = true;
    setQuery(value);
    setOffset(0);
    setWorks([]);
    setSeries([]);
    setNarrators([]);
    setLoading(true);
  }

  const header = (
    <View className="gap-5 pb-4">
      <SearchField
        label="Search your library"
        hideLabel
        placeholder="Search your library"
        value={query}
        onChangeText={search}
      />
      {preferenceError ? <Notice>{preferenceError}</Notice> : null}
      {offline ? <Notice>Offline · showing books downloaded to this device.</Notice> : null}
      {q && catalogError && !offline && !inProgress ? (
        <Notice>Series and narrator search is unavailable. You can still search your books.</Notice>
      ) : null}
      {q && !offline && !inProgress ? (
        <>
          <CatalogGroupSection kind="series" groups={series} searching />
          <CatalogGroupSection kind="narrators" groups={narrators} searching />
        </>
      ) : null}
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <View className="flex-row items-center gap-2">
          {!q && !status ? (
            <Button
              label="Books"
              icon="chevronDown"
              kind="quiet"
              onPress={() => setBrowseOpen(true)}
            />
          ) : (
            <Text className="text-lg font-sans-semibold text-ink">Books</Text>
          )}
          {!q && !status ? (
            <Button
              label="Collections"
              icon="collections"
              kind="quiet"
              onPress={() => {
                stashVisit();
                router.push('/collections');
              }}
            />
          ) : null}
        </View>
        <IconButton
          label="Filter & sort"
          icon="filter"
          kind="quiet"
          onPress={() => setFiltersOpen(true)}
        />
      </View>
    </View>
  );
  const footer = error ? (
    <ErrorState
      title={works.length ? 'Couldn’t load more books' : 'Couldn’t load your books'}
      action={
        <Button
          label="Retry"
          onPress={() => {
            setLoading(true);
            setRetry((value) => value + 1);
          }}
        />
      }
    >
      {error}
    </ErrorState>
  ) : loading ? (
    <LoadingState
      layout={works.length ? 'text' : inProgress ? 'rows' : 'library-grid'}
      label={works.length ? 'Loading more books…' : 'Loading your library…'}
    />
  ) : !works.length ? (
    <EmptyState icon="libraries" title={q ? 'No matching books' : 'No books to show'}>
      Try another search or filter.
    </EmptyState>
  ) : null;

  return (
    <Page
      title={heading}
      scrollable={false}
      editorial={false}
      back={
        status ? (
          <IconButton icon="back" label="Back" kind="quiet" onPress={() => goBackOr('/books')} />
        ) : undefined
      }
    >
      {densityReady ? (
        <LibraryGrid
          works={loading && offset === 0 ? [] : works}
          density={density}
          listView={inProgress}
          header={header}
          footer={footer}
          onEndReached={loadMore}
          onOpen={openBook}
          actions={workQuickActions}
          onBeforeOpen={stashVisit}
          initialOffset={visit?.scrollOffset}
          onScrollOffset={(value) => {
            scrollOffset.current = value;
          }}
        />
      ) : (
        <LoadingState layout="library-grid" label="Loading your library…" />
      )}
      <Dialog
        title="Filter & sort books"
        sheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        footer={
          <View className="flex-row items-center justify-between gap-4">
            <Button
              label="Reset filters"
              kind="quiet"
              onPress={() => {
                setSort(inProgress ? 'progress' : 'recent');
                setAvailability('all');
                setLibraryID('');
                resetPage();
              }}
            />
            <View className="min-w-28">
              <Button label="Done" kind="primary" onPress={() => setFiltersOpen(false)} />
            </View>
          </View>
        }
      >
        <View>
          {!inProgress ? (
            <BrowseFacet
              label="Cover size"
              options={[
                { value: 'comfortable', label: 'Comfortable' },
                { value: 'compact', label: 'Compact' },
              ]}
              value={density}
              onChange={(value) => void chooseDensity(value)}
            />
          ) : null}
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
                resetPage();
              }}
            />
          ) : null}
          {inProgress ? (
            <BrowseFacet
              label="Sort by"
              options={[
                { value: 'progress', label: 'Last opened' },
                { value: 'title', label: 'Title A–Z' },
                { value: 'author', label: 'Author A–Z' },
              ]}
              value={sort}
              onChange={(value) => {
                setSort(value);
                resetPage();
              }}
            />
          ) : (
            <BrowseControls
              sort={sort}
              availability={availability}
              onSortChange={(value) => {
                setSort(value);
                resetPage();
              }}
              onAvailabilityChange={(value) => {
                setAvailability(value);
                resetPage();
              }}
            />
          )}
        </View>
      </Dialog>
      <Dialog title="Browse your library" visible={browseOpen} onClose={() => setBrowseOpen(false)}>
        <View className="gap-3">
          <IconRow
            icon="collections"
            title="Collections"
            subtitle="Your saved book lists"
            onPress={() => {
              setBrowseOpen(false);
              stashVisit();
              router.push('/collections');
            }}
          />
          <IconRow
            icon="contents"
            title="Series"
            subtitle="Books grouped by series, in reading order"
            onPress={() => {
              setBrowseOpen(false);
              stashVisit();
              router.push('/catalog?kind=series');
            }}
          />
          <IconRow
            icon="listen"
            title="Narrators"
            subtitle="Audiobooks grouped by who narrates them"
            onPress={() => {
              setBrowseOpen(false);
              stashVisit();
              router.push('/catalog?kind=narrators');
            }}
          />
        </View>
      </Dialog>
    </Page>
  );
}
