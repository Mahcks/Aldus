import { useEffect, useState } from 'react';
import type { FileMetadataPreview, FileMetadataValues } from '@/generated/api';
import { api, APIError, errorMessage } from '@/lib/api';
import { metadataFields, metadataValueText } from '@/lib/catalog/metadata-review';
import { Button, Checkbox, Dialog, LoadingState, Notice } from '@/components/ui';
import { Text, View } from '@/components/ui/tw';

function fieldText(value: FileMetadataValues, field: string): string {
  if (field === 'series') return [value.series, value.series_position].filter(Boolean).join(' · ');
  if (field === 'narrators') return (value.narrators ?? []).join('\n');
  return metadataValueText(value.values[field as keyof FileMetadataValues['values']]);
}

export function FileMetadataReview({
  mediaID,
  onClose,
  onApplied,
  applyLabel,
  onAudiobookLookup,
}: {
  mediaID: string;
  onAudiobookLookup?: (asin: string) => void;
  onClose: () => void;
  onApplied: () => Promise<void>;
  applyLabel?: string;
}) {
  const [preview, setPreview] = useState<FileMetadataPreview>();
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    api
      .fileMetadata(mediaID)
      .then((value) => {
        if (active) setPreview(value);
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mediaID, retry]);

  function reload() {
    setLoading(true);
    setError('');
    setPreview(undefined);
    setSelected([]);
    setConflict(false);
    setRetry((value) => value + 1);
  }

  const fields = [
    ...metadataFields.filter(([field]) => field !== 'cover_url'),
    ['series', 'Series and position'],
    ['narrators', 'Narrators'],
  ];
  const suggestions = preview
    ? fields.filter(([field]) => {
        const value = fieldText(preview.suggested, field);
        return value !== '' && value !== '0' && value !== fieldText(preview.current, field);
      })
    : [];

  async function apply() {
    if (!preview || !selected.length || saving || conflict) return;
    setSaving(true);
    setError('');
    try {
      await api.applyFileMetadata(mediaID, {
        fields: selected,
        expected: preview.current,
        values: preview.suggested,
      });
      await onApplied();
      onClose();
    } catch (cause) {
      setConflict(cause instanceof APIError && cause.status === 409);
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      title="Review details from this file"
      visible
      wide
      sheet
      onClose={() => {
        if (!saving) onClose();
      }}
      footer={
        preview && suggestions.length ? (
          <View className="gap-2">
            {!selected.length ? (
              <Text className="text-sm text-muted">Select the details you want to update.</Text>
            ) : null}
            <Button
              label={applyLabel ?? 'Apply selected changes'}
              kind="primary"
              loading={saving}
              disabled={!selected.length || conflict}
              onPress={() => void apply()}
            />
          </View>
        ) : undefined
      }
    >
      <View className="gap-5">
        <Text className="text-sm leading-6 text-muted">
          Compare the details stored inside this file with your library. Only selected details will
          change. Narrators apply to this recording; book details apply to the shared book.
        </Text>
        {preview?.asin && onAudiobookLookup ? (
          <Button
            label="Find audiobook details using this file’s identifier"
            kind="secondary"
            onPress={() => onAudiobookLookup(preview.asin)}
          />
        ) : null}
        {loading ? <LoadingState label="Reading file details…" /> : null}
        {error ? (
          <Notice tone="danger">
            {conflict
              ? 'These details changed since you opened the preview. Reload to compare again.'
              : error}
          </Notice>
        ) : null}
        {!loading && (error || conflict) ? (
          <Button label="Reload preview" disabled={saving} onPress={reload} />
        ) : null}
        {preview && !suggestions.length ? (
          <Notice>No new details were found in this file.</Notice>
        ) : null}
        {preview
          ? suggestions.map(([field, label]) => (
              <View key={field} className="gap-3 border-b border-line pb-4">
                <Checkbox
                  label={`Update ${label.toLowerCase()}`}
                  checked={selected.includes(field)}
                  disabled={saving || conflict}
                  onPress={() =>
                    setSelected((values) =>
                      values.includes(field)
                        ? values.filter((value) => value !== field)
                        : [...values, field],
                    )
                  }
                />
                <View className="gap-3 min-[600px]:flex-row">
                  <View className="min-w-0 flex-1 gap-1">
                    <Text className="text-sm font-sans-medium text-muted">Current</Text>
                    <Text className="text-sm leading-6 text-ink">
                      {fieldText(preview.current, field) || 'Not set'}
                    </Text>
                  </View>
                  <View className="min-w-0 flex-1 gap-1">
                    <Text className="text-sm font-sans-medium text-muted">Suggested</Text>
                    <Text className="text-sm leading-6 text-ink">
                      {fieldText(preview.suggested, field)}
                    </Text>
                  </View>
                </View>
              </View>
            ))
          : null}
      </View>
    </Dialog>
  );
}
