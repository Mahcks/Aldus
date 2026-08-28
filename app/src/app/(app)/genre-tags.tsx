import type { GenreTag, UnmatchedGenreSubject } from '../../generated/api';
import { useEffect, useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { useAuth } from '../../features/auth/AuthProvider';
import { AppIcon, genreIconOptions, isAppIconName, type AppIconName } from '../../features/icons';
import { Pressable, Text, View } from '../../features/tw';
import {
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  GenreTagChip,
  IconButton,
  LoadingState,
  Notice,
  Page,
  Row,
  SearchField,
  colors,
} from '../../features/ui';
import { api, errorMessage } from '../../lib/api';

type TagForm = { label: string; icon: AppIconName; keywords: string[] };

const emptyForm: TagForm = { label: '', icon: 'genres', keywords: [] };

export default function GenreTagsScreen() {
  const auth = useAuth();
  const narrow = useWindowDimensions().width < 600;
  const [tags, setTags] = useState<GenreTag[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedGenreSubject[]>([]);
  const [unmatchedHasMore, setUnmatchedHasMore] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<GenreTag>();
  const [mapping, setMapping] = useState<UnmatchedGenreSubject>();
  const [mappingTagID, setMappingTagID] = useState('');
  const [mappingQuery, setMappingQuery] = useState('');
  const [form, setForm] = useState<TagForm>(emptyForm);
  const [keyword, setKeyword] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [coverageLoading, setCoverageLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tagLoadError, setTagLoadError] = useState('');
  const [coverageError, setCoverageError] = useState('');
  const [loadMoreError, setLoadMoreError] = useState('');
  const [success, setSuccess] = useState('');
  const [coverageSuccess, setCoverageSuccess] = useState('');

  async function loadTags() {
    setTagLoadError('');
    try {
      setTags(await api.genreTags());
    } catch (value) {
      setTagLoadError(errorMessage(value));
    } finally {
      setLoading(false);
    }
  }

  async function loadSubjects() {
    setCoverageError('');
    try {
      const subjects = await api.unmatchedGenreSubjects();
      setUnmatched(subjects.items);
      setUnmatchedHasMore(subjects.has_more);
    } catch (value) {
      setCoverageError(errorMessage(value));
    } finally {
      setCoverageLoading(false);
    }
  }

  async function loadData() {
    await Promise.all([loadTags(), loadSubjects()]);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (auth.user?.admin) void loadData();
    // Data loading is the external synchronization this effect owns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.admin]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleTags = tags.filter((tag) =>
    `${tag.label} ${(tag.keywords ?? []).join(' ')}`.toLocaleLowerCase().includes(normalizedQuery),
  );
  const normalizedMappingQuery = mappingQuery.trim().toLocaleLowerCase();
  const visibleMappingTags = tags.filter((tag) =>
    tag.label.toLocaleLowerCase().includes(normalizedMappingQuery),
  );
  const canSubmit = form.label.trim().length > 0 && form.keywords.length > 0;

  function openCreate() {
    setError('');
    setSuccess('');
    setCoverageSuccess('');
    setForm(emptyForm);
    setKeyword('');
    setCreateOpen(true);
  }

  function openEdit(tag: GenreTag) {
    setError('');
    setSuccess('');
    setCoverageSuccess('');
    setSelected(tag);
    setKeyword('');
    setForm({
      label: tag.label,
      icon: isAppIconName(tag.icon) ? tag.icon : 'genres',
      keywords: tag.keywords ?? [],
    });
  }

  function openMapping(subject: UnmatchedGenreSubject) {
    setError('');
    setSuccess('');
    setCoverageSuccess('');
    setMapping(subject);
    setMappingTagID('');
    setMappingQuery('');
  }

  function closeMapping() {
    setMapping(undefined);
    setMappingTagID('');
    setMappingQuery('');
    setError('');
  }

  function changeMappingQuery(value: string) {
    setMappingQuery(value);
    setMappingTagID('');
  }

  function createFromMapping() {
    const subject = mapping?.subject;
    closeMapping();
    setForm({ ...emptyForm, keywords: subject ? [subject] : [] });
    setKeyword('');
    setCreateOpen(true);
  }

  function closeForm() {
    setCreateOpen(false);
    setSelected(undefined);
    setKeyword('');
    setForm(emptyForm);
    setError('');
  }

  function addKeyword() {
    const value = keyword.trim();
    if (!value) return;
    if (!form.keywords.some((item) => item.toLocaleLowerCase() === value.toLocaleLowerCase())) {
      setForm((current) => ({ ...current, keywords: [...current.keywords, value] }));
    }
    setKeyword('');
  }

  function removeKeyword(value: string) {
    setForm((current) => ({
      ...current,
      keywords: current.keywords.filter((item) => item !== value),
    }));
  }

  async function saveTag() {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError('');
    try {
      if (selected) {
        await api.updateGenreTag(selected.id, form);
        setSuccess('Genre tag updated.');
      } else {
        await api.createGenreTag(form);
        setSuccess('Genre tag created.');
      }
      closeForm();
      await loadData();
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setBusy(false);
    }
  }

  async function deleteTag() {
    if (!selected || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.deleteGenreTag(selected.id);
      setConfirmingDelete(false);
      closeForm();
      setSuccess('Genre tag deleted.');
      await loadData();
    } catch (value) {
      setError(errorMessage(value));
      setConfirmingDelete(false);
    } finally {
      setBusy(false);
    }
  }

  async function loadMoreSubjects() {
    if (loadingMore || !unmatchedHasMore) return;
    setLoadingMore(true);
    setLoadMoreError('');
    try {
      const page = await api.unmatchedGenreSubjects(unmatched.length);
      setUnmatched((current) => [...current, ...page.items]);
      setUnmatchedHasMore(page.has_more);
    } catch (value) {
      setLoadMoreError(errorMessage(value));
    } finally {
      setLoadingMore(false);
    }
  }

  async function mapSubject() {
    const subject = mapping;
    const tag = tags.find((item) => item.id === mappingTagID);
    if (!subject || !tag || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.updateGenreTag(tag.id, {
        label: tag.label,
        icon: tag.icon,
        keywords: [...(tag.keywords ?? []), subject.subject],
      });
      closeMapping();
      setCoverageSuccess(`Books matching “${subject.subject}” now use ${tag.label}.`);
      await loadData();
      if (Platform.OS === 'web') {
        setTimeout(() => document.getElementById('genre-coverage-heading')?.focus(), 0);
      }
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setBusy(false);
    }
  }

  if (!auth.user?.admin)
    return (
      <Page title="Genres" editorial={false}>
        <Notice tone="info">This page is available to global administrators.</Notice>
      </Page>
    );

  const formDialog = (
    <TagEditor
      form={form}
      keyword={keyword}
      busy={busy}
      error={error}
      canSubmit={canSubmit}
      submitLabel={selected ? 'Save changes' : 'Create genre'}
      onChange={setForm}
      onKeywordChange={setKeyword}
      onAddKeyword={addKeyword}
      onRemoveKeyword={removeKeyword}
      onCancel={closeForm}
      onSubmit={() => void saveTag()}
      onDelete={selected ? () => setConfirmingDelete(true) : undefined}
    />
  );

  return (
    <Page
      title="Genres"
      actions={<Button label="Add genre" icon="add" kind="primary" onPress={openCreate} />}
      editorial={false}
    >
      {error && !createOpen && !selected && !mapping ? <Notice danger>{error}</Notice> : null}
      {success ? <Notice tone="success">{success}</Notice> : null}
      <View className="max-w-[900px] gap-8">
        <View className="gap-4">
          <Text className="text-sm leading-5 text-muted">
            Genres are assigned from imported subjects. Matching phrase changes update every book
            they cover.
          </Text>
          <SearchField
            label="Search genres"
            placeholder="Label or matching phrase"
            value={query}
            onChangeText={setQuery}
          />
          <Text className="text-sm text-muted">
            {visibleTags.length} {visibleTags.length === 1 ? 'genre' : 'genres'}
          </Text>
          {loading ? (
            <LoadingState label="Loading genres…" />
          ) : tagLoadError ? (
            <Notice danger>{tagLoadError}</Notice>
          ) : visibleTags.length ? (
            <View className="border-t border-line">
              {visibleTags.map((tag) => (
                <View
                  key={tag.id}
                  className="min-h-16 flex-row items-center gap-3 border-b border-line py-3"
                >
                  <View className="h-10 w-10 items-center justify-center rounded-control bg-panel">
                    <AppIcon
                      name={isAppIconName(tag.icon) ? tag.icon : 'genres'}
                      size={20}
                      color={colors.accent}
                    />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text numberOfLines={1} className="font-sans-bold text-ink">
                      {tag.label}
                    </Text>
                    <Text numberOfLines={2} className="text-sm text-muted">
                      {(tag.keywords ?? []).join(', ')}
                    </Text>
                  </View>
                  <Button
                    label="Edit"
                    accessibilityLabel={`Edit ${tag.label} genre`}
                    kind="quiet"
                    onPress={() => openEdit(tag)}
                  />
                </View>
              ))}
            </View>
          ) : (
            <EmptyState icon="genres" title={query ? 'No matching genres' : 'No genres'}>
              {query
                ? 'Try another label or matching phrase.'
                : 'Add a genre to begin organizing imported subjects.'}
            </EmptyState>
          )}
        </View>

        <View className="gap-3">
          <View
            nativeID="genre-coverage-heading"
            tabIndex={-1}
            accessibilityRole="header"
            accessible
            className="gap-1"
          >
            <Text className="text-lg font-sans-bold text-ink">Unmatched imported subjects</Text>
            <Text className="text-sm text-muted">
              Map recurring source metadata once. Every matching book updates automatically.
            </Text>
          </View>
          {coverageSuccess ? <Notice tone="success">{coverageSuccess}</Notice> : null}
          {coverageLoading ? (
            <LoadingState label="Loading imported subjects…" />
          ) : coverageError ? (
            <Notice danger>{coverageError}</Notice>
          ) : unmatched.length ? (
            <View className="border-t border-line">
              {unmatched.map((subject) => (
                <View
                  key={subject.subject.toLocaleLowerCase()}
                  className="min-h-16 flex-row items-center gap-3 border-b border-line py-3"
                >
                  <View className="min-w-0 flex-1 gap-0.5">
                    <Text className="font-sans-semibold text-ink">{subject.subject}</Text>
                    <Text className="text-sm text-muted">
                      {subject.work_count} {subject.work_count === 1 ? 'book' : 'books'}
                    </Text>
                  </View>
                  {tags.length ? (
                    <Button
                      label="Map to genre"
                      accessibilityLabel={`Map ${subject.subject} to a genre`}
                      kind="secondary"
                      onPress={() => openMapping(subject)}
                    />
                  ) : (
                    <Text className="text-sm text-muted">Add a genre first</Text>
                  )}
                </View>
              ))}
              {unmatchedHasMore ? (
                <View className="items-start gap-2 pt-3">
                  {loadMoreError ? <Notice danger>{loadMoreError}</Notice> : null}
                  <Button
                    label="Load more"
                    kind="quiet"
                    loading={loadingMore}
                    onPress={() => void loadMoreSubjects()}
                  />
                </View>
              ) : null}
            </View>
          ) : (
            <EmptyState icon="genres" title="All imported subjects are covered">
              New source subjects will appear here when they do not match a genre.
            </EmptyState>
          )}
        </View>
      </View>

      <Dialog
        visible={createOpen}
        title="Add genre"
        fullScreen={narrow}
        scrollHint="More genre settings below"
        onClose={closeForm}
      >
        {formDialog}
      </Dialog>
      <Dialog
        visible={Boolean(mapping)}
        title="Map imported subject"
        fullScreen={narrow}
        scrollHint="More genres below"
        onClose={closeMapping}
      >
        <View className="gap-5">
          {error ? <Notice danger>{error}</Notice> : null}
          <View className="gap-1">
            <Text className="font-sans-bold text-ink">{mapping?.subject}</Text>
            <Text className="text-sm text-muted">
              Found on {mapping?.work_count ?? 0} {mapping?.work_count === 1 ? 'book' : 'books'}.
            </Text>
          </View>
          <SearchField
            label="Find a genre"
            placeholder="Fantasy"
            value={mappingQuery}
            onChangeText={changeMappingQuery}
          />
          <View accessibilityRole="radiogroup" accessibilityLabel="Genre" className="gap-1">
            {visibleMappingTags.map((tag) => (
              <Button
                key={tag.id}
                label={tag.label}
                kind="quiet"
                selected={mappingTagID === tag.id}
                accessibilityRole="radio"
                onPress={() => setMappingTagID(tag.id)}
              />
            ))}
            {!visibleMappingTags.length ? (
              <Text className="py-2 text-sm text-muted">No matching genres.</Text>
            ) : null}
          </View>
          {mappingTagID ? (
            <Notice tone="info">
              This adds “{mapping?.subject}” as a matching phrase to{' '}
              {tags.find((tag) => tag.id === mappingTagID)?.label}.
            </Notice>
          ) : null}
          <Row>
            <Button label="Cancel" kind="secondary" disabled={busy} onPress={closeMapping} />
            <Button
              label="Map subject"
              kind="primary"
              loading={busy}
              disabled={!mappingTagID}
              onPress={() => void mapSubject()}
            />
          </Row>
          <View className="self-start">
            <Button
              label="Create a new genre"
              kind="quiet"
              disabled={busy}
              onPress={createFromMapping}
            />
          </View>
        </View>
      </Dialog>
      <Dialog
        visible={Boolean(selected) && !confirmingDelete}
        title="Edit genre"
        fullScreen={narrow}
        scrollHint="More genre settings below"
        onClose={closeForm}
      >
        {formDialog}
      </Dialog>
      <ConfirmDialog
        visible={confirmingDelete}
        title="Delete genre?"
        description={`${selected?.label ?? 'This genre'} will disappear from book details. Imported subject data will remain unchanged.`}
        confirmLabel="Delete genre"
        danger
        busy={busy}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={() => void deleteTag()}
      />
    </Page>
  );
}

function TagEditor({
  form,
  keyword,
  busy,
  error,
  canSubmit,
  submitLabel,
  onChange,
  onKeywordChange,
  onAddKeyword,
  onRemoveKeyword,
  onCancel,
  onSubmit,
  onDelete,
}: {
  form: TagForm;
  keyword: string;
  busy: boolean;
  error: string;
  canSubmit: boolean;
  submitLabel: string;
  onChange: (form: TagForm) => void;
  onKeywordChange: (value: string) => void;
  onAddKeyword: () => void;
  onRemoveKeyword: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  onDelete?: () => void;
}) {
  return (
    <View className="gap-5">
      {error ? <Notice danger>{error}</Notice> : null}
      <Field
        label="Label"
        autoFocus
        value={form.label}
        placeholder="Fantasy"
        onChangeText={(label) => onChange({ ...form, label })}
      />
      <View className="gap-2">
        <Text className="text-sm font-sans-semibold text-ink">Preview</Text>
        <View className="self-start">
          <GenreTagChip icon={form.icon} label={form.label.trim() || 'Genre'} />
        </View>
      </View>
      <GenreIconPicker
        options={genreIconOptions}
        value={form.icon}
        onChange={(icon) => onChange({ ...form, icon })}
      />
      <View className="gap-3 border-t border-line pt-4">
        <Field
          label="Matching keyword"
          value={keyword}
          placeholder="fantasy fiction"
          returnKeyType="done"
          onChangeText={onKeywordChange}
          onSubmitEditing={onAddKeyword}
          help="Matches whole-word phrases. Capitalization and punctuation are ignored."
        />
        <View className="self-start">
          <Button
            label="Add keyword"
            icon="add"
            kind="secondary"
            disabled={!keyword.trim()}
            onPress={onAddKeyword}
          />
        </View>
        {form.keywords.length ? (
          <View className="border-t border-line">
            {form.keywords.map((item) => (
              <View
                key={item.toLocaleLowerCase()}
                className="min-h-12 flex-row items-center gap-3 border-b border-line py-1"
              >
                <Text className="min-w-0 flex-1 text-base text-ink">{item}</Text>
                <IconButton
                  icon="close"
                  label={`Remove ${item}`}
                  kind="quiet"
                  onPress={() => onRemoveKeyword(item)}
                />
              </View>
            ))}
          </View>
        ) : (
          <Text className="text-sm text-muted">
            Add at least one keyword so imported subjects can match this genre.
          </Text>
        )}
      </View>
      {!canSubmit ? (
        <Text className="text-sm text-muted">
          Enter a label and add at least one matching keyword to save.
        </Text>
      ) : null}
      <Row>
        <Button label="Cancel" kind="secondary" disabled={busy} onPress={onCancel} />
        <Button
          label={submitLabel}
          kind="primary"
          loading={busy}
          disabled={!canSubmit}
          onPress={onSubmit}
        />
      </Row>
      {onDelete ? (
        <View className="self-start pt-1">
          <Button label="Delete" kind="danger" disabled={busy} onPress={onDelete} />
        </View>
      ) : null}
    </View>
  );
}

function GenreIconPicker({
  options,
  value,
  onChange,
}: {
  options: { value: AppIconName; label: string }[];
  value: AppIconName;
  onChange: (value: AppIconName) => void;
}) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleOptions = options.filter((option) =>
    option.label.toLocaleLowerCase().includes(normalizedQuery),
  );

  return (
    <View className="gap-3">
      <SearchField label="Icon" placeholder="Search icons" value={query} onChangeText={setQuery} />
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Icon"
        className="flex-row flex-wrap gap-2"
      >
        {visibleOptions.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ checked: selected }}
              onPress={() => onChange(option.value)}
              className={`will-change-variable min-h-12 flex-grow basis-[120px] flex-row items-center gap-2 rounded-control border px-3 py-2 ${selected ? 'border-accent bg-accent-soft' : 'border-line bg-control'}`}
            >
              <AppIcon
                name={option.value}
                size={20}
                color={selected ? colors.accent : colors.muted}
              />
              <Text
                numberOfLines={2}
                className={`min-w-0 flex-1 text-sm font-sans-medium ${selected ? 'text-accent' : 'text-ink'}`}
              >
                {option.label}
              </Text>
              {selected ? <AppIcon name="check" size={16} color={colors.accent} /> : null}
            </Pressable>
          );
        })}
      </View>
      {!visibleOptions.length ? (
        <Text className="text-sm text-muted">No matching icons.</Text>
      ) : null}
    </View>
  );
}
