import { useAuth } from '@/features/auth/AuthProvider';
import { getAPIBaseURL } from '@/lib/api-base';
import { useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import type { RequestLibrary, TitleRequest, TitleSearchResult } from '@/generated/api';
import { api, errorMessage } from '@/lib/api';
import { Text, View } from '@/features/tw';
import { Button, LoadingState, Notice, Select, StatusBadge } from '@/features/ui';
import { titleRequestPresentation } from '@/features/title-search';

type BookFormat = 'ebook' | 'audiobook';

function requestReadinessMessage(reason: string, format: BookFormat) {
  const label = format === 'ebook' ? 'ebooks' : 'audiobooks';
  switch (reason) {
    case 'permission':
      return 'Ask a library owner for permission to request books.';
    case 'disabled':
      return 'Book requests are not enabled on this server yet.';
    case 'setup':
      return `An owner needs to set up ${label} for this library.`;
    case 'quota':
      return 'Your active request limit is reached. Existing requests can still be checked; new titles must wait.';
    default:
      return '';
  }
}

/** Shared acquisition controls; this never downloads existing files to the device. */
export function RequestActions({
  book,
  onLibraryChange,
}: {
  book: TitleSearchResult;
  onLibraryChange?: (libraryID: string) => void;
}) {
  const auth = useAuth();
  const scope = `${getAPIBaseURL()}:${auth.user?.id}`;
  const scopeRef = useRef(scope);
  useEffect(() => {
    scopeRef.current = scope;
  }, [scope]);
  const [libraries, setLibraries] = useState<RequestLibrary[]>([]);
  const [libraryID, setLibraryID] = useState(book.library_id ?? '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [requests, setRequests] = useState<Partial<Record<BookFormat, TitleRequest>>>({});
  const alive = useRef(true);
  const submitting = useRef(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let current = true;
    alive.current = true;
    async function load() {
      setLoading(true);
      setRequests({});
      try {
        const values = await api.requestLibraries();
        const choices = book.library_id
          ? values.filter((item) => item.library_id === book.library_id)
          : values;
        let existing: TitleRequest[] = [];
        if (book.work_id && book.library_id) {
          const page = await api.titleRequestPage(book.library_id, {
            own: true,
            work_id: book.work_id,
            filter: 'active',
          });
          existing = page.items;
        }
        if (!current || scopeRef.current !== scope) return;
        setLibraries(choices);
        const eligible = choices.filter(
          (item) =>
            (!book.readable && ['', 'quota'].includes(item.ebook_reason)) ||
            (!book.listenable && ['', 'quota'].includes(item.audiobook_reason)),
        );
        const selected = book.library_id || (eligible.length === 1 ? eligible[0].library_id : '');
        setLibraryID(selected);
        onLibraryChange?.(selected);
        const formats: Partial<Record<BookFormat, TitleRequest>> = {};
        for (const request of existing) {
          for (const format of request.formats) {
            if (format.format === 'ebook' || format.format === 'audiobook')
              formats[format.format] = request;
          }
        }
        setRequests(formats);
        setError('');
      } catch (value) {
        if (current) setError(errorMessage(value));
      } finally {
        if (current) setLoading(false);
      }
    }
    void load();
    return () => {
      current = false;
      alive.current = false;
    };
    // The parent keys this component by book; callbacks do not restart a loaded form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.work_id, book.library_id, retry, scope]);

  const destination = libraries.find((item) => item.library_id === libraryID);

  function selectLibrary(value: string) {
    if (submitting.current) return;
    setLibraryID(value);
    setRequests({});
    setError('');
    onLibraryChange?.(value);
  }

  async function requestFormat(format: BookFormat) {
    if (!destination || submitting.current) return;
    submitting.current = true;
    setBusy(format);
    setError('');
    try {
      const request = await api.createTitleRequest(destination.library_id, {
        work_id: book.work_id ?? '',
        external_source: book.external_source ?? '',
        external_id: book.external_id ?? '',
        title: book.title,
        author: book.author ?? '',
        cover_url: book.cover_url ?? '',
        formats: [format],
      });
      if (!alive.current || scopeRef.current !== scope) return;
      setRequests((current) => ({ ...current, [format]: request }));
    } catch (value) {
      if (alive.current && scopeRef.current === scope) setError(errorMessage(value));
    } finally {
      submitting.current = false;
      if (alive.current && scopeRef.current === scope) setBusy('');
    }
  }

  if (loading) return <LoadingState label="Checking request options…" />;

  return (
    <View className="gap-3">
      {libraries.length > 1 && !book.library_id ? (
        <Select
          label="Request in"
          disabled={Boolean(busy)}
          value={libraryID}
          options={[
            ...libraries.map((item) => ({ value: item.library_id, label: item.library_name })),
          ]}
          onChange={selectLibrary}
        />
      ) : destination ? (
        <Text className="text-sm text-muted">Request in {destination.library_name}</Text>
      ) : !error ? (
        <Text className="text-sm text-muted">No library is set up for book requests yet.</Text>
      ) : null}
      {error ? <Notice danger>{error}</Notice> : null}
      {error && libraries.length === 0 ? (
        <Button label="Try again" kind="secondary" onPress={() => setRetry((value) => value + 1)} />
      ) : null}
      {(['ebook', 'audiobook'] as const).map((format) => {
        if (format === 'ebook' ? book.readable : book.listenable) return null;
        const request = requests[format];
        const state = request?.formats.find((item) => item.format === format)?.state;
        const status = titleRequestPresentation(state);
        const reason =
          destination?.[format === 'ebook' ? 'ebook_reason' : 'audiobook_reason'] ?? '';
        const blocked = !destination || (reason !== '' && reason !== 'quota');
        const label = format === 'ebook' ? 'ebook' : 'audiobook';
        return (
          <View key={format} className="gap-1">
            {request && status && !status.requestable ? (
              <View className="flex-row flex-wrap items-center gap-2">
                <Text className="text-sm font-sans-semibold text-ink">
                  {format === 'ebook' ? 'Ebook' : 'Audiobook'}
                </Text>
                <StatusBadge label={status.label} tone={status.tone} />
                <Button
                  label="View request"
                  kind="quiet"
                  onPress={() =>
                    router.push({
                      pathname: '/activity',
                      params: { request: request.id, library: request.library_id, format },
                    })
                  }
                />
              </View>
            ) : (
              <>
                <View className="items-start">
                  <Button
                    label={status?.requestable ? `Request ${label} again` : `Request ${label}`}
                    kind="secondary"
                    loading={busy === format}
                    disabled={blocked || Boolean(busy)}
                    onPress={() => void requestFormat(format)}
                  />
                </View>
                {reason ? (
                  <Text className="text-sm leading-5 text-muted">
                    {requestReadinessMessage(reason, format)}
                  </Text>
                ) : null}
              </>
            )}
          </View>
        );
      })}
      {libraries.length > 1 && !destination ? (
        <Text className="text-sm text-muted">Choose which library should receive this book.</Text>
      ) : null}
    </View>
  );
}
