import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { FileMetadataValues, Representation } from '@/generated/api';
import { api, APIError, errorMessage } from '@/lib/api';
import { AudiobookLookupPanel } from './AudiobookLookupPanel';
import { AppIcon } from '@/components/ui/icons';
import { useThemeColors } from '@/components/ui/theme';
import { Button, Field, Notice } from '@/components/ui';
import { Text, View } from '@/components/ui/tw';

// Only explicit narration credits qualify. A generic edition name is not a person.
export function narratorFromEditionLabel(label: string): string {
  return /^(?:narrated|read)\s+by\s+(.+)$/i.exec(label.trim())?.[1]?.trim() ?? '';
}

export type NarratorEditorHandle = {
  isDirty: () => boolean;
  save: () => Promise<boolean>;
  discard: () => void;
};

export const NarratorEditor = forwardRef<
  NarratorEditorHandle,
  {
    recording: Representation;
    mediaID: string;
    onSaved: () => Promise<void>;
    onSkip: () => void;
  }
>(function NarratorEditor({ recording, mediaID, onSaved, onSkip }, ref) {
  const colors = useThemeColors();
  const labelSuggestion = narratorFromEditionLabel(recording.label);
  const [expected, setExpected] = useState(recording.narrators ?? []);
  const [text, setText] = useState(
    recording.narrators?.length ? recording.narrators.join('\n') : '',
  );
  const [suggestion, setSuggestion] = useState(recording.narrators?.length ? '' : labelSuggestion);
  const [suggestionSource, setSuggestionSource] = useState(labelSuggestion ? 'edition' : '');
  const [checking, setChecking] = useState(!recording.narrators?.length);
  const [fileMessage, setFileMessage] = useState('');
  const [asin, setASIN] = useState('');
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');
  const edited = useRef(false);
  const mounted = useRef(true);
  const saveLock = useRef(false);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    if (!recording.narrators?.length) {
      api
        .fileMetadata(mediaID)
        .then((preview) => {
          if (!active) return;
          setASIN(preview.asin);
          if (edited.current) return;
          setExpected(preview.current.narrators ?? []);
          if (preview.current.narrators?.length) {
            setText(preview.current.narrators.join('\n'));
            setSuggestion('');
          } else if (preview.suggested.narrators?.length) {
            setSuggestion(preview.suggested.narrators.join('\n'));
            setSuggestionSource('file');
          } else if (!labelSuggestion) {
            setFileMessage('No narrator was found in the file tags.');
          }
        })
        .catch(() => {
          if (active)
            setFileMessage('Could not read the file tags. You can still enter a narrator.');
        })
        .finally(() => {
          if (active) setChecking(false);
        });
    }
    return () => {
      active = false;
      mounted.current = false;
    };
    // A parent refresh (e.g. after an inline Audnexus save) hands down a new
    // `recording` object even when narrators are unchanged; keying off the
    // count instead of the array reference avoids redundantly refetching the
    // file tags and re-deriving a suggestion the reviewer already dismissed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaID, recording.narrators?.length]);

  const names = text
    .split('\n')
    .map((name) => name.trim())
    .filter(Boolean);
  const changed = JSON.stringify(names) !== JSON.stringify(expected);

  function useSuggestion() {
    edited.current = true;
    setText(suggestion);
    setSuggestion('');
  }

  async function save(): Promise<boolean> {
    if (!names.length || !changed || conflict || saveLock.current) return false;
    saveLock.current = true;
    edited.current = true;
    setSaving(true);
    setError('');
    // Only narrators are selected; book details are neither compared nor changed.
    const current: FileMetadataValues = {
      values: {
        title: '',
        author: '',
        description: '',
        isbn: '',
        publisher: '',
        language: '',
        subjects: [],
        first_publish_year: 0,
        cover_url: '',
      },
      series: '',
      series_position: '',
      narrators: expected,
    };
    try {
      await api.applyFileMetadata(mediaID, {
        fields: ['narrators'],
        expected: current,
        values: { ...current, narrators: names },
      });
      if (!mounted.current) return true;
      setExpected(names);
      await onSaved();
      return true;
    } catch (cause) {
      if (!mounted.current) return false;
      setConflict(cause instanceof APIError && cause.status === 409);
      setError(errorMessage(cause));
      return false;
    } finally {
      saveLock.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  function discard() {
    edited.current = false;
    setText(expected.join('\n'));
    setError('');
    setConflict(false);
  }

  useImperativeHandle(
    ref,
    () => ({
      isDirty: () => names.length > 0 && changed && !conflict,
      save,
      discard,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [names, changed, conflict, expected, mediaID],
  );

  async function reload() {
    setError('');
    try {
      const latest = await api.representation(recording.id);
      if (!mounted.current) return;
      setExpected(latest.narrators ?? []);
      setText((latest.narrators ?? []).join('\n'));
      setSuggestion('');
      setConflict(false);
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause));
    }
  }

  return (
    <View className="gap-4">
      {conflict ? (
        <View className="flex-row items-start gap-2.5 rounded-card bg-warning-soft p-3">
          <AppIcon name="warning" size={16} color={colors.warning} />
          <View className="min-w-0 flex-1 gap-1">
            <Text className="text-sm font-sans-bold text-ink">
              Someone else saved this recording first
            </Text>
            <Text className="text-xs leading-5 text-muted">
              The narrator changed while you were reviewing it. Reload the saved value before trying
              again — your typed entry isn’t lost, but it can’t be applied until you do.
            </Text>
            <View className="mt-1 self-start">
              <Button label="Reload and try again" kind="secondary" onPress={() => void reload()} />
            </View>
          </View>
        </View>
      ) : null}

      <Field
        label="Narrator names"
        value={text}
        multiline
        editable={!saving}
        help="One name per line. Check that these are the people reading this recording."
        onChangeText={(value) => {
          edited.current = true;
          setText(value);
        }}
      />
      {suggestion ? (
        <View className="flex-row items-center gap-2.5 rounded-card bg-info-soft p-2.5">
          <AppIcon name="lightbulb" size={15} color={colors.info} />
          <Text className="min-w-0 flex-1 text-sm text-ink">
            {suggestionSource === 'file'
              ? `Found in this recording’s file tags: “${suggestion.replace(/\n/g, ', ')}” — not yet confirmed as a person’s name.`
              : `Suggested from this recording’s name: “${suggestion}” — not yet confirmed as a person’s name.`}
          </Text>
          <Button label="Use this" kind="secondary" disabled={saving} onPress={useSuggestion} />
        </View>
      ) : null}
      {checking ? (
        <Text className="text-sm text-muted">Checking file tags…</Text>
      ) : fileMessage && !suggestion ? (
        <Text className="text-sm text-muted">{fileMessage}</Text>
      ) : null}
      {error && !conflict ? <Notice danger>{error}</Notice> : null}
      {!names.length ? (
        <Text className="text-sm text-muted">
          Enter a narrator to save, or skip this recording if you don’t know.
        </Text>
      ) : !changed ? (
        <Text className="text-sm text-muted">These narrator names are already saved.</Text>
      ) : null}
      <View className="flex-row flex-wrap items-center gap-2">
        <Button
          label="Save narrator"
          kind="primary"
          loading={saving}
          disabled={!names.length || !changed || conflict}
          onPress={() => void save()}
        />
        <Button label="Skip for now" kind="quiet" onPress={onSkip} />
      </View>

      <AudiobookLookupPanel
        workID={recording.work_id}
        representationID={recording.id}
        initialASIN={asin}
        onApplied={onSaved}
      />
    </View>
  );
});
