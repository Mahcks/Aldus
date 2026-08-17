import type {
  AcquisitionRequest,
  AcquisitionResult,
  Library,
  LibrarySource,
  WorkSummary,
} from '../../generated/api';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import {
  acquisitionFulfillment,
  groupAcquisitionResults,
  parseAcquisitionRelease,
} from '../../features/acquisition';
import { useAuth } from '../../features/auth/AuthProvider';
import { coverPresentation, WorkRow } from '../../features/bookshelf';
import { AcquisitionGroupRow, BrowseControls, DestinationPicker } from '../../features/browse';
import { listItemEnter } from '../../features/motion';
import { Text, View } from '../../features/tw';
import {
  Button,
  EmptyState,
  LoadingState,
  Notice,
  Page,
  SearchField,
  Section,
  StatusBadge,
} from '../../features/ui';
import { api, errorMessage } from '../../lib/api';

type Destination = { library: Library; source: LibrarySource };
type ActiveRequest = { id: string; libraryID: string };
type ResultStatus = 'idle' | 'sending' | 'queued' | 'error';
type SearchView = 'all' | 'library' | 'available';
type AcquisitionKind = 'all' | 'ebook' | 'audiobook';

const MIN_ACQUISITION_QUERY_LENGTH = 2;

function destinationKey(entry: Destination) {
  return `${entry.library.id}:${entry.source.id}`;
}

export default function SearchScreen() {
  const auth = useAuth();
  const narrow = useWindowDimensions().width < 600;
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('recent');
  const [availability, setAvailability] = useState('all');
  const [view, setView] = useState<SearchView>('all');
  const [acquisitionKind, setAcquisitionKind] = useState<AcquisitionKind>('all');
  const [showRelated, setShowRelated] = useState(false);
  const [works, setWorks] = useState<WorkSummary[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [fulfillmentLibraryIDs, setFulfillmentLibraryIDs] = useState<string[]>([]);
  const [destination, setDestination] = useState('');
  const [acquisitionResults, setAcquisitionResults] = useState<AcquisitionResult[]>([]);
  const [activeRequest, setActiveRequest] = useState<ActiveRequest | null>(null);
  const [searchingElsewhere, setSearchingElsewhere] = useState(false);
  const [acquisitionError, setAcquisitionError] = useState('');
  const [resultStatus, setResultStatus] = useState<Record<string, ResultStatus>>({});
  const [resultErrors, setResultErrors] = useState<Record<string, string>>({});
  const [fulfillments, setFulfillments] = useState<AcquisitionRequest[]>([]);
  const [fulfillmentError, setFulfillmentError] = useState('');
  const acquisitionSearchSequence = useRef(0);

  const trimmedQuery = query.trim();

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

  useEffect(() => {
    let active = true;
    void Promise.all([api.libraries(), api.acquisitionCapabilities()])
      .then(async ([libraries, capabilities]) => {
        if (!capabilities.enabled) return;
        const editable = libraries.filter(
          (library) => auth.user?.admin || library.role === 'owner' || library.role === 'editor',
        );
        setFulfillmentLibraryIDs(editable.map((library) => library.id));
        const sourceLists = await Promise.all(
          editable.map(async (library) => ({ library, sources: await api.sources(library.id) })),
        );
        if (!active) return;
        const available = sourceLists.flatMap(({ library, sources }) =>
          sources.filter((source) => source.enabled).map((source) => ({ library, source })),
        );
        setDestinations(available);
        setDestination(available[0] ? destinationKey(available[0]) : '');
      })
      .catch(() => {
        if (active) {
          setDestinations([]);
          setFulfillmentLibraryIDs([]);
        }
      });
    return () => {
      active = false;
    };
  }, [auth.user?.admin]);

  const fulfillmentLibraryKey = fulfillmentLibraryIDs.join(':');

  useEffect(() => {
    if (!fulfillmentLibraryKey) {
      setFulfillments([]);
      return;
    }
    let active = true;
    async function refresh() {
      try {
        const lists = await Promise.all(
          fulfillmentLibraryIDs.map((libraryID) => api.acquisitionRequests(libraryID)),
        );
        if (!active) return;
        setFulfillments(
          lists
            .flat()
            .filter((request) => acquisitionFulfillment(request))
            .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
        );
        setFulfillmentError('');
      } catch (value) {
        if (active) setFulfillmentError(errorMessage(value));
      }
    }
    void refresh();
    const interval = setInterval(() => void refresh(), 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
    // The key is the stable identity of the editable libraries loaded above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fulfillmentLibraryKey]);

  useEffect(() => {
    if (!destination || trimmedQuery.length < MIN_ACQUISITION_QUERY_LENGTH) {
      acquisitionSearchSequence.current += 1;
      setAcquisitionResults([]);
      setActiveRequest(null);
      setAcquisitionError('');
      setResultStatus({});
      setResultErrors({});
      return;
    }
    const selected = destinations.find((entry) => destinationKey(entry) === destination);
    if (!selected) return;

    const timer = setTimeout(() => void searchElsewhere(selected), 450);
    return () => clearTimeout(timer);
    // `searchElsewhere` only depends on the current query and destination,
    // both already covered by this effect's dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmedQuery, destination]);

  async function searchElsewhere(selected: Destination) {
    const sequence = ++acquisitionSearchSequence.current;
    const isStale = () => sequence !== acquisitionSearchSequence.current;
    setSearchingElsewhere(true);
    setAcquisitionError('');
    try {
      const request = await api.createAcquisitionRequest(selected.library.id, {
        query: trimmedQuery,
        source_id: selected.source.id,
      });
      const results = await api.searchAcquisitionRequest(selected.library.id, request.id);
      if (isStale()) return;
      setActiveRequest({ id: request.id, libraryID: selected.library.id });
      setAcquisitionResults(results);
      setShowRelated(false);
      setResultStatus({});
      setResultErrors({});
    } catch (value) {
      if (isStale()) return;
      setAcquisitionError(errorMessage(value));
      setAcquisitionResults([]);
      setActiveRequest(null);
    } finally {
      if (!isStale()) setSearchingElsewhere(false);
    }
  }

  async function acquire(result: AcquisitionResult) {
    if (!activeRequest) return;
    setResultStatus((current) => ({ ...current, [result.id]: 'sending' }));
    setResultErrors((current) => ({ ...current, [result.id]: '' }));
    try {
      const request = await api.selectAcquisitionResult(activeRequest.libraryID, activeRequest.id, {
        result_id: result.id,
      });
      setFulfillments((current) => [
        request,
        ...current.filter((entry) => entry.id !== request.id),
      ]);
      setResultStatus((current) => ({ ...current, [result.id]: 'queued' }));
    } catch (value) {
      setResultStatus((current) => ({ ...current, [result.id]: 'error' }));
      setResultErrors((current) => ({ ...current, [result.id]: errorMessage(value) }));
    }
  }

  function changeQuery(value: string) {
    setQuery(value);
  }

  const librarySourceCounts = destinations.reduce<Record<string, number>>((counts, entry) => {
    counts[entry.library.id] = (counts[entry.library.id] ?? 0) + 1;
    return counts;
  }, {});
  const destinationOptions = destinations.map((entry) => ({
    value: destinationKey(entry),
    label:
      librarySourceCounts[entry.library.id] > 1
        ? `${entry.library.name} · ${entry.source.name}`
        : entry.library.name,
  }));

  const showAcquisitionSection =
    destinations.length > 0 && trimmedQuery.length >= MIN_ACQUISITION_QUERY_LENGTH;
  const prioritizeAcquisition = showAcquisitionSection && !loading && works.length === 0;
  const anySending = Object.values(resultStatus).some((status) => status === 'sending');
  const visibleFulfillments = [
    ...fulfillments.filter((request) => acquisitionFulfillment(request)?.action !== 'open'),
    ...fulfillments
      .filter((request) => acquisitionFulfillment(request)?.action === 'open')
      .slice(0, 3),
  ];
  const acquisitionGroups = groupAcquisitionResults(
    acquisitionResults.filter(
      (result) => acquisitionKind === 'all' || result.kind === acquisitionKind,
    ),
  );
  const exactGroups = acquisitionGroups.filter((group) => group.match === 'exact');
  const relatedGroups = acquisitionGroups.filter((group) => group.match === 'related');
  const relatedPreviewCount = exactGroups.length ? 3 : 6;
  const visibleRelatedGroups = showRelated
    ? relatedGroups
    : relatedGroups.slice(0, relatedPreviewCount);
  const hiddenRelatedCount = relatedGroups.length - visibleRelatedGroups.length;

  function openFulfillment(request: AcquisitionRequest) {
    const state = acquisitionFulfillment(request);
    if (state?.action === 'open' && request.work_id) {
      router.push(`/work/${request.work_id}?libraryId=${request.library_id}`);
    } else if (state?.action === 'review') {
      const proposal = request.proposal_id
        ? `&proposalId=${encodeURIComponent(request.proposal_id)}`
        : '';
      router.push(`/sources?libraryId=${request.library_id}${proposal}`);
    }
  }

  const fulfillmentSection =
    visibleFulfillments.length || fulfillmentError ? (
      <Section title="Library additions">
        {fulfillmentError ? <Notice tone="danger">{fulfillmentError}</Notice> : null}
        <View className="max-w-[900px]">
          {visibleFulfillments.map((request) => {
            const state = acquisitionFulfillment(request);
            if (!state) return null;
            const parsed = parseAcquisitionRelease(request.selected_title ?? request.query);
            const actionable =
              (state.action === 'open' && Boolean(request.work_id)) || state.action === 'review';
            return (
              <View
                key={request.id}
                className="gap-3 border-b border-line py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <View className="min-w-0 flex-1 gap-1">
                  <Text numberOfLines={2} className="font-editorial font-bold text-ink">
                    {parsed.title}
                  </Text>
                  {request.download_error ? (
                    <Text className="text-sm text-danger">{request.download_error}</Text>
                  ) : (
                    <Text className="text-xs text-subtle">
                      {state.pending ? 'This updates automatically.' : request.selected_source}
                    </Text>
                  )}
                </View>
                <View className="flex-row items-center gap-2">
                  <StatusBadge tone={state.tone} label={state.label} />
                  {actionable ? (
                    <Button
                      kind="quiet"
                      label={state.action === 'open' ? 'Open book' : 'Review'}
                      onPress={() => openFulfillment(request)}
                    />
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      </Section>
    ) : null;

  const localSection = (
    <Section
      title="In your libraries"
      action={
        works.length ? (
          <Text className="text-xs font-bold text-subtle">
            {works.length}
            {hasMore ? '+' : ''} result{works.length === 1 ? '' : 's'}
          </Text>
        ) : undefined
      }
    >
      {loading && works.length === 0 ? (
        <LoadingState label="Searching your libraries…" />
      ) : works.length ? (
        <View className="max-w-[900px] items-stretch gap-1">
          {works.map((work, index) => (
            <Animated.View key={work.id} entering={listItemEnter(index)}>
              <WorkRow
                title={work.title}
                author={work.author}
                coverURL={work.cover_url}
                coverPresentation={coverPresentation(work)}
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
      ) : trimmedQuery && showAcquisitionSection ? (
        <Text className="py-2 text-sm text-muted">Not in your libraries.</Text>
      ) : (
        <EmptyState icon="search" title={trimmedQuery ? 'No matching works' : 'No works to search'}>
          {trimmedQuery
            ? 'Try another title, author, or availability filter.'
            : 'Works from every Library you can access will appear here.'}
        </EmptyState>
      )}
    </Section>
  );

  const acquisitionSection = showAcquisitionSection ? (
    <Section
      title="Available to add"
      action={
        narrow ? undefined : (
          <DestinationPicker
            options={destinationOptions}
            value={destination}
            onChange={setDestination}
          />
        )
      }
    >
      {narrow ? (
        <DestinationPicker
          options={destinationOptions}
          value={destination}
          onChange={setDestination}
        />
      ) : null}
      {acquisitionError ? <Notice tone="danger">{acquisitionError}</Notice> : null}
      {searchingElsewhere ? (
        <LoadingState label="Searching book and audiobook sources…" />
      ) : acquisitionGroups.length ? (
        <View className="max-w-[960px] gap-3">
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel="Available format"
            className="flex-row flex-wrap gap-2"
          >
            {(
              [
                ['all', 'All formats'],
                ['ebook', 'Ebooks'],
                ['audiobook', 'Audiobooks'],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                kind="secondary"
                label={label}
                selected={acquisitionKind === value}
                accessibilityRole="radio"
                onPress={() => {
                  setAcquisitionKind(value);
                  setShowRelated(false);
                }}
              />
            ))}
          </View>
          {exactGroups.length ? (
            <View className="gap-1">
              <View className="flex-row items-center justify-between border-b border-line pb-2">
                <Text className="text-sm font-bold text-ink">Best matches</Text>
                <Text className="text-xs text-subtle">
                  {exactGroups.length} title{exactGroups.length === 1 ? '' : 's'}
                </Text>
              </View>
              {exactGroups.map((group) => (
                <AcquisitionGroupRow
                  key={group.key}
                  group={group}
                  allResults={acquisitionResults}
                  statuses={resultStatus}
                  errors={resultErrors}
                  disabled={anySending}
                  onAdd={(result) => void acquire(result)}
                />
              ))}
            </View>
          ) : null}
          {relatedGroups.length ? (
            <View className={exactGroups.length ? 'mt-1' : 'gap-1'}>
              <View className="flex-row items-center justify-between border-b border-line pb-2">
                <Text className="text-sm font-bold text-ink">
                  {exactGroups.length ? 'Related books' : 'Results'}
                </Text>
                <Text className="text-xs text-subtle">
                  {relatedGroups.length} title{relatedGroups.length === 1 ? '' : 's'}
                </Text>
              </View>
              <View>
                {visibleRelatedGroups.map((group) => (
                  <AcquisitionGroupRow
                    key={group.key}
                    group={group}
                    allResults={acquisitionResults}
                    statuses={resultStatus}
                    errors={resultErrors}
                    disabled={anySending}
                    onAdd={(result) => void acquire(result)}
                  />
                ))}
              </View>
              {hiddenRelatedCount > 0 || showRelated ? (
                <Button
                  kind="quiet"
                  label={showRelated ? 'Show fewer' : `Show ${hiddenRelatedCount} more`}
                  onPress={() => setShowRelated((value) => !value)}
                />
              ) : null}
            </View>
          ) : null}
        </View>
      ) : !acquisitionError ? (
        <Text className="py-2 text-sm text-muted">
          {acquisitionResults.length
            ? 'No results match this format.'
            : 'No sources found this title.'}
        </Text>
      ) : null}
    </Section>
  ) : null;

  return (
    <Page title="Search">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <View className="max-w-[1000px] gap-4">
        <View className="w-full">
          <SearchField
            label="Search title, author, or ISBN"
            value={query}
            onChangeText={changeQuery}
          />
        </View>
        <View className="gap-3 border-b border-line pb-4">
          <View accessibilityRole="tablist" className="flex-row flex-wrap gap-2">
            {(
              [
                ['all', 'All'],
                ['library', 'In your libraries'],
                ['available', 'Available to add'],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                kind="secondary"
                label={label}
                selected={view === value}
                accessibilityRole="tab"
                onPress={() => setView(value)}
              />
            ))}
          </View>
          {view !== 'available' ? (
            <BrowseControls
              sort={sort}
              availability={availability}
              onSortChange={setSort}
              onAvailabilityChange={setAvailability}
            />
          ) : null}
        </View>
      </View>
      {fulfillmentSection}
      {view === 'library' ? (
        localSection
      ) : view === 'available' ? (
        acquisitionSection
      ) : prioritizeAcquisition ? (
        <>
          {acquisitionSection}
          {localSection}
        </>
      ) : (
        <>
          {localSection}
          {acquisitionSection}
        </>
      )}
    </Page>
  );
}
