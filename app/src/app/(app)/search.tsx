import type {
  AcquisitionDestination,
  AcquisitionResult,
  Library,
  TitleSearchResult,
} from '@/generated/api';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { groupAcquisitionResults } from '@/features/acquisition';
import { BookCover } from '@/features/bookshelf';
import { AcquisitionGroupRow } from '@/features/browse';
import { useAuth } from '@/features/auth/AuthProvider';
import { titleRequestPresentation } from '@/features/title-search';
import { Text, View } from '@/features/tw';
import {
  Button,
  IconButton,
  Dialog,
  EmptyState,
  ErrorState,
  LoadingState,
  Notice,
  Page,
  SearchField,
  Section,
  StatusBadge,
} from '@/features/ui';
import { APIError, api, errorMessage } from '@/lib/api';

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
      ) : (!state || state.requestable) && !requestEnabled ? (
        <Text className="py-2 text-sm text-muted">{label} unavailable</Text>
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
          <Text className="mt-1 text-sm text-muted">
            {canOpen ? 'In your library' : 'Not in your library'}
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
              <IconButton
                icon="more"
                label={`Request options for ${result.title}`}
                kind="quiet"
                onPress={onChooseRelease}
              />
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
  const [query, setQuery] = useState(params.q || '');
  const [results, setResults] = useState<TitleSearchResult[]>([]);
  const [loading, setLoading] = useState(Boolean(params.q?.trim()));
  const [retry, setRetry] = useState(0);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState('');
  const [destinations, setDestinations] = useState<AcquisitionDestination[]>([]);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const libraryID = '';

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

  const trimmedQuery = query.trim();
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

  useEffect(() => {
    let active = true;
    if (!trimmedQuery) return;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const values = await api.searchTitles(trimmedQuery);
        if (active) {
          setResults(values);
          setOffline(false);
        }
      } catch (value) {
        if (active) {
          setOffline(value instanceof APIError && value.status === 0);
          setError(errorMessage(value));
        }
      } finally {
        if (active) setLoading(false);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      active = false;
    };
  }, [trimmedQuery, retry]);

  function search(value: string) {
    setQuery(value);
    setResults([]);
    setError('');
    setLoading(Boolean(value.trim()));
  }

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
    <Page title="Discover" editorial={false}>
      <SearchField
        label="Search for books to request"
        hideLabel
        value={query}
        onChangeText={search}
        placeholder="Search by title, author, or ISBN"
      />
      {!trimmedQuery ? (
        <EmptyState
          icon="discover"
          title="Find your next read"
          action={
            <Button
              label="Open your library"
              kind="quiet"
              onPress={() => router.navigate('/books')}
            />
          }
        >
          Search for books to request as ebooks or audiobooks. Books you already have are marked in
          the results.
        </EmptyState>
      ) : offline ? (
        <EmptyState
          icon="search"
          title="Discover needs a connection"
          action={<Button label="Open your library" onPress={() => router.navigate('/books')} />}
        >
          You can still read and listen to downloaded books in Library.
        </EmptyState>
      ) : error ? (
        <ErrorState
          title="Couldn’t search for books"
          action={<Button label="Retry" onPress={() => setRetry((value) => value + 1)} />}
        >
          {error}
        </ErrorState>
      ) : loading ? (
        <LoadingState label="Finding books…" />
      ) : results.length === 0 ? (
        <EmptyState icon="search" title="No matching books">
          Try another title, author, or ISBN.
        </EmptyState>
      ) : (
        <Section title="Search results">
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
