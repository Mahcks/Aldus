import type {
  AcquisitionDestination,
  AcquisitionResult,
  Library,
  TitleSearchResult,
  TrendingSection,
} from '@/generated/api';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { groupAcquisitionResults } from '@/features/acquisition';
import { AppIcon } from '@/features/icons';
import { BookCover } from '@/features/bookshelf';
import { AcquisitionGroupRow } from '@/features/browse';
import { useAuth } from '@/features/auth/AuthProvider';
import { titleRequestPresentation } from '@/features/title-search';
import { Pressable, Text, View } from '@/features/tw';
import {
  Button,
  colors,
  Dialog,
  EmptyState,
  ErrorState,
  LoadingState,
  Notice,
  Page,
  resolvePressStateClass,
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
  pending,
  requestEnabled,
  onOpen,
  onRequest,
}: {
  format: BookFormat;
  available: boolean;
  requestState?: string;
  busy: boolean;
  pending: boolean;
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
          disabled={!requestEnabled || pending}
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

/**
 * A book on Discover is never in-hand yet, so the row itself stays a plain
 * "learn more" trigger — cover, title, author, and whether it's already in
 * the library — with every request/format decision pushed into the detail
 * dialog. This is the same declutter as Library's grid: the list stays
 * scannable, the decisions live one tap away.
 */
function TitleRow({ result, onPress }: { result: TitleSearchResult; onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const stateClass = resolvePressStateClass({ focused, pressed });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${result.title}${result.author ? ` by ${result.author}` : ''}`}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={onPress}
      className={`min-h-16 flex-row items-center gap-4 rounded-control border-b border-line py-4 ${stateClass}`}
    >
      <BookCover
        title={result.title}
        author={result.author}
        coverURL={result.cover_url}
        size="mini"
      />
      <View className="min-w-0 flex-1 gap-1">
        <Text numberOfLines={2} className="font-editorial-bold text-lg leading-6 text-ink">
          {result.title}
        </Text>
        <Text numberOfLines={1} className="text-sm text-muted">
          {result.author || 'Unknown author'}
        </Text>
        <Text className="text-sm text-muted">
          {result.work_id ? 'In your library' : 'Not in your library'}
        </Text>
        {result.synchronized ? (
          <View className="mt-1 self-start">
            <StatusBadge tone="info" label="Read & Listen" icon="synced" />
          </View>
        ) : null}
      </View>
      <AppIcon name="chevron" size={20} color={colors.muted} />
    </Pressable>
  );
}

/** "Learn more before requesting" — cover, description, and the same request/format controls the row used to carry directly. */
function DiscoverDetailDialog({
  result,
  description,
  descriptionLoading,
  requestBusy,
  requestError,
  requestEnabled,
  canChooseRelease,
  onRequest,
  onChooseRelease,
  onClose,
}: {
  result: TitleSearchResult;
  description: string;
  descriptionLoading: boolean;
  requestBusy: string;
  requestError: string;
  requestEnabled: boolean;
  canChooseRelease: boolean;
  onRequest: (format: BookFormat) => void;
  onChooseRelease: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog title={result.title} visible onClose={onClose}>
      <View className="gap-4">
        <View className="flex-row items-start gap-4">
          <BookCover
            title={result.title}
            author={result.author}
            coverURL={result.cover_url}
            size="small"
          />
          <View className="min-w-0 flex-1 gap-1">
            <Text className="font-editorial-bold text-xl leading-6 text-ink">{result.title}</Text>
            <Text className="text-base text-muted">{result.author || 'Unknown author'}</Text>
            <Text className="text-sm text-muted">Not in your library</Text>
          </View>
        </View>
        {descriptionLoading ? (
          <LoadingState label="Loading description…" />
        ) : description ? (
          <Text className="text-sm leading-6 text-muted">{description}</Text>
        ) : null}
        {requestError ? (
          <Text accessibilityRole="alert" className="text-sm text-danger">
            {requestError}
          </Text>
        ) : null}
        <View className="gap-3 border-t border-line pt-4">
          <FormatAction
            format="ebook"
            available={false}
            requestState={result.ebook_request_state}
            busy={requestBusy === 'ebook'}
            pending={Boolean(requestBusy)}
            requestEnabled={requestEnabled}
            onOpen={() => {}}
            onRequest={() => onRequest('ebook')}
          />
          <FormatAction
            format="audiobook"
            available={false}
            requestState={result.audiobook_request_state}
            busy={requestBusy === 'audiobook'}
            pending={Boolean(requestBusy)}
            requestEnabled={requestEnabled}
            onOpen={() => {}}
            onRequest={() => onRequest('audiobook')}
          />
        </View>
        {canChooseRelease ? (
          <Button label="Choose a specific release" kind="quiet" onPress={onChooseRelease} />
        ) : null}
      </View>
    </Dialog>
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

  const [trending, setTrending] = useState<TrendingSection[]>([]);
  const [trendingLoading, setTrendingLoading] = useState(true);
  const [trendingError, setTrendingError] = useState('');

  const [acquisitionEnabled, setAcquisitionEnabled] = useState(false);
  const [requestBusy, setRequestBusy] = useState<Record<string, string>>({});
  const [requestErrors, setRequestErrors] = useState<Record<string, string>>({});
  const [detailTarget, setDetailTarget] = useState<TitleSearchResult>();
  const [detailDescription, setDetailDescription] = useState('');
  const [detailDescriptionLoading, setDetailDescriptionLoading] = useState(false);
  const [advancedTarget, setAdvancedTarget] = useState<TitleSearchResult>();
  const [advancedResults, setAdvancedResults] = useState<AcquisitionResult[]>([]);
  const [advancedSearching, setAdvancedSearching] = useState(false);
  const [advancedError, setAdvancedError] = useState('');
  const [releaseStatuses, setReleaseStatuses] = useState<Record<string, ReleaseStatus>>({});
  const [releaseErrors, setReleaseErrors] = useState<Record<string, string>>({});
  const [discoveryID, setDiscoveryID] = useState('');
  const advancedGeneration = useRef(0);
  useEffect(
    () => () => {
      advancedGeneration.current++;
    },
    [],
  );

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
    api
      .trending()
      .then((sections) => {
        if (!active) return;
        setTrending(sections);
        setTrendingError('');
      })
      .catch((value) => {
        if (!active) return;
        setTrending([]);
        setTrendingError(errorMessage(value));
      })
      .finally(() => active && setTrendingLoading(false));
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
    if (value.trim() === trimmedQuery) return;
    setOffline(false);
    setResults([]);
    setError('');
    setLoading(Boolean(value.trim()));
  }

  function canChooseReleaseFor(result: TitleSearchResult) {
    const destination = destinationFor(result, destinations, libraryID);
    return (
      canAdvanced &&
      Boolean(destination) &&
      (Boolean(auth.user?.admin) ||
        libraries.some(
          (library) =>
            library.id === destination?.library_id && library.can_advanced_acquisition_request,
        ))
    );
  }

  function openResult(result: TitleSearchResult) {
    if (result.work_id) {
      router.push(`/work/${result.work_id}`);
      return;
    }
    setDetailTarget(result);
  }

  useEffect(() => {
    let active = true;
    setDetailDescription('');
    const source = detailTarget?.external_source;
    const id = detailTarget?.external_id;
    setDetailDescriptionLoading(source === 'open_library' && Boolean(id));
    if (source === 'open_library' && id) {
      void api
        .discoverDetail(source, id)
        .then((detail) => {
          if (active) setDetailDescription(detail.description);
        })
        .catch(() => {})
        .finally(() => {
          if (active) setDetailDescriptionLoading(false);
        });
    }
    return () => {
      active = false;
    };
  }, [detailTarget?.external_source, detailTarget?.external_id]);

  async function requestFormat(result: TitleSearchResult, format: BookFormat) {
    const destination = destinationFor(result, destinations, libraryID);
    const key = resultKey(result);
    if (requestBusy[key]) return;
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
      const applyState = (item: TitleSearchResult) =>
        resultKey(item) === key
          ? {
              ...item,
              [format === 'ebook' ? 'ebook_request_state' : 'audiobook_request_state']: state,
            }
          : item;
      setResults((current) => current.map(applyState));
      setTrending((current) =>
        current.map((section) => ({ ...section, items: section.items.map(applyState) })),
      );
      setDetailTarget((current) => (current ? applyState(current) : current));
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
    const generation = ++advancedGeneration.current;
    const destination = destinationFor(result, destinations, libraryID);
    setDetailTarget(undefined);
    setAdvancedTarget(result);
    setAdvancedResults([]);
    setAdvancedError('');
    setReleaseStatuses({});
    setReleaseErrors({});
    setDiscoveryID('');
    setAdvancedSearching(false);
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
      if (generation !== advancedGeneration.current) return;
      setDiscoveryID(discovery.id);
      setAdvancedResults(discovery.results);
    } catch (value) {
      if (generation === advancedGeneration.current) setAdvancedError(errorMessage(value));
    } finally {
      if (generation === advancedGeneration.current) setAdvancedSearching(false);
    }
  }

  async function chooseRelease(result: AcquisitionResult) {
    if (!advancedTarget || !discoveryID) return;
    const generation = advancedGeneration.current;
    const destination = destinationFor(advancedTarget, destinations, libraryID);
    if (!destination) return;
    setReleaseStatuses((current) => ({ ...current, [result.id]: 'sending' }));
    setReleaseErrors((current) => ({ ...current, [result.id]: '' }));
    try {
      await api.selectAcquisitionDiscovery(destination.library_id, discoveryID, {
        result_id: result.id,
      });
      if (generation !== advancedGeneration.current) return;
      setReleaseStatuses((current) => ({ ...current, [result.id]: 'queued' }));
    } catch (value) {
      if (generation !== advancedGeneration.current) return;
      setReleaseStatuses((current) => ({ ...current, [result.id]: 'error' }));
      setReleaseErrors((current) => ({ ...current, [result.id]: errorMessage(value) }));
    }
  }

  async function choosePair(first: AcquisitionResult, second: AcquisitionResult) {
    if (!advancedTarget || !discoveryID) return;
    const generation = advancedGeneration.current;
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
      if (generation !== advancedGeneration.current) return;
      setReleaseStatuses((current) => ({
        ...current,
        [first.id]: 'queued',
        [second.id]: 'queued',
      }));
    } catch (value) {
      if (generation !== advancedGeneration.current) return;
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
        trendingLoading ? (
          <LoadingState label="Finding what's popular…" />
        ) : trending.length ? (
          <View className="gap-8">
            {trending.map((section) => (
              <Section key={section.source} title={section.title}>
                <View className="max-w-[900px]">
                  {section.items.map((result) => (
                    <TitleRow
                      key={resultKey(result)}
                      result={result}
                      onPress={() => openResult(result)}
                    />
                  ))}
                </View>
              </Section>
            ))}
          </View>
        ) : (
          <>
            <Notice>
              {trendingError
                ? `Trending books couldn't load: ${trendingError}`
                : "Trending books couldn't load right now — this usually means the server can't reach the internet. You can still search."}
            </Notice>
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
              Search for books to request as ebooks or audiobooks. Books you already have are marked
              in the results.
            </EmptyState>
          </>
        )
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
            {results.map((result) => (
              <TitleRow
                key={resultKey(result)}
                result={result}
                onPress={() => openResult(result)}
              />
            ))}
          </View>
        </Section>
      )}
      {detailTarget ? (
        <DiscoverDetailDialog
          result={detailTarget}
          description={detailDescription}
          descriptionLoading={detailDescriptionLoading}
          requestBusy={requestBusy[resultKey(detailTarget)] ?? ''}
          requestError={requestErrors[resultKey(detailTarget)] ?? ''}
          requestEnabled={
            acquisitionEnabled &&
            Boolean(destinationFor(detailTarget, destinations, libraryID)) &&
            !offline
          }
          canChooseRelease={canChooseReleaseFor(detailTarget) && !offline}
          onRequest={(format) => void requestFormat(detailTarget, format)}
          onChooseRelease={() => void openAdvanced(detailTarget)}
          onClose={() => setDetailTarget(undefined)}
        />
      ) : null}
      <Dialog
        visible={Boolean(advancedTarget)}
        title={advancedTarget ? `Choose release · ${advancedTarget.title}` : 'Choose release'}
        wide
        onClose={() => {
          advancedGeneration.current++;
          setAdvancedTarget(undefined);
        }}
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
