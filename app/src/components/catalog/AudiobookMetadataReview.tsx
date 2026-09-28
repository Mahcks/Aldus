import { useEffect, useRef, useState } from 'react';
import type { AudiobookMetadataPreview } from '@/generated/api';
import { APIError, api, errorMessage } from '@/lib/api';
import { Button, Checkbox, Dialog, Field, LoadingState, Notice, Select } from '@/components/ui';
import { Text, View } from '@/components/ui/tw';

type FieldName = 'narrators' | 'description';

export function AudiobookMetadataReview({
  workID,
  representationID,
  recordingLabel,
  initialASIN = '',
  onClose,
  onApplied,
  applyLabel,
}: {
  workID: string;
  representationID: string;
  recordingLabel: string;
  initialASIN?: string;
  onClose: () => void;
  onApplied: () => Promise<void>;
  applyLabel?: string;
}) {
  const [asin, setASIN] = useState(initialASIN);
  const [region, setRegion] = useState('us');
  const [preview, setPreview] = useState<AudiobookMetadataPreview>();
  const [selected, setSelected] = useState<FieldName[]>([]);
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

  async function lookup() {
    const request = ++generation.current;
    setLoading(true);
    setError('');
    setPreview(undefined);
    setSelected([]);
    setConflict(false);
    try {
      const result = await api.audiobookMetadata(
        workID,
        representationID,
        asin.trim().toUpperCase(),
        region,
      );
      if (request === generation.current) setPreview(result);
    } catch (cause) {
      if (request === generation.current) setError(errorMessage(cause));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }

  async function apply() {
    if (!preview || !selected.length || saving || conflict) return;
    setSaving(true);
    setError('');
    try {
      await api.applyAudiobookMetadata(workID, representationID, {
        asin: preview.asin,
        region: preview.region,
        expected: preview.current,
        values: preview.values,
        fields: selected,
        recording: preview.recording,
      });
      await onApplied();
      onClose();
    } catch (cause) {
      const stale = cause instanceof APIError && cause.status === 409;
      setConflict(stale);
      setError(
        stale
          ? 'These details changed since you opened the review. Look up the recording again before applying changes.'
          : errorMessage(cause),
      );
    } finally {
      setSaving(false);
    }
  }

  function toggle(field: FieldName) {
    setSelected((fields) =>
      fields.includes(field) ? fields.filter((item) => item !== field) : [...fields, field],
    );
  }

  return (
    <Dialog
      title="Review audiobook details"
      visible
      wide
      sheet
      onClose={() => {
        if (!saving) onClose();
      }}
      footer={
        preview ? (
          <View className="gap-2">
            {!selected.length ? (
              <Text className="text-sm text-muted">Select a changed detail to apply.</Text>
            ) : null}
            <Button
              label={applyLabel ?? 'Apply selected changes'}
              onPress={() => void apply()}
              loading={saving}
              disabled={!selected.length || conflict}
            />
          </View>
        ) : undefined
      }
    >
      <View className="gap-4">
        <Text className="text-sm text-muted">
          Find the exact recording for {recordingLabel}. Check the author, narrator, duration, and
          abridgement before choosing changes.
        </Text>
        <Field
          label="Audible ASIN"
          help="The 10-character identifier in the audiobook’s Audible page address."
          value={asin}
          onChangeText={(value) => {
            setASIN(value);
            setPreview(undefined);
            setSelected([]);
          }}
          maxLength={10}
          autoCapitalize="characters"
          editable={!loading && !saving}
        />
        <Select
          menu
          label="Audible region"
          value={region}
          onChange={(value) => {
            setRegion(value);
            setPreview(undefined);
            setSelected([]);
          }}
          options={[
            { value: 'us', label: 'United States' },
            { value: 'uk', label: 'United Kingdom' },
            { value: 'au', label: 'Australia' },
            { value: 'ca', label: 'Canada' },
            { value: 'de', label: 'Germany' },
            { value: 'es', label: 'Spain' },
            { value: 'fr', label: 'France' },
            { value: 'in', label: 'India' },
            { value: 'it', label: 'Italy' },
            { value: 'jp', label: 'Japan' },
          ]}
          disabled={loading || saving}
        />
        <Button
          label="Look up recording"
          kind="secondary"
          onPress={() => void lookup()}
          disabled={!/^[A-Z0-9]{10}$/i.test(asin.trim()) || loading || saving}
        />
        {!/^[A-Z0-9]{10}$/i.test(asin.trim()) ? (
          <Text className="text-sm text-muted">
            Enter a 10-character ASIN to look up a recording.
          </Text>
        ) : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {loading ? <LoadingState label="Looking up audiobook details…" /> : null}
        {preview ? (
          <View className="gap-4">
            <Text className="font-editorial-bold text-lg text-ink">{preview.title}</Text>
            <Text className="text-sm text-muted">
              {[
                preview.authors.join(', '),
                preview.runtime_minutes ? `${preview.runtime_minutes} minutes` : '',
                preview.format,
                preview.recording.publisher,
                preview.recording.language,
                preview.recording.release_date.slice(0, 10),
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            <Text className="text-sm text-muted">
              Source: Audnexus · {preview.asin} · {preview.region.toUpperCase()}. Narrators apply to
              this recording. The description is shared by every edition of this book.
            </Text>
            {(['narrators', 'description'] as const).map((field) => {
              const current =
                field === 'narrators'
                  ? preview.current.narrators.join(', ')
                  : preview.current.description;
              const proposed =
                field === 'narrators'
                  ? preview.values.narrators.join(', ')
                  : preview.values.description;
              const unchanged = current === proposed;
              return (
                <View key={field} className="gap-2 border-b border-line pb-4">
                  <Checkbox
                    label={field === 'narrators' ? 'Replace narrators' : 'Replace book description'}
                    checked={selected.includes(field)}
                    onPress={() => toggle(field)}
                    disabled={saving || conflict || unchanged || !proposed}
                  />
                  {unchanged || !proposed ? (
                    <Text className="text-sm text-muted">
                      {unchanged ? 'Already matches.' : 'Not supplied by this recording.'}
                    </Text>
                  ) : null}
                  <Text className="text-xs text-muted">Current</Text>
                  <Text className="text-sm leading-6 text-muted">{current || 'Not set'}</Text>
                  <Text className="text-xs text-muted">Suggested</Text>
                  <Text className="text-sm leading-6 text-ink">{proposed || 'Not supplied'}</Text>
                </View>
              );
            })}
          </View>
        ) : null}
      </View>
    </Dialog>
  );
}
