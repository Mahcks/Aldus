import { useEffect, useRef, useState } from 'react';
import type { MetadataCandidate, MetadataPreview, MetadataValues } from '@/generated/api';
import { APIError, api, errorMessage } from '@/lib/api';
import { BookCover } from './bookshelf';
import {
  metadataCorrection,
  metadataFields,
  metadataValueText,
  type MetadataField,
} from './metadata-review';
import { Text, View } from './tw';
import { Button, Checkbox, Dialog, EmptyState, Field, LoadingState, Notice, Row } from './ui';

export function MetadataReviewDialog({
  workID,
  initialQuery,
  onClose,
  onApplied,
}: {
  workID: string;
  initialQuery: string;
  onClose: () => void;
  onApplied: () => Promise<void>;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [preview, setPreview] = useState<MetadataPreview>();
  const [stage, setStage] = useState<'search' | 'editions' | 'review'>('search');
  const [candidate, setCandidate] = useState<MetadataCandidate>();
  const [selected, setSelected] = useState<MetadataField[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );

  async function search() {
    const request = ++generation.current;
    setLoading(true);
    setError('');
    setPreview(undefined);
    setStage('search');
    try {
      const next = await api.metadataCandidates(workID, query);
      if (request === generation.current) setPreview(next);
    } catch (cause) {
      if (request === generation.current)
        setError(
          cause instanceof APIError && cause.status === 404
            ? 'Metadata review is unavailable on this server or you no longer have edit access. You can close this dialog and use the existing details tools.'
            : errorMessage(cause),
        );
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }

  async function editions(providerWorkID: string) {
    const request = ++generation.current;
    setLoading(true);
    setError('');
    setConflict(false);
    setSelected([]);
    try {
      const searchedISBN = query.replace(/[-\s]/g, '');
      const preferredISBN = /^(?:\d{9}[\dXx]|\d{13})$/.test(searchedISBN)
        ? searchedISBN
        : preview?.current.isbn;
      const next = await api.metadataEditions(
        workID,
        providerWorkID,
        preview?.current.language,
        preferredISBN,
      );
      if (request !== generation.current) return;
      setPreview(next);
      setStage('editions');
    } catch (cause) {
      if (request === generation.current) setError(errorMessage(cause));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }

  function choose(value: MetadataCandidate) {
    setCandidate(value);
    setSelected([]);
    setStage('review');
  }

  function toggleField(field: MetadataField) {
    setSelected((values) => {
      if (values.includes(field)) return values.filter((value) => value !== field);
      return [...values, field];
    });
  }

  function chooseCandidate(value: MetadataCandidate) {
    if (stage === 'search') {
      void editions(value.work_id);
    } else {
      choose(value);
    }
  }

  function goBack() {
    setError('');
    setConflict(false);
    setStage(stage === 'review' ? 'editions' : 'search');
  }

  function close() {
    if (!saving) onClose();
  }

  async function apply() {
    if (!preview || !candidate || saving || conflict) return;
    const correction = metadataCorrection(preview.current, candidate, selected);
    if (!correction.fields.length) return;
    setSaving(true);
    setError('');
    try {
      await api.applyMetadata(workID, correction);
      await onApplied();
      onClose();
    } catch (cause) {
      setConflict(cause instanceof APIError && cause.status === 409);
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  const changes =
    preview && candidate ? metadataCorrection(preview.current, candidate, selected).fields : [];

  let content = null;
  if (loading) {
    content = <LoadingState label="Loading Open Library records…" />;
  } else if (stage !== 'review' && preview) {
    content = (
      <View className="gap-3">
        {stage === 'editions' ? (
          <Text className="text-sm text-muted">
            Choose the language and publisher that match your book. You can compare the details
            before saving.
          </Text>
        ) : null}
        {!preview.candidates.length ? (
          <EmptyState icon="search" title="No matching records">
            Try a different title, author, or ISBN.
          </EmptyState>
        ) : null}
        <MetadataCandidateList
          candidates={preview.candidates}
          searching={stage === 'search'}
          onChoose={chooseCandidate}
        />
      </View>
    );
  } else if (preview && candidate) {
    content = (
      <View className="gap-5">
        {metadataFields.map(([field, label]) => (
          <MetadataComparisonRow
            key={field}
            field={field}
            label={label}
            currentValues={preview.current}
            suggestedValues={candidate.values}
            checked={selected.includes(field)}
            disabled={saving || conflict}
            onToggle={() => toggleField(field)}
          />
        ))}
        {conflict ? (
          <Button label="Reload preview" onPress={() => void editions(candidate.work_id)} />
        ) : null}
      </View>
    );
  }

  return (
    <Dialog
      title="Review book details"
      visible
      wide
      sheet
      onClose={close}
      footer={
        stage === 'review' ? (
          <View className="gap-2">
            {!changes.length ? (
              <Text className="text-sm text-muted">
                Select at least one changed field to apply.
              </Text>
            ) : null}
            <Button
              label={`Apply ${changes.length} selected ${changes.length === 1 ? 'change' : 'changes'}`}
              kind="primary"
              loading={saving}
              disabled={!changes.length || conflict}
              onPress={() => void apply()}
            />
          </View>
        ) : undefined
      }
    >
      <View className="gap-5">
        <View className="gap-1">
          <Text className="font-semibold text-base text-ink">
            {stage === 'search'
              ? '1 of 3: Find your book'
              : stage === 'editions'
                ? '2 of 3: Choose an edition'
                : '3 of 3: Choose what to update'}
          </Text>
          <Text className="text-sm text-muted">
            {stage === 'review'
              ? 'Only checked details will change. Your book files stay the same.'
              : 'Search by ISBN for a specific edition, or use the title and author.'}
          </Text>
        </View>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {stage === 'search' ? (
          <View className="gap-3">
            <Field
              label="Title, author, or ISBN"
              value={query}
              onChangeText={setQuery}
              maxLength={200}
              onSubmitEditing={() => void search()}
            />
            <Button
              label="Find matches"
              onPress={() => void search()}
              loading={loading}
              disabled={!query.trim()}
            />
            {!query.trim() ? (
              <Text className="text-sm text-muted">Enter a title, author, or ISBN to search.</Text>
            ) : null}
          </View>
        ) : (
          <Button
            label={stage === 'review' ? 'Choose another edition' : 'Search again'}
            kind="quiet"
            disabled={saving || loading}
            onPress={goBack}
          />
        )}
        {content}
      </View>
    </Dialog>
  );
}

function MetadataComparisonRow({
  field,
  label,
  currentValues,
  suggestedValues,
  checked,
  disabled,
  onToggle,
}: {
  field: MetadataField;
  label: string;
  currentValues: MetadataValues;
  suggestedValues: MetadataValues;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const current = metadataValueText(currentValues[field]);
  const proposed = metadataValueText(suggestedValues[field]);
  const unchanged = current === proposed;
  const missingTitle = field === 'title' && !proposed;
  if (unchanged) {
    return (
      <View className="flex-row items-center justify-between gap-4 border-b border-line-subtle py-3">
        <Text className="text-sm font-sans-medium text-ink">{label}</Text>
        <Text className="text-sm text-muted">Already matches</Text>
      </View>
    );
  }

  return (
    <View className="gap-2 border-b border-line pb-4">
      <Checkbox
        label={`Replace ${label.toLowerCase()}`}
        checked={checked}
        disabled={disabled || unchanged || missingTitle}
        onPress={onToggle}
      />
      {unchanged || missingTitle ? (
        <Text className="text-sm text-muted">
          {missingTitle ? 'A title is required.' : 'Already matches.'}
        </Text>
      ) : null}
      {field === 'cover_url' ? (
        <Row>
          <View className="gap-2">
            <Text className="text-sm text-muted">Current</Text>
            <BookCover title={currentValues.title} coverURL={current} size="small" />
          </View>
          <View className="gap-2">
            <Text className="text-sm text-muted">Suggested</Text>
            <BookCover title={suggestedValues.title} coverURL={proposed} size="small" />
          </View>
        </Row>
      ) : (
        <View className="gap-4 min-[600px]:flex-row">
          <View className="min-w-0 flex-1 gap-1">
            <Text className="text-xs font-sans-semibold text-muted">Current</Text>
            <Text className="text-sm leading-6 text-muted">{current || 'Not set'}</Text>
          </View>
          <View className="min-w-0 flex-1 gap-1">
            <Text className="text-xs font-sans-semibold text-accent">Suggested</Text>
            <Text className="text-sm leading-6 text-ink">
              {proposed || 'Not provided. Selecting this clears the field'}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

function MetadataCandidateList({
  candidates,
  searching,
  onChoose,
}: {
  candidates: MetadataCandidate[];
  searching: boolean;
  onChoose: (candidate: MetadataCandidate) => void;
}) {
  return candidates.map((candidate) => {
    const { values } = candidate;
    const details = [values.author, values.language, values.publisher, values.isbn]
      .filter(Boolean)
      .join(' · ');
    let label = 'Review title details';
    if (searching) label = 'View editions';
    else if (candidate.edition_id) label = 'Review this edition';

    return (
      <View
        key={candidate.edition_id || candidate.work_id}
        className="gap-2 border-b border-line pb-4"
      >
        <Text className="font-editorial-bold text-lg text-ink">{values.title}</Text>
        <Text className="text-sm text-muted">{details || 'No edition details available'}</Text>
        <Button label={label} kind="secondary" onPress={() => onChoose(candidate)} />
      </View>
    );
  });
}
