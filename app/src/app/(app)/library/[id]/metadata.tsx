import { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/components/auth/AuthProvider';
import { Page } from '@/components/shell/Page';
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  LoadingState,
  Notice,
  RotatingChevron,
  SearchField,
  Select,
  StatusBadge,
} from '@/components/ui';
import { AppIcon } from '@/components/ui/icons';
import { sheetEnter } from '@/components/ui/motion';
import { useThemeColors } from '@/components/ui/theme';
import { AnimatedView, Pressable, Text, View } from '@/components/ui/tw';
import { BookCover } from '@/components/catalog/bookshelf';
import { MetadataReviewDialog } from '@/components/catalog/MetadataReviewDialog';
import { NarratorEditor, type NarratorEditorHandle } from '@/components/catalog/NarratorEditor';
import { BulkMetadataFill } from '@/components/catalog/BulkMetadataFill';
import { FileMetadataReview } from '@/components/catalog/FileMetadataReview';
import { AudiobookMetadataReview } from '@/components/catalog/AudiobookMetadataReview';
import type { Library, Media, Representation, WorkDetail, WorkSummary } from '@/generated/api';
import { api, errorMessage } from '@/lib/api';

const filters = [
  { value: 'any', label: 'Needs attention' },
  { value: '', label: 'All books' },
  { value: 'narrator', label: 'Missing narrator' },
  { value: 'description', label: 'Missing description' },
  { value: 'cover', label: 'No saved cover' },
  { value: 'author', label: 'Missing author' },
];
type Review =
  | { kind: 'book' }
  | { kind: 'file'; mediaID: string }
  | { kind: 'audio'; recording: Representation; asin?: string };

export default function MetadataScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const colors = useThemeColors();
  const { width, height } = useWindowDimensions();
  const compact = width < 820;
  const [library, setLibrary] = useState<Library>();
  const [query, setQuery] = useState('');
  const [bulkWorks, setBulkWorks] = useState<WorkSummary[]>();
  const [filter, setFilter] = useState('any');
  const [books, setBooks] = useState<WorkSummary[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string>();
  const [detail, setDetail] = useState<WorkDetail>();
  const [recordings, setRecordings] = useState<Representation[]>([]);
  const [media, setMedia] = useState<Media[]>([]);
  const [detailError, setDetailError] = useState('');
  const [review, setReview] = useState<Review>();
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const [expandedRecording, setExpandedRecording] = useState<string>();
  const [bookDetailsOpen, setBookDetailsOpen] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [savingDescription, setSavingDescription] = useState(false);
  const [descriptionError, setDescriptionError] = useState('');
  const [pendingAction, setPendingAction] = useState<(() => void) | undefined>(undefined);
  const [savingPending, setSavingPending] = useState(false);
  const [pendingError, setPendingError] = useState('');
  const sequence = useRef(0);
  const narratorHandles = useRef(new Map<string, NarratorEditorHandle>());
  const canEdit = Boolean(
    library && (user?.admin || library.role === 'owner' || library.role === 'editor'),
  );

  async function load(pageOffset = 0) {
    const request = ++sequence.current;
    setLoading(true);
    setError('');
    try {
      const [nextLibrary, page] = await Promise.all([
        api.library(id),
        api.browseWorks({
          libraryID: id,
          q: query,
          metadataMissing: filter,
          sort: 'title',
          limit: 30,
          offset: pageOffset,
        }),
      ]);
      if (request !== sequence.current) return;
      setLibrary(nextLibrary);
      setBooks(page.items);
      setOffset(pageOffset);
      setHasMore(page.has_more);
      return page.items;
    } catch (cause) {
      if (request === sequence.current) setError(errorMessage(cause));
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => void load(), 200);
    return () => {
      clearTimeout(timer);
      // Invalidate an in-flight request, including during unmount.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      sequence.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, query, filter]);

  useEffect(() => {
    if (!selected || !canEdit) return;
    let active = true;
    async function fetchDetail() {
      try {
        const [book, editions] = await Promise.all([
          api.work(selected!),
          api.representations(selected!),
        ]);
        // Only the selected book's files are loaded, never the whole library.
        const files = [] as Media[];
        for (const edition of editions) {
          if (!active) return;
          files.push(...(await api.media(id, edition.id)));
        }
        if (active) {
          setDetail(book);
          setRecordings(editions);
          setMedia(files);
          narratorHandles.current.clear();
          const needsNarrator = editions.find(
            (edition) => edition.kind !== 'epub' && !edition.narrators?.length,
          );
          setExpandedRecording((needsNarrator ?? editions[0])?.id);
        }
      } catch (cause) {
        if (active) setDetailError(errorMessage(cause));
      }
    }
    void fetchDetail();
    return () => {
      active = false;
    };
  }, [id, selected, retry, canEdit]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 2600);
    return () => clearTimeout(timer);
  }, [notice]);

  function select(bookID?: string) {
    if (bookID && bookID === selected) return;
    setSelected(bookID);
    setDetail(undefined);
    setDetailError('');
    setMedia([]);
    setRecordings([]);
    setReview(undefined);
    setExpandedRecording(undefined);
    setBookDetailsOpen(false);
    setEditingDescription(false);
    setDescriptionError('');
  }
  function changeFilter(value: string) {
    setFilter(value);
    select();
    setBooks([]);
    setLoading(true);
  }
  function changeQuery(value: string) {
    setQuery(value);
    select();
    setBooks([]);
    setLoading(true);
  }
  async function saved() {
    const index = books.findIndex((book) => book.id === selected);
    const nextID = books[index + 1]?.id;
    setNotice('Selected changes saved. Other details were kept.');
    select();
    const refreshed = await load(offset);
    if (!refreshed) return;
    if (refreshed.some((book) => book.id === nextID)) select(nextID);
    else if (refreshed[index] && refreshed[index].id !== selected) select(refreshed[index].id);
    else if (hasMore) {
      const page = await load(offset + refreshed.length);
      if (page?.[0]) select(page[0].id);
    }
  }
  // Saving one recording's narrator, or an inline Audnexus lookup, updates this
  // book in place. It never advances the queue, so it never disturbs a draft
  // the reviewer is still typing elsewhere on the same book.
  async function refreshSelected() {
    if (!selected) return;
    try {
      const [book, editions] = await Promise.all([
        api.work(selected),
        api.representations(selected),
      ]);
      setDetail(book);
      setRecordings(editions);
    } catch (cause) {
      setDetailError(errorMessage(cause));
    }
    await load(offset);
  }
  async function goToNextBook() {
    const index = books.findIndex((book) => book.id === selected);
    if (books[index + 1]) select(books[index + 1].id);
    else if (hasMore) {
      const page = await load(offset + books.length);
      if (page?.[0]) select(page[0].id);
    } else {
      select();
      setNotice('You reached the end of this list. Nothing beyond what you applied was saved.');
    }
  }

  function dirtyHandles(): NarratorEditorHandle[] {
    return [...narratorHandles.current.values()].filter((handle) => handle.isDirty());
  }
  function descriptionDirty(): boolean {
    return editingDescription && descriptionDraft !== (detail?.description ?? '');
  }
  function hasUnsavedWork(): boolean {
    return dirtyHandles().length > 0 || descriptionDirty();
  }

  // Every place that would otherwise silently drop an unsaved narrator or
  // description draft — switching books, recordings, filters, or leaving the
  // page — routes through here first.
  function requestTransition(action: () => void) {
    if (hasUnsavedWork()) {
      setPendingError('');
      setPendingAction(() => action);
      return;
    }
    action();
  }

  async function confirmPendingTransition() {
    setSavingPending(true);
    setPendingError('');
    try {
      for (const handle of dirtyHandles()) {
        const ok = await handle.save();
        if (!ok) {
          setPendingError('Could not save the narrator change. Fix the error above and try again.');
          return;
        }
      }
      if (descriptionDirty()) {
        const ok = await saveDescription();
        if (!ok) {
          setPendingError('Could not save the description. Fix the error above and try again.');
          return;
        }
      }
      const action = pendingAction;
      setPendingAction(undefined);
      action?.();
    } finally {
      setSavingPending(false);
    }
  }

  function discardPendingTransition() {
    for (const handle of narratorHandles.current.values()) handle.discard();
    if (descriptionDirty()) {
      setEditingDescription(false);
      setDescriptionError('');
    }
    const action = pendingAction;
    setPendingAction(undefined);
    action?.();
  }

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    function handler(event: BeforeUnloadEvent) {
      if (hasUnsavedWork()) {
        event.preventDefault();
        event.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingDescription, descriptionDraft, detail]);

  async function saveDescription(): Promise<boolean> {
    if (!detail || !selected) return false;
    setSavingDescription(true);
    setDescriptionError('');
    try {
      await api.updateWork(selected, {
        title: detail.title,
        author: detail.author ?? '',
        series: detail.series,
        series_position: detail.series_position,
        description: descriptionDraft,
        isbn: detail.isbn,
        first_publish_year: detail.first_publish_year,
        publisher: detail.publisher,
        language: detail.language,
        subjects: detail.subject_values,
      });
      setDetail({ ...detail, description: descriptionDraft });
      setEditingDescription(false);
      setNotice('Description saved.');
      return true;
    } catch (cause) {
      setDescriptionError(errorMessage(cause));
      return false;
    } finally {
      setSavingDescription(false);
    }
  }

  const current = books.find((book) => book.id === selected);
  const fileRecording =
    review?.kind === 'file'
      ? recordings.find(
          (recording) =>
            recording.id === media.find((file) => file.id === review.mediaID)?.representation_id,
        )
      : undefined;
  const paneHeight = Math.max(320, height - 300);

  return (
    <Page
      title="Metadata"
      scrollable={false}
      back={
        <IconButton
          label="Back to library"
          icon="back"
          kind="quiet"
          onPress={() => requestTransition(() => router.push(`/library/${id}`))}
        />
      }
    >
      <View className={`min-h-0 flex-1 gap-5 ${compact ? 'px-4 py-5' : 'px-8 py-8'}`}>
        {error ? (
          <ErrorState action={<Button label="Try again" onPress={() => void load()} />}>
            {error}
          </ErrorState>
        ) : null}
        {library && !canEdit ? (
          <Notice>Only library owners, editors, and administrators can review metadata.</Notice>
        ) : null}
        {!library || canEdit ? (
          <View className="gap-6 lg:flex-row">
            {!(compact && selected) ? (
              <View className="gap-4 lg:w-80 lg:flex-none">
                <View className="gap-1">
                  <Text className="text-base font-sans-semibold text-ink">
                    {library?.name ?? 'Library'}
                  </Text>
                  <Text className="text-sm text-muted">
                    Review missing details, compare suggestions, and keep the changes you choose.
                  </Text>
                </View>
                <SearchField
                  label="Search books, authors, or narrators"
                  value={query}
                  onChangeText={changeQuery}
                />
                <Select
                  menu
                  label="Show"
                  options={filters}
                  value={filter}
                  onChange={(value) => requestTransition(() => changeFilter(value))}
                />
                <Button
                  label="Fill missing details"
                  disabled={loading || !books.length || !canEdit}
                  onPress={() => requestTransition(() => setBulkWorks([...books]))}
                />
                <Text className="text-sm text-muted">
                  {books.length ? `${offset + 1}–${offset + books.length}` : '0'} books shown
                  {hasMore ? ' · more available' : ''}
                </Text>
                <ScrollView style={{ maxHeight: paneHeight }} nestedScrollEnabled>
                  <View className="gap-1">
                    {books.map((book) => (
                      <Pressable
                        key={book.id}
                        accessibilityRole="button"
                        accessibilityLabel={`Review ${book.title}`}
                        accessibilityState={{ selected: selected === book.id }}
                        onPress={() => {
                          if (book.id !== selected) requestTransition(() => select(book.id));
                        }}
                        className={`min-h-11 flex-row gap-3 rounded-card p-2.5 focus-visible:ring-2 focus-visible:ring-accent ${selected === book.id ? 'bg-accent-soft' : 'hover:bg-paper'}`}
                      >
                        <BookCover
                          title={book.title}
                          author={book.author}
                          coverURL={book.cover_url}
                          size="mini"
                        />
                        <View className="min-w-0 flex-1 gap-1">
                          <Text numberOfLines={1} className="font-editorial text-base text-ink">
                            {book.title}
                          </Text>
                          <Text numberOfLines={1} className="text-sm text-muted">
                            {book.author || 'Author missing'}
                          </Text>
                          <View className="mt-0.5 flex-row flex-wrap gap-1.5">
                            {book.narrators?.length ? (
                              <StatusBadge
                                tone="success"
                                label={`Narrated by ${book.narrators.join(', ')}`}
                              />
                            ) : null}
                            {book.missing_metadata?.length ? (
                              <StatusBadge
                                tone="danger"
                                label={`Missing ${book.missing_metadata
                                  .map((field) => (field === 'cover' ? 'saved cover' : field))
                                  .join(', ')}`}
                              />
                            ) : null}
                          </View>
                        </View>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
                {loading ? <LoadingState label="Loading books…" /> : null}
                {!loading && !error && !books.length ? (
                  <EmptyState title={filter ? 'No books need attention here' : 'No matching books'}>
                    Try another filter or search. Only missing details are flagged; short
                    descriptions are kept.
                  </EmptyState>
                ) : null}
                <View className="flex-row gap-2">
                  {offset > 0 ? (
                    <Button
                      label="Previous page"
                      disabled={loading}
                      onPress={() => {
                        select();
                        void load(Math.max(0, offset - 30));
                      }}
                    />
                  ) : null}
                  {hasMore ? (
                    <Button
                      label="Next page"
                      disabled={loading}
                      onPress={() => {
                        select();
                        void load(offset + books.length);
                      }}
                    />
                  ) : null}
                </View>
              </View>
            ) : null}

            {!compact || selected ? (
              <View className="relative min-w-0 flex-1 lg:border-l lg:border-line lg:pl-6">
                {!selected ? (
                  <EmptyState title="Choose a book to review">
                    Compare its saved details with file tags or online suggestions. Nothing changes
                    until you apply it.
                  </EmptyState>
                ) : (
                  <View className="gap-0">
                    <View className="gap-3 border-b border-line pb-4">
                      <View className="flex-row items-center justify-between gap-2">
                        <Button
                          label="Back to list"
                          kind="quiet"
                          onPress={() => requestTransition(() => select())}
                        />
                        <Button
                          label="Save & next"
                          kind="primary"
                          disabled={loading}
                          onPress={() => requestTransition(() => void goToNextBook())}
                        />
                      </View>
                      <View className="flex-row items-center gap-3">
                        <BookCover
                          title={detail?.title ?? current?.title ?? ''}
                          author={detail?.author ?? current?.author}
                          coverURL={detail?.cover_url ?? current?.cover_url}
                          size="mini"
                        />
                        <View className="min-w-0 flex-1 gap-1">
                          <Text numberOfLines={1} className="font-editorial text-lg text-ink">
                            {detail?.title ?? current?.title}
                          </Text>
                          <View className="flex-row flex-wrap items-center gap-2">
                            <Text className="text-sm text-muted">
                              {detail?.author || current?.author || 'Author missing'}
                            </Text>
                            {current?.missing_metadata?.length ? (
                              <StatusBadge
                                tone="danger"
                                label={`Missing ${current.missing_metadata
                                  .map((field) => (field === 'cover' ? 'saved cover' : field))
                                  .join(', ')}`}
                              />
                            ) : null}
                          </View>
                        </View>
                      </View>
                    </View>

                    <ScrollView style={{ maxHeight: paneHeight }} nestedScrollEnabled>
                      <View className="gap-3 py-4">
                        {detailError ? (
                          <ErrorState
                            action={
                              <Button
                                label="Retry book details"
                                onPress={() => {
                                  setDetailError('');
                                  setRetry((value) => value + 1);
                                }}
                              />
                            }
                          >
                            {detailError}
                          </ErrorState>
                        ) : !detail ? (
                          <LoadingState label="Loading book details…" />
                        ) : (
                          <>
                            <View className="rounded-card border border-line bg-paper">
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`${bookDetailsOpen ? 'Collapse' : 'Expand'} book details`}
                                accessibilityState={{ expanded: bookDetailsOpen }}
                                onPress={() => setBookDetailsOpen((value) => !value)}
                                className="min-h-11 flex-row items-center gap-3 p-3.5"
                              >
                                <View className="h-7 w-7 items-center justify-center rounded-control bg-neutral-soft">
                                  <AppIcon name="edit" size={15} color={colors.muted} />
                                </View>
                                <View className="min-w-0 flex-1 gap-0.5">
                                  <Text className="text-sm font-sans-bold text-ink">
                                    Book details
                                  </Text>
                                  <Text className="text-xs text-muted">
                                    Shared by every edition of this book
                                  </Text>
                                </View>
                                <RotatingChevron open={bookDetailsOpen} />
                              </Pressable>
                              {bookDetailsOpen ? (
                                <View className="gap-3 border-t border-line-subtle p-3.5 pt-3">
                                  {editingDescription ? (
                                    <View className="gap-3">
                                      <Field
                                        label="Description"
                                        value={descriptionDraft}
                                        onChangeText={setDescriptionDraft}
                                        multiline
                                        editable={!savingDescription}
                                      />
                                      {descriptionError ? (
                                        <Notice danger>{descriptionError}</Notice>
                                      ) : null}
                                      <View className="flex-row gap-2">
                                        <Button
                                          label="Save description"
                                          kind="primary"
                                          loading={savingDescription}
                                          onPress={() => void saveDescription()}
                                        />
                                        <Button
                                          label="Cancel"
                                          kind="secondary"
                                          disabled={savingDescription}
                                          onPress={() => {
                                            setEditingDescription(false);
                                            setDescriptionError('');
                                          }}
                                        />
                                      </View>
                                    </View>
                                  ) : (
                                    <>
                                      <Text className="text-sm leading-6 text-ink">
                                        {detail.description || 'No description yet.'}
                                      </Text>
                                      <View className="flex-row flex-wrap gap-2">
                                        <Button
                                          label="Edit manually"
                                          kind="secondary"
                                          icon="edit"
                                          onPress={() => {
                                            setDescriptionDraft(detail.description ?? '');
                                            setEditingDescription(true);
                                          }}
                                        />
                                        <Button
                                          label="Find book details online"
                                          kind="secondary"
                                          icon="search"
                                          onPress={() => setReview({ kind: 'book' })}
                                        />
                                      </View>
                                    </>
                                  )}
                                  <View className="mt-1 flex-row items-center gap-2">
                                    <Text className="text-xs font-sans-bold uppercase tracking-wide text-subtle">
                                      Author
                                    </Text>
                                    <Text className="text-sm text-ink">
                                      {detail.author || 'Missing'}
                                    </Text>
                                  </View>
                                </View>
                              ) : null}
                            </View>

                            <Text className="mt-2 text-xs font-sans-bold uppercase tracking-wide text-subtle">
                              Audiobook recordings
                            </Text>
                            {!recordings.length ? (
                              <Text className="text-sm text-muted">
                                This book has no editions yet.
                              </Text>
                            ) : null}
                            {recordings.map((recording) => {
                              const files = media.filter(
                                (file) => file.representation_id === recording.id,
                              );
                              const audio =
                                recording.kind !== 'epub'
                                  ? files.find(
                                      (file) => file.kind === 'audio' || file.kind === 'audiobook',
                                    )
                                  : undefined;
                              const expanded = expandedRecording === recording.id;
                              const hasNarrator = Boolean(recording.narrators?.length);
                              const collapse = () =>
                                requestTransition(() =>
                                  setExpandedRecording(expanded ? undefined : recording.id),
                                );
                              return (
                                <View
                                  key={recording.id}
                                  className="rounded-card border border-line bg-paper"
                                >
                                  <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} ${recording.label || 'recording'}`}
                                    accessibilityState={{ expanded }}
                                    onPress={collapse}
                                    className="min-h-11 flex-row items-center gap-3 p-3.5"
                                  >
                                    <View className="h-7 w-7 items-center justify-center rounded-control bg-neutral-soft">
                                      <AppIcon
                                        name={audio ? 'listen' : 'read'}
                                        size={15}
                                        color={colors.muted}
                                      />
                                    </View>
                                    <View className="min-w-0 flex-1 gap-0.5">
                                      <Text
                                        numberOfLines={1}
                                        className="text-sm font-sans-bold text-ink"
                                      >
                                        {recording.label ||
                                          (audio ? 'Audiobook recording' : 'Ebook')}
                                      </Text>
                                      {audio ? (
                                        <Text className="text-xs text-muted">
                                          {files.length > 1
                                            ? `${files.length} files`
                                            : files[0]?.original_filename || 'Audio file'}
                                          {' · Narrator applies to this recording only'}
                                        </Text>
                                      ) : null}
                                    </View>
                                    {audio ? (
                                      <StatusBadge
                                        tone={hasNarrator ? 'success' : 'danger'}
                                        label={
                                          hasNarrator
                                            ? `Saved: ${recording.narrators!.join(', ')}`
                                            : 'Needs a narrator'
                                        }
                                      />
                                    ) : null}
                                    <RotatingChevron open={expanded} />
                                  </Pressable>
                                  {expanded ? (
                                    <View className="gap-3 border-t border-line-subtle p-3.5 pt-3.5">
                                      {audio ? (
                                        <NarratorEditor
                                          key={audio.id}
                                          ref={(handle) => {
                                            if (handle)
                                              narratorHandles.current.set(recording.id, handle);
                                            else narratorHandles.current.delete(recording.id);
                                          }}
                                          recording={recording}
                                          mediaID={audio.id}
                                          onSaved={refreshSelected}
                                          onSkip={collapse}
                                        />
                                      ) : null}
                                      {files.map((file) => (
                                        <Button
                                          key={file.id}
                                          label={`Review file: ${file.original_filename || recording.label}`}
                                          kind="secondary"
                                          onPress={() =>
                                            setReview({ kind: 'file', mediaID: file.id })
                                          }
                                        />
                                      ))}
                                    </View>
                                  ) : null}
                                </View>
                              );
                            })}

                            <Button
                              label="Edit all book details"
                              kind="quiet"
                              onPress={() =>
                                requestTransition(() => router.push(`/work/${selected}/manage`))
                              }
                            />
                          </>
                        )}
                      </View>
                    </ScrollView>
                  </View>
                )}

                {pendingAction ? (
                  <AnimatedView
                    entering={sheetEnter}
                    className="absolute inset-x-0 bottom-0 flex-row flex-wrap items-center gap-3 rounded-card bg-ink p-3.5 shadow-popover"
                  >
                    <Text className="min-w-0 flex-1 text-sm text-canvas">
                      {pendingError ||
                        'You have an unsaved narrator or description entry. Save it before moving on?'}
                    </Text>
                    <View className="flex-row flex-wrap gap-2">
                      <Button
                        label="Keep editing"
                        kind="secondary"
                        disabled={savingPending}
                        onPress={() => {
                          setPendingAction(undefined);
                          setPendingError('');
                        }}
                      />
                      <Button
                        label="Discard"
                        kind="secondary"
                        disabled={savingPending}
                        onPress={discardPendingTransition}
                      />
                      <Button
                        label="Save & continue"
                        kind="primary"
                        loading={savingPending}
                        onPress={() => void confirmPendingTransition()}
                      />
                    </View>
                  </AnimatedView>
                ) : null}

                {notice ? (
                  <View className="absolute bottom-4 left-0 flex-row items-center gap-2 rounded-full bg-success px-4 py-2">
                    <AppIcon name="check" size={14} color={colors.onAccent} />
                    <Text className="text-xs font-sans-bold text-canvas">{notice}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
      {bulkWorks ? (
        <BulkMetadataFill
          works={bulkWorks}
          onClose={() => setBulkWorks(undefined)}
          onFinished={async () => {
            select();
            await load(offset);
          }}
        />
      ) : null}
      {selected && detail && review?.kind === 'book' ? (
        <MetadataReviewDialog
          key={selected}
          workID={selected}
          initialQuery={`${detail.title} ${detail.author ?? ''}`}
          applyLabel="Save and next"
          onClose={() => setReview(undefined)}
          onApplied={saved}
        />
      ) : null}
      {selected && review?.kind === 'file' ? (
        <FileMetadataReview
          key={review.mediaID}
          mediaID={review.mediaID}
          onAudiobookLookup={
            fileRecording && fileRecording.kind !== 'epub'
              ? (asin) => setReview({ kind: 'audio', recording: fileRecording, asin })
              : undefined
          }
          applyLabel="Save and next"
          onClose={() => setReview(undefined)}
          onApplied={saved}
        />
      ) : null}
      {selected && review?.kind === 'audio' ? (
        <AudiobookMetadataReview
          key={review.recording.id}
          workID={selected}
          representationID={review.recording.id}
          recordingLabel={review.recording.label}
          initialASIN={review.asin}
          applyLabel="Save and next"
          onClose={() => setReview(undefined)}
          onApplied={saved}
        />
      ) : null}
    </Page>
  );
}
