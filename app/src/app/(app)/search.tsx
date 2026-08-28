import type {
  AcquisitionDestination,
  AcquisitionResult,
  Library,
  TitleSearchResult,
  WorkSummary,
} from '@/generated/api';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { groupAcquisitionResults } from '@/features/acquisition';
import { BookCover } from '@/features/bookshelf';
import { AcquisitionGroupRow, BrowseControls, BrowseFacet, WorkGrid } from '@/features/browse';
import { useAuth } from '@/features/auth/AuthProvider';
import { titleRequestPresentation } from '@/features/title-search';
import { offlineBrowseWorks } from '@/features/offline-browse';
import { Text, View } from '@/features/tw';
import {
  Button,
  Dialog,
  EmptyState,
  LoadingState,
  Notice,
  Page,
  SearchField,
  Section,
  StatusBadge,
} from '@/features/ui';
import { APIError, api, errorMessage } from '@/lib/api';
import { offlineWorkSummaries } from '@/lib/offline-library';

const statusTitles: Record<string, string> = {
  want_to_read: 'Want to read or listen',
  finished: 'Finished',
};

type BookFormat = 'ebook' | 'audiobook';
type ReleaseStatus = 'idle' | 'sending' | 'queued' | 'error';

function resultKey(result: TitleSearchResult) {
  return (
    result.work_id ||
    `${result.external_source ?? ''}:${result.external_id ?? ''}:${result.title}:${result.author ?? ''}`
  );
}

function destinationFor(
  result: TitleSearchResult,
  destinations: AcquisitionDestination[],
  libraryID = '',
): AcquisitionDestination | undefined {
  if (libraryID) {
    return destinations.find((destination) => destination.library_id === libraryID);
  }
  if (result.library_id) {
    return destinations.find((destination) => destination.library_id === result.library_id);
  }
  return destinations[0];
}

function localResult(work: WorkSummary): TitleSearchResult {
  return {
    work_id: work.id,
    library_id: work.library_id,
    title: work.title,
    author: work.author,
    cover_url: work.cover_url,
    readable: work.readable,
    listenable: work.listenable,
    synchronized: work.synchronized,
  };
}

function FormatAction({
  format,
  available,
  requestState,
  busy,
  requestEnabled,
  onOpen,
  onRequest,
}: {
  format: BookFormat;
  available: boolean;
  requestState?: string;
  busy: boolean;
  requestEnabled: boolean;
  onOpen: () => void;
  onRequest: () => void;
}) {
  const label = format === 'ebook' ? 'Ebook' : 'Audiobook';
  const state = titleRequestPresentation(requestState);

  return (
    <View className="flex-row items-center gap-2">
      {available ? (
        <Button
          label={format === 'ebook' ? 'Read ebook' : 'Listen'}
          kind="primary"
          onPress={onOpen}
        />
      ) : !state || state.requestable ? (
        <Button
          label={
            state?.requestable
              ? `Request ${label.toLowerCase()} again`
              : `Request ${label.toLowerCase()}`
          }
          kind="secondary"
          loading={busy}
          disabled={!requestEnabled}
          onPress={onRequest}
        />
      ) : (
        <View className="min-h-11 flex-row items-center gap-2 px-2">
          <Text className="text-sm font-sans-bold text-ink">{label}</Text>
          <StatusBadge tone={state.tone} label={state.label} />
        </View>
      )}
    </View>
  );
}

function TitleRow({
  result,
  requestBusy,
  requestEnabled,
  canChooseRelease,
  onRequest,
  onChooseRelease,
}: {
  result: TitleSearchResult;
  requestBusy: string;
  requestEnabled: boolean;
  canChooseRelease: boolean;
  onRequest: (format: BookFormat) => void;
  onChooseRelease: () => void;
}) {
  const canOpen = Boolean(result.work_id);

  return (
    <View className="border-b border-line py-4">
      <View className="flex-row items-start gap-4">
        <BookCover
          title={result.title}
          author={result.author}
          coverURL={result.cover_url}
          size="mini"
        />
        <View className="min-w-0 flex-1">
          <Text numberOfLines={2} className="font-editorial-bold text-lg leading-6 text-ink">
            {result.title}
          </Text>
          <Text numberOfLines={1} className="mt-1 text-sm text-muted">
            {result.author || 'Unknown author'}
          </Text>
          {result.synchronized ? (
            <View className="mt-2">
              <StatusBadge tone="info" label="Read & Listen" icon="synced" />
            </View>
          ) : null}
          <View className="mt-3 flex-row flex-wrap items-center gap-2">
            <FormatAction
              format="ebook"
              available={result.readable}
              requestState={result.ebook_request_state}
              busy={requestBusy === 'ebook'}
              requestEnabled={requestEnabled}
              onOpen={() => {
                if (canOpen) router.push(`/consume/${result.work_id}?mode=read`);
              }}
              onRequest={() => onRequest('ebook')}
            />
            <FormatAction
              format="audiobook"
              available={result.listenable}
              requestState={result.audiobook_request_state}
              busy={requestBusy === 'audiobook'}
              requestEnabled={requestEnabled}
              onOpen={() => {
                if (canOpen) router.push(`/consume/${result.work_id}?mode=listen`);
              }}
              onRequest={() => onRequest('audiobook')}
            />
            {canChooseRelease ? (
              <Button label="Choose release" kind="quiet" onPress={onChooseRelease} />
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}

export default function SearchScreen() {
  const auth = useAuth();
  const params = useLocalSearchParams<{ q?: string; status?: string }>();
  const status = params.status || '';
  const [query, setQuery] = useState(params.q || '');
  const [sort, setSort] = useState('recent');
  const [availability, setAvailability] = useState('all');
  const [browseWorks, setBrowseWorks] = useState<WorkSummary[]>([]);
  const [browseHasMore, setBrowseHasMore] = useState(false);
  const [browseLoadingMore, setBrowseLoadingMore] = useState(false);
  const [results, setResults] = useState<TitleSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState('');
  const [destinations, setDestinations] = useState<AcquisitionDestination[]>([]);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [libraryID, setLibraryID] = useState('');
  const [acquisitionEnabled, setAcquisitionEnabled] = useState(false);
  const [requestBusy, setRequestBusy] = useState<Record<string, string>>({});
  const [requestErrors, setRequestErrors] = useState<Record<string, string>>({});
  const [advancedTarget, setAdvancedTarget] = useState<TitleSearchResult>();
  const [advancedResults, setAdvancedResults] = useState<AcquisitionResult[]>([]);
  const [advancedSearching, setAdvancedSearching] = useState(false);
  const [advancedError, setAdvancedError] = useState('');
  const [releaseStatuses, setReleaseStatuses] = useState<Record<string, ReleaseStatus>>({});
  const [releaseErrors, setReleaseErrors] = useState<Record<string, string>>({});
  const [discoveryID, setDiscoveryID] = useState('');
  const searchSequence = useRef(0);

  const trimmedQuery = query.trim();
  const effectiveLibraries = libraries.filter((library) => library.effective);
  const canAdvanced =
    Boolean(auth.user?.admin) ||
    libraries.some((library) => library.can_advanced_acquisition_request);
  const advancedGroups = groupAcquisitionResults(advancedResults);

  useEffect(() => {
    let active = true;
    Promise.all([api.acquisitionCapabilities(), api.libraries()])
      .then(([capabilities, nextLibraries]) => {
        if (!active) return;
        setAcquisitionEnabled(capabilities.enabled);
        setDestinations(capabilities.destinations);
        setLibraries(nextLibraries);
      })
      .catch(() => {
        if (active) setAcquisitionEnabled(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function loadBrowse(offset = 0) {
    const sequence = ++searchSequence.current;
    if (offset === 0) setLoading(true);
    else setBrowseLoadingMore(true);
    setError('');
    try {
      const page = await api.browseWorks({
        libraryID,
        sort,
        availability,
        status,
        limit: 24,
        offset,
      });
      if (sequence !== searchSequence.current) return;
      setBrowseWorks((current) => (offset ? [...current, ...page.items] : page.items));
      setBrowseHasMore(page.has_more);
      setOffline(false);
    } catch (value) {
      if (sequence !== searchSequence.current) return;
      if (!(value instanceof APIError && value.status === 0)) {
        setError(errorMessage(value));
        return;
      }
      const saved = offlineBrowseWorks(await offlineWorkSummaries(libraryID || undefined), {
        availability,
        sort,
        status,
      });
      if (sequence !== searchSequence.current) return;
      setBrowseWorks(saved);
      setBrowseHasMore(false);
      setOffline(true);
      if (!saved.length) setError(errorMessage(value));
    } finally {
      if (sequence === searchSequence.current) {
        setLoading(false);
        setBrowseLoadingMore(false);
      }
    }
  }

  useEffect(() => {
    const sequence = ++searchSequence.current;
    if (!trimmedQuery) {
      setResults([]);
      void loadBrowse();
      return;
    }
    const timer = setTimeout(() => {
      setLoading(true);
      setError('');
      api
        .searchTitles(trimmedQuery, libraryID)
        .then((values) => {
          if (sequence !== searchSequence.current) return;
          setResults(values);
          setOffline(false);
        })
        .catch(async (value: unknown) => {
          if (sequence !== searchSequence.current) return;
          if (!(value instanceof APIError && value.status === 0)) {
            setError(errorMessage(value));
            setResults([]);
            return;
          }
          const normalized = trimmedQuery.toLocaleLowerCase();
          const saved = (await offlineWorkSummaries())
            .filter((work) => !libraryID || work.library_id === libraryID)
            .filter((work) =>
              `${work.title} ${work.author ?? ''}`.toLocaleLowerCase().includes(normalized),
            )
            .map(localResult);
          if (sequence !== searchSequence.current) return;
          setResults(saved);
          setOffline(true);
          if (!saved.length) setError(errorMessage(value));
        })
        .finally(() => {
          if (sequence === searchSequence.current) setLoading(false);
        });
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmedQuery, libraryID, sort, availability, status]);

  async function requestFormat(result: TitleSearchResult, format: BookFormat) {
    const destination = destinationFor(result, destinations, libraryID);
    const key = resultKey(result);
    if (!destination) {
      setRequestErrors((current) => ({
        ...current,
        [key]: 'An owner needs to finish ebook and audiobook download setup first.',
      }));
      return;
    }
    setRequestBusy((current) => ({ ...current, [key]: format }));
    setRequestErrors((current) => ({ ...current, [key]: '' }));
    try {
      const request = await api.createTitleRequest(destination.library_id, {
        work_id: result.work_id ?? '',
        external_source: result.external_source ?? '',
        external_id: result.external_id ?? '',
        title: result.title,
        author: result.author ?? '',
        cover_url: result.cover_url ?? '',
        formats: [format],
      });
      const state = request.formats.find((item) => item.format === format)?.state ?? 'wanted';
      setResults((current) =>
        current.map((item) =>
          resultKey(item) === key
            ? {
                ...item,
                [format === 'ebook' ? 'ebook_request_state' : 'audiobook_request_state']: state,
              }
            : item,
        ),
      );
    } catch (value) {
      const message =
        value instanceof APIError && value.status === 400
          ? 'An owner needs to finish the download rules and default destinations for this format.'
          : errorMessage(value);
      setRequestErrors((current) => ({ ...current, [key]: message }));
    } finally {
      setRequestBusy((current) => ({ ...current, [key]: '' }));
    }
  }

  async function openAdvanced(result: TitleSearchResult) {
    const destination = destinationFor(result, destinations, libraryID);
    setAdvancedTarget(result);
    setAdvancedResults([]);
    setAdvancedError('');
    setReleaseStatuses({});
    setReleaseErrors({});
    setDiscoveryID('');
    if (!destination) {
      setAdvancedError('An owner needs to finish download setup first.');
      return;
    }
    setAdvancedSearching(true);
    try {
      const discovery = await api.discoverAcquisitions(destination.library_id, {
        query: [result.title, result.author].filter(Boolean).join(' '),
        source_id: destination.source_id,
      });
      setDiscoveryID(discovery.id);
      setAdvancedResults(discovery.results);
    } catch (value) {
      setAdvancedError(errorMessage(value));
    } finally {
      setAdvancedSearching(false);
    }
  }

  async function chooseRelease(result: AcquisitionResult) {
    if (!advancedTarget || !discoveryID) return;
    const destination = destinationFor(advancedTarget, destinations, libraryID);
    if (!destination) return;
    setReleaseStatuses((current) => ({ ...current, [result.id]: 'sending' }));
    setReleaseErrors((current) => ({ ...current, [result.id]: '' }));
    try {
      await api.selectAcquisitionDiscovery(destination.library_id, discoveryID, {
        result_id: result.id,
      });
      setReleaseStatuses((current) => ({ ...current, [result.id]: 'queued' }));
    } catch (value) {
      setReleaseStatuses((current) => ({ ...current, [result.id]: 'error' }));
      setReleaseErrors((current) => ({ ...current, [result.id]: errorMessage(value) }));
    }
  }

  async function choosePair(first: AcquisitionResult, second: AcquisitionResult) {
    if (!advancedTarget || !discoveryID) return;
    const destination = destinationFor(advancedTarget, destinations, libraryID);
    if (!destination) return;
    setReleaseStatuses((current) => ({
      ...current,
      [first.id]: 'sending',
      [second.id]: 'sending',
    }));
    try {
      await api.selectAcquisitionPair(destination.library_id, discoveryID, {
        result_ids: [first.id, second.id],
      });
      setReleaseStatuses((current) => ({
        ...current,
        [first.id]: 'queued',
        [second.id]: 'queued',
      }));
    } catch (value) {
      const message = errorMessage(value);
      setReleaseStatuses((current) => ({
        ...current,
        [first.id]: 'error',
        [second.id]: 'error',
      }));
      setReleaseErrors((current) => ({
        ...current,
        [first.id]: message,
        [second.id]: message,
      }));
    }
  }

  return (
    <Page title={statusTitles[status] || 'Discover'} hideHeader>
      <View className="max-w-[760px]">
        <SearchField
          label="Search title, author, or ISBN"
          value={query}
          onChangeText={setQuery}
          placeholder="What do you want to read or listen to?"
        />
      </View>
      {effectiveLibraries.length > 1 ? (
        <BrowseFacet
          label="Library"
          options={[
            { value: '', label: 'All libraries' },
            ...effectiveLibraries.map((library) => ({ value: library.id, label: library.name })),
          ]}
          value={libraryID}
          onChange={setLibraryID}
        />
      ) : null}
      {!trimmedQuery ? (
        <BrowseControls
          sort={sort}
          availability={availability}
          onSortChange={setSort}
          onAvailabilityChange={setAvailability}
        />
      ) : null}
      {offline ? (
        <Notice>
          Offline · {trimmedQuery ? 'searching' : 'showing'} books downloaded to this device.
        </Notice>
      ) : null}
      {!acquisitionEnabled && trimmedQuery && !offline ? (
        <Notice tone="warning">
          Missing formats cannot be requested until an owner finishes download setup.
        </Notice>
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {!trimmedQuery ? (
        loading && browseWorks.length === 0 ? (
          <LoadingState label="Finding books…" />
        ) : browseWorks.length === 0 ? (
          <EmptyState icon="read" title="Nothing here yet">
            {"Books you have access to will show up here once they're added."}
          </EmptyState>
        ) : (
          <View className="items-start gap-6">
            <WorkGrid works={browseWorks} onOpen={(work) => router.push(`/work/${work.id}`)} />
            {browseHasMore ? (
              <Button
                label={browseLoadingMore ? 'Loading…' : 'Load more'}
                disabled={browseLoadingMore}
                onPress={() => void loadBrowse(browseWorks.length)}
              />
            ) : null}
          </View>
        )
      ) : loading && results.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <LoadingState label="Searching titles…" />
        </View>
      ) : results.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <EmptyState icon="search" title="No matching titles">
            Check the title or author and try again.
          </EmptyState>
        </View>
      ) : (
        <Section title={`${results.length} ${results.length === 1 ? 'title' : 'titles'}`}>
          <View className="max-w-[900px]">
            {results.map((result) => {
              const key = resultKey(result);
              const destination = destinationFor(result, destinations, libraryID);
              const advancedForDestination =
                canAdvanced &&
                Boolean(destination) &&
                (Boolean(auth.user?.admin) ||
                  libraries.some(
                    (library) =>
                      library.id === destination?.library_id &&
                      library.can_advanced_acquisition_request,
                  ));
              return (
                <View key={key}>
                  <TitleRow
                    result={result}
                    requestBusy={requestBusy[key] ?? ''}
                    requestEnabled={acquisitionEnabled && Boolean(destination) && !offline}
                    canChooseRelease={advancedForDestination && !offline}
                    onRequest={(format) => void requestFormat(result, format)}
                    onChooseRelease={() => void openAdvanced(result)}
                  />
                  {requestErrors[key] ? (
                    <Text accessibilityRole="alert" className="pb-3 text-sm text-danger">
                      {requestErrors[key]}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        </Section>
      )}

      <Dialog
        visible={Boolean(advancedTarget)}
        title={advancedTarget ? `Choose release · ${advancedTarget.title}` : 'Choose release'}
        wide
        onClose={() => setAdvancedTarget(undefined)}
      >
        <View className="gap-4">
          <Notice>
            Advanced choices may ignore the owner’s guided download rules. Review the release before
            adding it.
          </Notice>
          {advancedError ? <Notice tone="danger">{advancedError}</Notice> : null}
          {advancedSearching ? (
            <LoadingState label="Finding releases…" />
          ) : advancedGroups.length ? (
            <View>
              {advancedGroups.map((group) => (
                <AcquisitionGroupRow
                  key={group.key}
                  group={group}
                  statuses={releaseStatuses}
                  errors={releaseErrors}
                  allResults={advancedResults}
                  disabled={Object.values(releaseStatuses).some((state) => state === 'sending')}
                  onAdd={(result) => void chooseRelease(result)}
                  onAddPair={(first, second) => void choosePair(first, second)}
                />
              ))}
            </View>
          ) : !advancedError ? (
            <EmptyState icon="search" title="No releases found">
              Try again later or use the guided request to keep watching for this title.
            </EmptyState>
          ) : null}
        </View>
      </Dialog>
    </Page>
  );
}
