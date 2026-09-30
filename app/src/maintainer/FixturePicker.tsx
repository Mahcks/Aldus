import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { Select } from '@/components/ui';
import { Text, View } from '@/components/ui/tw';
import { authoringFixtures, verifyMedia, type AuthoringFixture } from './fixtures';

export type AuthoringMedia = { definition: AuthoringFixture; epub: string; audio: string };

export function FixturePicker({ children }: { children: (media: AuthoringMedia) => ReactNode }) {
  const [id, setID] = useState(authoringFixtures[0].id);
  const definition = authoringFixtures.find((fixture) => fixture.id === id)!;

  if (Platform.OS !== 'web') return <Text>Annotation tools require a web browser.</Text>;

  return (
    <View className="flex-1 bg-canvas">
      <View className="border-b border-line p-4">
        <Select
          menu
          label="Annotation fixture"
          value={id}
          onChange={setID}
          options={authoringFixtures.map((fixture) => ({
            value: fixture.id,
            label: fixture.label,
          }))}
        />
      </View>
      <FixtureMedia key={id} definition={definition}>
        {children}
      </FixtureMedia>
    </View>
  );
}

function FixtureMedia({
  definition,
  children,
}: {
  definition: AuthoringFixture;
  children: (media: AuthoringMedia) => ReactNode;
}) {
  const [epub, setEPUB] = useState<string>();
  const [audio, setAudio] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const urls = useRef<string[]>([]);
  const verifying = useRef(false);

  useEffect(() => {
    alive.current = true;
    const mediaURLs = urls.current;
    return () => {
      alive.current = false;
      for (const url of mediaURLs) URL.revokeObjectURL(url);
    };
  }, []);

  async function choose(file: File | undefined, kind: 'epub' | 'audio') {
    if (!file || verifying.current) return;
    verifying.current = true;
    setBusy(true);
    setError('');
    try {
      await verifyMedia(file, kind === 'epub' ? definition.epubSHA : definition.audioSHA);
      if (!alive.current) return;
      const url = URL.createObjectURL(file);
      urls.current.push(url);
      if (kind === 'epub') setEPUB(url);
      else setAudio(url);
    } catch (error) {
      if (alive.current)
        setError(error instanceof Error ? error.message : 'Could not read this file.');
    } finally {
      verifying.current = false;
      if (alive.current) setBusy(false);
    }
  }

  if (epub && audio) return children({ definition, epub, audio });

  return (
    <View className="gap-4 p-4">
      <Text className="text-base text-ink">
        Choose the pinned files from your computer. Files stay in this browser.
      </Text>
      {(['epub', 'audio'] as const).map((kind) => (
        <label key={kind} className="flex flex-col gap-2 text-sm text-ink">
          {kind === 'epub' ? 'EPUB file' : 'Audiobook file'}: {definition[kind]}
          <input
            type="file"
            accept={kind === 'epub' ? '.epub' : '.m4b,.mp3'}
            disabled={busy || Boolean(kind === 'epub' ? epub : audio)}
            className="min-h-11 max-w-full rounded-control border border-line-strong bg-control p-2 focus-visible:outline-2 focus-visible:outline-focus"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              void choose(file, kind);
            }}
          />
          {(kind === 'epub' ? epub : audio) && <span>Hash verified.</span>}
        </label>
      ))}
      <Text accessibilityLiveRegion="polite" className="text-sm text-muted">
        {busy
          ? 'Checking file hash. Large audiobooks can take a moment.'
          : 'Both file hashes must match before annotation opens.'}
      </Text>
      {error ? (
        <Text accessibilityRole="alert" className="text-sm text-danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
