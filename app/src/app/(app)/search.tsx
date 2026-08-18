import type {
  AcquisitionRequest,
  AcquisitionResult,
  AcquisitionDestination,
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
import { coverPresentation, WorkRow } from '../../features/bookshelf';
import { AcquisitionGroupRow, BrowseControls, DestinationPicker } from '../../features/browse';
import { listItemEnter } from '../../features/motion';
import {
  ReadingStatusDialog,
  readingStatusLabel,
  type ReadingStatus,
} from '../../features/reading-status';
import { Text, View } from '../../features/tw';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  LoadingState,
  Notice,
  Page,
  SearchField,
  Section,
  StatusBadge,
} from '../../features/ui';
import { APIError, api, errorMessage } from '../../lib/api';
import { offlineWorkSummaries } from '../../lib/offline-library';

type ActiveRequest = { id: string; libraryID: string };
type ResultStatus = 'idle' | 'sending' | 'queued' | 'error';
type SearchView = 'all' | 'library' | 'available';
type AcquisitionKind = 'all' | 'ebook' | 'audiobook';

const MIN_ACQUISITION_QUERY_LENGTH = 2;

function destinationKey(entry: AcquisitionDestination) {
  return `${entry.library_id}:${entry.source_id}`;
}

export default function SearchScreen() {
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
  const [offline, setOffline] = useState(false);
  const [statusTarget, setStatusTarget] = useState<WorkSummary>();
  const [statusBusy, setStatusBusy] = useState(false);

  const [destinations, setDestinations] = useState<AcquisitionDestination[]>([]);
  const [destination, setDestination] = useState('');
  const [acquisitionResults, setAcquisitionResults] = useState<AcquisitionResult[]>([]);
  const [activeRequest, setActiveRequest] = useState<ActiveRequest | null>(null);
  const [searchingElsewhere, setSearchingElsewhere] = useState(false);
  const [acquisitionError, setAcquisitionError] = useState('');
  const [resultStatus, setResultStatus] = useState<Record<string, ResultStatus>>({});
  const [resultErrors, setResultErrors] = useState<Record<string, string>>({});
  const [fulfillments, setFulfillments] = useState<AcquisitionRequest[]>([]);
  const [fulfillmentError, setFulfillmentError] = useState('');
  const [requestAction, setRequestAction] = useState('');
  const [cancelTarget, setCancelTarget] = useState<AcquisitionRequest | null>(null);
  const acquisitionSearchSequence = useRef(0);

  const trimmedQuery = query.trim();

  async function load(offset = 0) {
    setLoading(true);
    setError('');
    try {
      const page = await api.browseWorks({ q: query, sort, availability, limit: 24, offset });
      setWorks((current) => (offset ? [...current, ...page.items] : page.items));
      setHasMore(page.has_more);
      setOffline(false);
    } catch (value) {
      if (!(value instanceof APIError && value.status === 0)) {
        setError(errorMessage(value));
        return;
      }
      const normalizedQuery = query.trim().toLocaleLowerCase();
      const saved = (await offlineWorkSummaries()).filter((work) => {
        if (
          normalizedQuery &&
          !`${work.title} ${work.author ?? ''}`.toLocaleLowerCase().includes(normalizedQuery)
        )
          return false;
        if (availability === 'readable') return work.readable;
        if (availability === 'listenable') return work.listenable;
        if (availability === 'synchronized') return work.synchronized;
        return true;
      });
      setWorks(saved);
      setHasMore(false);
      setOffline(true);
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
    void api
      .acquisitionCapabilities()
      .then((capabilities) => {
        if (!active || !capabilities.enabled) return;
        setDestinations(capabilities.destinations);
        setDestination(
          capabilities.destinations[0] ? destinationKey(capabilities.destinations[0]) : '',
        );
      })
      .catch(() => {
        if (active) {
          setDestinations([]);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function refreshFulfillments() {
    try {
      const tracker = await api.acquisitionTracker();
      setFulfillments(
        tracker.requests
          .filter((request) => acquisitionFulfillment(request))
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
      );
      setFulfillmentError('');
    } catch (value) {
      if (!(value instanceof APIError && value.status === 0))
        setFulfillmentError(errorMessage(value));
    }
  }

  useEffect(() => {
    void refreshFulfillments();
    const interval = setInterval(() => void refreshFulfillments(), 5000);
    return () => {
      clearInterval(interval);
    };
  }, []);

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

  async function searchElsewhere(selected: AcquisitionDestination) {
    const sequence = ++acquisitionSearchSequence.current;
    const isStale = () => sequence !== acquisitionSearchSequence.current;
    setSearchingElsewhere(true);
    setAcquisitionError('');
    try {
      const discovery = await api.discoverAcquisitions(selected.library_id, {
        query: trimmedQuery,
        source_id: selected.source_id,
      });
      if (isStale()) return;
      setActiveRequest({ id: discovery.id, libraryID: selected.library_id });
      setAcquisitionResults(discovery.results);
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
    if (!activeRequest) return false;
    setResultStatus((current) => ({ ...current, [result.id]: 'sending' }));
    setResultErrors((current) => ({ ...current, [result.id]: '' }));
    try {
      const request = await api.selectAcquisitionDiscovery(
        activeRequest.libraryID,
        activeRequest.id,
        { result_id: result.id },
      );
      setFulfillments((current) => [
        request,
        ...current.filter((entry) => entry.id !== request.id),
      ]);
      setResultStatus((current) => ({ ...current, [result.id]: 'queued' }));
      return true;
    } catch (value) {
      setResultStatus((current) => ({ ...current, [result.id]: 'error' }));
      setResultErrors((current) => ({ ...current, [result.id]: errorMessage(value) }));
      return false;
    }
  }

  async function acquirePair(first: AcquisitionResult, second: AcquisitionResult) {
    if (!activeRequest) return;
    const ids = [first.id, second.id];
    setResultStatus((current) => ({ ...current, [first.id]: 'sending', [second.id]: 'sending' }));
    try {
      const pair = await api.selectAcquisitionPair(activeRequest.libraryID, activeRequest.id, {
        result_ids: ids,
      });
      setFulfillments((current) => [
        ...pair.requests,
        ...current.filter((entry) => !pair.requests.some((request) => request.id === entry.id)),
      ]);
      setResultStatus((current) => ({ ...current, [first.id]: 'queued', [second.id]: 'queued' }));
    } catch (value) {
      const message = errorMessage(value);
      setResultStatus((current) => ({ ...current, [first.id]: 'error', [second.id]: 'error' }));
      setResultErrors((current) => ({ ...current, [first.id]: message, [second.id]: message }));
    }
  }

  function changeQuery(value: string) {
    setQuery(value);
  }

  async function changeReadingStatus(status: ReadingStatus) {
    if (!statusTarget || statusBusy) return;
    setStatusBusy(true);
    try {
      await api.setWorkStatus(statusTarget.id, { status });
      setWorks((current) =>
        current.map((work) =>
          work.id === statusTarget.id ? { ...work, reading_status: status } : work,
        ),
      );
      setStatusTarget(undefined);
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setStatusBusy(false);
    }
  }

  const librarySourceCounts = destinations.reduce<Record<string, number>>((counts, entry) => {
    counts[entry.library_id] = (counts[entry.library_id] ?? 0) + 1;
    return counts;
  }, {});
  const destinationOptions = destinations.map((entry) => ({
    value: destinationKey(entry),
    label:
      librarySourceCounts[entry.library_id] > 1
        ? `${entry.library_name} · ${entry.source_name}`
        : entry.library_name,
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

  async function retryFulfillment(request: AcquisitionRequest) {
    setRequestAction(request.id);
    try {
      await api.retryAcquisition(request.library_id, request.id);
      await refreshFulfillments();
    } catch (value) {
      setFulfillmentError(errorMessage(value));
    } finally {
      setRequestAction('');
    }
  }

  async function dismissFulfillment(request: AcquisitionRequest) {
    setRequestAction(request.id);
    try {
      await api.dismissAcquisition(request.library_id, request.id);
      setFulfillments((current) => current.filter((entry) => entry.id !== request.id));
    } catch (value) {
      setFulfillmentError(errorMessage(value));
    } finally {
      setRequestAction('');
    }
  }

  async function confirmCancel() {
    if (!cancelTarget) return;
    setRequestAction(cancelTarget.id);
    try {
      await api.cancelAcquisition(cancelTarget.library_id, cancelTarget.id);
      setCancelTarget(null);
      await refreshFulfillments();
    } catch (value) {
      setFulfillmentError(errorMessage(value));
    } finally {
      setRequestAction('');
    }
  }

  const fulfillmentSection =
    visibleFulfillments.length || fulfillmentError ? (
      <Section title="Your requests">
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
                <View className="flex-row flex-wrap items-center gap-2">
                  <StatusBadge tone={state.tone} label={state.label} />
                  {actionable ? (
                    <Button
                      kind="quiet"
                      label={state.action === 'open' ? 'Open book' : 'Review'}
                      onPress={() => openFulfillment(request)}
                    />
                  ) : null}
                  {request.can_retry ? (
                    <Button
                      kind="secondary"
                      label="Retry"
                      disabled={requestAction === request.id}
                      onPress={() => void retryFulfillment(request)}
                    />
                  ) : null}
                  {request.can_cancel ? (
                    <Button
                      kind="danger"
                      label="Cancel"
                      disabled={requestAction === request.id}
                      onPress={() => setCancelTarget(request)}
                    />
                  ) : null}
                  {request.can_dismiss ? (
                    <Button
                      kind="quiet"
                      label="Dismiss"
                      disabled={requestAction === request.id}
                      onPress={() => void dismissFulfillment(request)}
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
                action={
                  <Button
                    label={readingStatusLabel(work.reading_status)}
                    kind="quiet"
                    selected={Boolean(work.reading_status)}
                    disabled={offline}
                    onPress={() => setStatusTarget(work)}
                  />
                }
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
                  onAddPair={(first, second) => void acquirePair(first, second)}
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
                    onAddPair={(first, second) => void acquirePair(first, second)}
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
      {offline ? <Notice>Offline · searching downloads on this device.</Notice> : null}
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
      <ConfirmDialog
        visible={Boolean(cancelTarget)}
        title="Cancel this download?"
        description="Aldus will remove this download and its partial files from qBittorrent. You can retry the request later."
        confirmLabel="Cancel download"
        danger
        busy={Boolean(cancelTarget && requestAction === cancelTarget.id)}
        onClose={() => setCancelTarget(null)}
        onConfirm={() => void confirmCancel()}
      />
      <ReadingStatusDialog
        work={statusTarget}
        visible={Boolean(statusTarget)}
        busy={statusBusy}
        onChange={(status) => void changeReadingStatus(status)}
        onClose={() => setStatusTarget(undefined)}
      />
    </Page>
  );
}
