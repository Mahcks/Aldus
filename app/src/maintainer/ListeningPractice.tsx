import { useEffect, useRef, useState } from 'react';
import { Button, ErrorState, LoadingState } from '@/components/ui';
import { ScrollView, Text, View } from '@/components/ui/tw';
import { verifyMedia } from './fixtures';

const origin = 'http://127.0.0.1:18882';
const storageKey = 'aldus:listening-practice:v1';

export type ListeningSession = {
  id: string;
  text: string;
  opening_word: string;
  start_ms: number;
  clip_sha256: string;
  clip_file?: string;
};

type Exercise = { session: ListeningSession; context: AudioContext; buffer: AudioBuffer };

export type ListeningAnswer = {
  clip_sha256: string;
  boundary_ms: number;
  result: 'right' | 'unsure';
};

type Props = {
  session?: ListeningSession;
  saved?: ListeningAnswer;
  onSave?: (answer: ListeningAnswer) => Promise<void>;
  heading?: string;
  navigation?: { previous?: () => void; next: () => void; nextLabel: string };
};

export function ListeningPractice({
  session: suppliedSession,
  saved,
  onSave,
  heading,
  navigation,
}: Props) {
  const [saving, setSaving] = useState(false);
  const [exercise, setExercise] = useState<Exercise>();
  const [boundary, setBoundary] = useState(0);
  const [heard, setHeard] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [result, setResult] = useState<'right' | 'unsure'>();
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const source = useRef<AudioBufferSourceNode | null>(null);
  const playback = useRef(0);
  const initialAnswer = useRef(saved);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const context = new AudioContext();
    async function load() {
      try {
        let session = suppliedSession;
        if (!session) {
          const response = await fetch(`${origin}/session.json`, { signal: controller.signal });
          if (!response.ok) throw new Error('The listening session could not be loaded.');
          session = (await response.json()) as ListeningSession;
        }
        if (
          !session.id ||
          !session.text ||
          !session.opening_word ||
          (session.clip_file !== undefined &&
            !/^(?:chapter|passage)-[0-9]+\.wav$/.test(session.clip_file)) ||
          !Number.isSafeInteger(session.start_ms) ||
          session.start_ms < 1000 ||
          !/^[a-f0-9]{64}$/.test(session.clip_sha256)
        ) {
          throw new Error('The practice session is invalid. Restart the practice server.');
        }
        const audio = await fetch(`${origin}/${session.clip_file ?? 'clip.wav'}`, {
          signal: controller.signal,
        });
        if (!audio.ok) throw new Error('The listening clip could not be loaded.');
        const bytes = await audio.arrayBuffer();
        await verifyMedia(new File([bytes], 'clip.wav'), session.clip_sha256);
        const buffer = await context.decodeAudioData(bytes);
        if (session.start_ms / 1000 + 4 > buffer.duration)
          throw new Error('The listening clip is incomplete.');
        if (!active) return;
        setBoundary(session.start_ms);
        try {
          const restored = suppliedSession
            ? initialAnswer.current
            : JSON.parse(localStorage.getItem(storageKey) || 'null');
          if (
            restored &&
            (suppliedSession || restored.session === session.id) &&
            restored.clip_sha256 === session.clip_sha256 &&
            Number.isSafeInteger(restored.boundary_ms) &&
            restored.boundary_ms >= 1000 &&
            restored.boundary_ms <= buffer.duration * 1000 - 4000 &&
            (restored.result === 'right' || restored.result === 'unsure')
          ) {
            setBoundary(restored.boundary_ms);
            setResult(restored.result);
          }
        } catch {
          // Unavailable or stale practice storage must not prevent listening.
        }
        setExercise({ session, context, buffer });
      } catch (error) {
        if (active)
          setError(error instanceof Error ? error.message : 'Could not prepare the clip.');
      }
    }
    void load();
    return () => {
      active = false;
      controller.abort();
      playback.current += 1;
      source.current?.stop();
      void context.close();
    };
  }, [suppliedSession]);

  function stop() {
    playback.current += 1;
    source.current?.stop();
    source.current = null;
    setPlaying(false);
  }

  async function listen(before = false, start = boundary) {
    if (!exercise) return;
    stop();
    const generation = playback.current;
    setMessage('');
    try {
      await exercise.context.resume();
      if (generation !== playback.current) return;
      const node = exercise.context.createBufferSource();
      node.buffer = exercise.buffer;
      node.connect(exercise.context.destination);
      source.current = node;
      setPlaying(true);
      node.onended = () => {
        node.disconnect();
        if (generation !== playback.current) return;
        setPlaying(false);
      };
      node.start(0, (before ? start - 1000 : start) / 1000, 1);
      if (!before) setHeard(true);
    } catch {
      setPlaying(false);
      setMessage('Audio could not play. Check your audio output and press Listen again.');
    }
  }

  function adjust(amount: number) {
    if (!exercise) return;
    const next = Math.max(
      1000,
      Math.min(exercise.buffer.duration * 1000 - 4000, boundary + amount),
    );
    setBoundary(next);
    setHeard(false);
    setResult(undefined);
    void listen(false, next);
  }

  async function finish(value: 'right' | 'unsure') {
    if (saving) return;
    setSaving(true);
    stop();
    try {
      const answer = {
        clip_sha256: exercise!.session.clip_sha256,
        boundary_ms: boundary,
        result: value,
      };
      if (onSave) {
        await onSave(answer);
      } else {
        // Practice feedback stays separate from real batch reviews.
        localStorage.setItem(
          storageKey,
          JSON.stringify({ ...answer, session: exercise!.session.id, practice_only: true }),
        );
      }
      setResult(value);
      setMessage('');
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Could not save this answer. Keep the page open and retry.',
      );
    } finally {
      setSaving(false);
    }
  }

  if (error)
    return (
      <ErrorState title="The listening clip isn’t available">
        {error} Keep the listening server running, then reload this page.
      </ErrorState>
    );
  if (!exercise) return <LoadingState label="Preparing your listening clip" />;

  return (
    <ScrollView className="flex-1 bg-canvas">
      <View className="mx-auto w-full max-w-[680px] gap-6 px-5 py-8 min-[820px]:py-12">
        <View className="gap-2">
          <Text accessibilityRole="header" className="text-2xl font-sans-semibold text-ink">
            {heading ?? 'Try one passage'}
          </Text>
          <Text className="text-base leading-6 text-muted">
            Press Listen. The clip should begin with the first sound of “
            {exercise.session.opening_word}”, with no word cut off.
          </Text>
        </View>
        <Text className="border-y border-line py-6 font-editorial text-2xl leading-9 text-ink">
          {exercise.session.text}
        </Text>
        <View className="gap-3">
          <Button
            label={playing ? 'Stop' : 'Listen'}
            disabled={saving}
            onPress={() => (playing ? stop() : void listen())}
          />
          <Button
            kind="quiet"
            label="Hear just before the start"
            disabled={saving}
            onPress={() => void listen(true)}
          />
          <Text className="text-sm leading-5 text-muted">
            Before the start, you should hear no part of “{exercise.session.opening_word}”.
          </Text>
        </View>
        <View className="gap-3">
          <Text className="text-base font-sans-semibold text-ink">How does the start sound?</Text>
          <View className="flex-row flex-wrap gap-3">
            <Button
              kind="secondary"
              label="Too early"
              disabled={saving || boundary >= exercise.buffer.duration * 1000 - 4000}
              onPress={() => adjust(100)}
            />
            <Button
              kind="secondary"
              label="Too late"
              disabled={saving || boundary <= 1000}
              onPress={() => adjust(-100)}
            />
          </View>
          <Text className="text-sm leading-5 text-muted">
            Silence first? Choose Too early. First sound missing? Choose Too late. Each tap moves
            the start a little and replays just one second.
          </Text>
          <View className="flex-row flex-wrap gap-3">
            <Button
              kind="secondary"
              label="Back 5 seconds"
              disabled={saving || boundary <= 1000}
              onPress={() => adjust(-5000)}
            />
            <Button
              kind="secondary"
              label="Forward 5 seconds"
              disabled={saving || boundary >= exercise.buffer.duration * 1000 - 4000}
              onPress={() => adjust(5000)}
            />
          </View>
          <Text accessibilityLiveRegion="polite" className="text-sm leading-5 text-muted">
            {boundary <= 1000
              ? 'Start of this clip reached. If the words begin earlier, choose Not sure.'
              : boundary >= exercise.buffer.duration * 1000 - 4000
                ? 'End of this clip reached. If the words begin later, choose Not sure.'
                : `${(boundary / 1000).toFixed(1)} seconds into this clip. Use the five-second jumps to find the words, then fine-tune above.`}
          </Text>
          <Button
            label={saving ? 'Saving…' : 'Perfect'}
            kind="primary"
            disabled={!heard || saving}
            onPress={() => finish('right')}
          />
          {!heard && (
            <Text className="text-sm text-muted">Listen to the clip before confirming.</Text>
          )}
          <Button
            kind="quiet"
            label="Not sure"
            disabled={saving}
            onPress={() => finish('unsure')}
          />
        </View>
        {result && (
          <Text accessibilityLiveRegion="polite" className="text-base leading-6 text-ink">
            {result === 'right'
              ? onSave
                ? 'Saved. This answer is recorded.'
                : 'Saved. That’s all for this practice passage.'
              : 'Saved as unsure. You don’t need to guess.'}{' '}
            {onSave
              ? 'Your progress is saved when you leave.'
              : 'You can keep listening or close this page.'}
          </Text>
        )}
        {message ? (
          <Text accessibilityRole="alert" className="text-base text-danger">
            {message}
          </Text>
        ) : null}
        {navigation && (
          <View className="gap-2">
            <View className="flex-row flex-wrap justify-between gap-3">
              {navigation.previous && (
                <Button
                  label="Previous"
                  kind="secondary"
                  disabled={saving}
                  onPress={navigation.previous}
                />
              )}
              <Button
                label={navigation.nextLabel}
                kind="primary"
                disabled={!result || saving}
                onPress={navigation.next}
              />
            </View>
            {!result && (
              <Text className="text-sm text-muted">Choose Perfect or Not sure to continue.</Text>
            )}
          </View>
        )}
        <Text className="text-sm leading-5 text-muted">
          {onSave
            ? 'Reviewing suggested starts in this recording. If this is the wrong passage or you cannot find the start, choose Not sure.'
            : 'Practice only. This uses an existing Alice annotation and won’t change the benchmark.'}
        </Text>
      </View>
    </ScrollView>
  );
}
