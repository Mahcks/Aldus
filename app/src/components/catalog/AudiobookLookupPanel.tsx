import { useEffect, useRef, useState } from 'react';
import type { AudiobookMetadataPreview } from '@/generated/api';
import { APIError, api, errorMessage } from '@/lib/api';
import { AppIcon } from '@/components/ui/icons';
import { useThemeColors } from '@/components/ui/theme';
import { Button, Checkbox, Field, LoadingState, Notice, Select } from '@/components/ui';
import { Text, View } from '@/components/ui/tw';

const REGIONS = [
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
];

type FieldName = 'narrators' | 'description';

/**
 * The Audnexus lookup, always visible inline under a recording's narrator
 * field — never behind an expander, since it is often the only real path
 * forward once a recording has no narrator in its file tags. Kept separate
 * from `AudiobookMetadataReview` (the modal version used on the Manage and
 * representation screens): this panel stays open after a save instead of
 * closing, and never assumes a dialog is presenting it.
 */
export function AudiobookLookupPanel({
  workID,
  representationID,
  initialASIN = '',
  onApplied,
}: {
  workID: string;
  representationID: string;
  initialASIN?: string;
  onApplied: () => Promise<void>;
}) {
  const colors = useThemeColors();
  const [asin, setASIN] = useState(initialASIN);
  const [region, setRegion] = useState('us');
  const [preview, setPreview] = useState<AudiobookMetadataPreview>();
  const [selected, setSelected] = useState<FieldName[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const generation = useRef(0);

  useEffect(() => {
    if (initialASIN) void lookupWith(initialASIN, region);
    // Only react to a newly-arrived identifier (e.g. from a file's embedded tag), not every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialASIN]);

  async function lookupWith(nextASIN: string, nextRegion: string) {
    const request = ++generation.current;
    setLoading(true);
    setError('');
    setPreview(undefined);
    setSelected([]);
    setConflict(false);
    setSaved(false);
    try {
      const result = await api.audiobookMetadata(
        workID,
        representationID,
        nextASIN.trim().toUpperCase(),
        nextRegion,
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
      setSaved(true);
      await onApplied();
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

  const validASIN = /^[A-Z0-9]{10}$/i.test(asin.trim());

  return (
    <View className="gap-3 rounded-card border border-line bg-panel p-3.5">
      <View className="gap-1">
        <View className="flex-row items-center gap-2">
          <AppIcon name="listen" size={16} color={colors.muted} />
          <Text className="text-sm font-sans-bold text-ink">Find it on Audible</Text>
        </View>
        <Text className="text-xs leading-5 text-muted">
          Paste the recording’s ASIN, the 10-character code in its Audible page address.
        </Text>
      </View>
      <View className="gap-3 sm:flex-row sm:items-end">
        <View className="min-w-0 flex-1">
          <Field
            label="Audible ASIN"
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
        </View>
        <View className="w-full sm:w-44">
          <Select
            menu
            label="Region"
            value={region}
            onChange={(value) => {
              setRegion(value);
              setPreview(undefined);
              setSelected([]);
            }}
            options={REGIONS}
            disabled={loading || saving}
          />
        </View>
        <Button
          label="Look up"
          kind="secondary"
          loading={loading}
          disabled={!validASIN || loading || saving}
          onPress={() => void lookupWith(asin, region)}
        />
      </View>
      {error ? <Notice danger>{error}</Notice> : null}
      {loading ? <LoadingState label="Looking up this recording on Audnexus…" /> : null}
      {preview ? (
        <View className="gap-3 rounded-card border border-success/30 bg-success-soft p-3">
          <Text className="text-sm leading-6 text-ink">
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
              <View key={field} className="gap-2 border-t border-line-subtle pt-3">
                <Checkbox
                  label={field === 'narrators' ? 'Replace narrators' : 'Replace book description'}
                  checked={selected.includes(field)}
                  onPress={() => toggle(field)}
                  disabled={saving || conflict || unchanged || !proposed}
                />
                {unchanged || !proposed ? (
                  <Text className="text-xs text-muted">
                    {unchanged ? 'Already matches.' : 'Not supplied by this recording.'}
                  </Text>
                ) : null}
                <View className="gap-3 min-[520px]:flex-row">
                  <View className="min-w-0 flex-1 gap-1">
                    <Text className="text-xs font-sans-semibold text-muted">Current</Text>
                    <Text className="text-sm leading-6 text-muted">{current || 'Not set'}</Text>
                  </View>
                  <View className="min-w-0 flex-1 gap-1">
                    <Text className="text-xs font-sans-semibold text-accent">Suggested</Text>
                    <Text className="text-sm leading-6 text-ink">{proposed || 'Not supplied'}</Text>
                  </View>
                </View>
              </View>
            );
          })}
          <Text className="text-xs text-muted">
            Source: Audnexus · {preview.asin} · {preview.region.toUpperCase()}. Narrators apply to
            this recording only; the description is shared by every edition of this book.
          </Text>
          {conflict ? (
            <Button label="Look up again" onPress={() => void lookupWith(asin, region)} />
          ) : (
            <Button
              label="Save selected changes"
              kind="primary"
              loading={saving}
              disabled={!selected.length}
              onPress={() => void apply()}
            />
          )}
          {saved ? (
            <Text className="text-xs font-sans-semibold text-success">Saved from Audnexus.</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
