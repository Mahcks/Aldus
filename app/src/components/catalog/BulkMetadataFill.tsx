import { useEffect, useRef, useState } from 'react';
import type { WorkSummary } from '@/generated/api';
import { api } from '@/lib/api';
import { fillMissingMetadata, type FillResult } from '@/lib/catalog/fill-missing-metadata';
import { Button, Checkbox, Dialog, Notice } from '@/components/ui';
import { Text, View } from '@/components/ui/tw';

export function BulkMetadataFill({
  works,
  onClose,
  onFinished,
}: {
  works: WorkSummary[];
  onClose: () => void;
  onFinished: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [activeTitle, setActiveTitle] = useState('');
  const [results, setResults] = useState<{ title: string; result: FillResult }[]>([]);
  const stop = useRef(false);
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stop.current = true;
    };
  }, []);

  async function start() {
    if (running.current || !selected.length) return;
    running.current = true;
    setStarted(true);
    setBusy(true);
    for (const work of works.filter((work) => selected.includes(work.id))) {
      if (stop.current) break;
      setActiveTitle(work.title);
      let result: FillResult;
      try {
        result = await fillMissingMetadata(api, work.id);
      } catch {
        result = { fields: [], notes: ['Could not finish this book. Retry or review it.'] };
      }
      if (!mounted.current) break;
      setResults((current) => [...current, { title: work.title, result }]);
      // Keep batches modest for public metadata services; never fan out requests.
      if (!stop.current) await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    running.current = false;
    if (!mounted.current) return;
    setBusy(false);
    setActiveTitle('');
    await onFinished();
  }

  return (
    <Dialog
      visible
      wide
      sheet
      title="Fill missing details"
      onClose={() => {
        if (!running.current) onClose();
      }}
      footer={
        busy ? (
          <Button
            label={stopping ? 'Stopping after this book…' : 'Stop after this book'}
            disabled={stopping}
            onPress={() => {
              stop.current = true;
              setStopping(true);
            }}
          />
        ) : started ? (
          <Button label="Done" kind="primary" onPress={onClose} />
        ) : (
          <Button
            label={`Fill missing details for ${selected.length} ${selected.length === 1 ? 'book' : 'books'}`}
            kind="primary"
            disabled={!selected.length}
            onPress={() => void start()}
          />
        )
      }
    >
      <View className="gap-4">
        {!started ? (
          <>
            <Text className="text-sm leading-6 text-muted">
              Choose books from this page. Aldus reads file tags, then searches online for a
              matching book. Only blank fields are filled; existing details stay as they are.
            </Text>
            <Text className="text-sm leading-6 text-muted">
              Narrators require matching recording tags or an exact Audible identifier. Audible
              identifiers are checked in the US catalog. Uncertain matches stay for review.
            </Text>
            <Checkbox
              label="Select all books on this page"
              checked={selected.length === works.length}
              onPress={() =>
                setSelected(selected.length === works.length ? [] : works.map((work) => work.id))
              }
            />
            {works.map((work) => (
              <Checkbox
                key={work.id}
                label={work.title}
                checked={selected.includes(work.id)}
                onPress={() =>
                  setSelected((current) =>
                    current.includes(work.id)
                      ? current.filter((id) => id !== work.id)
                      : [...current, work.id],
                  )
                }
              />
            ))}
            {!selected.length ? (
              <Text className="text-sm text-muted">Select at least one book to begin.</Text>
            ) : null}
          </>
        ) : (
          <>
            <Text
              accessibilityLiveRegion="polite"
              className="text-base font-sans-semibold text-ink"
            >
              {results.length} of {selected.length} books processed
            </Text>
            {busy ? (
              <Notice>Filling details for {activeTitle}. Keep this page open.</Notice>
            ) : (
              <Notice tone="success">
                {stopping
                  ? 'Stopped. Completed changes were kept.'
                  : 'Finished. Existing details were preserved.'}
              </Notice>
            )}
            {results.map((item, index) => (
              <View key={index} className="gap-1 border-b border-line pb-3">
                <Text className="text-base font-editorial text-ink">{item.title}</Text>
                <Text className="text-sm text-ink">
                  {item.result.fields.length
                    ? `Filled: ${item.result.fields.map((field) => field.replaceAll('_', ' ')).join(', ')}.`
                    : 'No fields changed.'}
                </Text>
                {item.result.notes.map((note) => (
                  <Text key={note} className="text-sm text-muted">
                    {note}
                  </Text>
                ))}
              </View>
            ))}
          </>
        )}
      </View>
    </Dialog>
  );
}
