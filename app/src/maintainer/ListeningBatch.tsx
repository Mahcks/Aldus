import { useEffect, useState } from 'react';
import { Button, ErrorState, LoadingState } from '@/components/ui';
import { Text, View } from '@/components/ui/tw';
import {
  ListeningPractice,
  type ListeningAnswer,
  type ListeningSession,
} from './ListeningPractice';

const origin = 'http://127.0.0.1:18882';
type Batch = {
  id: string;
  proposal_origin?: string;
  book_title?: string;
  sessions: (ListeningSession & { chapter: number | null })[];
  answers: Record<string, ListeningAnswer>;
};

export function ListeningBatch() {
  const [batch, setBatch] = useState<Batch>();
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`${origin}/batch.json`, { signal: controller.signal });
        if (!response.ok) throw new Error('The listening batch is not running.');
        const value = (await response.json()) as Batch;
        if (
          !/^[a-f0-9]{64}$/.test(value.id) ||
          !Array.isArray(value.sessions) ||
          value.sessions.length < 1 ||
          value.sessions.length > 12 ||
          !value.answers ||
          new Set(value.sessions.map((item) => item.id)).size !== value.sessions.length
        )
          throw new Error('The listening batch is invalid.');
        if (controller.signal.aborted) return;
        setBatch(value);
        const next = value.sessions.findIndex((item) => !value.answers[item.id]);
        setIndex(next < 0 ? 0 : next);
        setComplete(next < 0);
      } catch (error) {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : 'Could not load the batch.');
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  if (error)
    return (
      <ErrorState title="The listening batch isn’t available">
        {error} Keep the listening server running and reload this page.
      </ErrorState>
    );
  if (!batch) return <LoadingState label="Loading your passages" />;
  const current = batch.sessions[index];
  const answers = Object.values(batch.answers);
  const unsure = answers.filter((item) => item.result === 'unsure').length;

  async function save(answer: ListeningAnswer) {
    const response = await fetch(`${origin}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batch_id: batch!.id, session_id: current.id, ...answer }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not save. Please retry.');
    setBatch((previous) => (previous ? { ...previous, answers: result.answers } : previous));
  }

  if (complete)
    return (
      <View className="mx-auto w-full max-w-[680px] gap-5 px-5 py-12">
        <Text accessibilityRole="header" className="text-2xl font-sans-semibold text-ink">
          {batch.sessions.length === 5 ? 'All five saved' : 'Review saved'}
        </Text>
        <Text className="text-base leading-6 text-ink">
          {answers.length - unsure} confirmed, {unsure} marked unsure. That’s enough for this batch.
        </Text>
        <Text className="text-base leading-6 text-muted">
          Your answers are saved on this computer for review. Unsure answers stay unresolved.
        </Text>
        <Button
          label="Review my answers"
          onPress={() => {
            setIndex(0);
            setComplete(false);
          }}
        />
      </View>
    );

  return (
    <ListeningPractice
      key={current.id}
      session={current}
      saved={batch.answers[current.id]}
      onSave={save}
      heading={
        batch.sessions.length === 1
          ? `${batch.book_title ?? 'Alice'} · passage recheck`
          : `${batch.book_title ?? 'Alice'} · passage ${index + 1} of ${batch.sessions.length}`
      }
      navigation={{
        previous: index > 0 ? () => setIndex(index - 1) : undefined,
        nextLabel: index === batch.sessions.length - 1 ? 'Finish batch' : 'Next passage',
        next: () => (index === batch.sessions.length - 1 ? setComplete(true) : setIndex(index + 1)),
      }}
    />
  );
}
