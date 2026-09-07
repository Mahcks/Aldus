import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState, Platform } from 'react-native';
import type { TitleRequest } from '@/generated/api';
import { api, errorMessage } from '@/lib/api';
import { getAPIBaseURL } from '@/lib/api-base';
import { useAuth } from '@/features/auth/AuthProvider';
import { isActiveRequestState } from '@/features/activity-presentation';

/** Both the reader and administrator page titles before loading their formats. */
export function useTitleRequests(filter: string, own: boolean, focusID = '', focusLibrary = '') {
  const auth = useAuth();
  const [items, setItems] = useState<TitleRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const depth = useRef(1);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const origin = getAPIBaseURL();

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      let running = false;
      let reload = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let generation = 0;
      depth.current = 1;
      setItems([]);
      setHasMore(false);
      setLoading(true);

      function foreground() {
        return Platform.OS === 'web'
          ? typeof document === 'undefined' || document.visibilityState !== 'hidden'
          : AppState.currentState === 'active';
      }

      async function load() {
        if (!alive || !foreground()) return;
        if (running) {
          reload = true;
          return;
        }
        clearTimeout(timer);
        running = true;
        const attempt = ++generation;
        const current = () => alive && attempt === generation && origin === getAPIBaseURL();
        try {
          const libraries = await api.libraries();
          const next: TitleRequest[] = [];
          let more = false;
          for (const library of libraries) {
            if (!current()) return;
            let cursor = '';
            for (let page = 0; page < depth.current; page++) {
              const result = await api.titleRequestPage(library.id, { filter, own, cursor });
              if (!current()) return;
              next.push(...result.items);
              cursor = result.next_cursor ?? '';
              if (!cursor) break;
            }
            more ||= Boolean(cursor);
          }
          if (focusID && focusLibrary) {
            const focused = await api.titleRequest(focusLibrary, focusID);
            if (!own || focused.requested_by === auth.user?.id) next.push(focused);
          }
          if (!current()) return;
          const unique = [...new Map(next.map((item) => [item.id, item])).values()];
          const focused = unique.find((item) => item.id === focusID);
          setItems(focused ? [focused, ...unique.filter((item) => item.id !== focusID)] : unique);
          setHasMore(more);
          setError('');
          if (
            next.some((item) => item.formats.some((format) => isActiveRequestState(format.state)))
          ) {
            timer = setTimeout(() => void load(), 10_000);
          }
        } catch (value) {
          if (current()) setError(errorMessage(value));
        } finally {
          running = false;
          if (current()) setLoading(false);
          if (alive && foreground() && (reload || attempt !== generation)) {
            reload = false;
            void load();
          }
        }
      }

      function onForeground() {
        if (foreground()) void load();
        else {
          clearTimeout(timer);
          generation++;
        }
      }

      refreshRef.current = load;
      void load();
      const subscription = AppState.addEventListener('change', onForeground);
      if (Platform.OS === 'web') document.addEventListener('visibilitychange', onForeground);
      return () => {
        alive = false;
        generation++;
        clearTimeout(timer);
        subscription.remove();
        if (Platform.OS === 'web') document.removeEventListener('visibilitychange', onForeground);
        refreshRef.current = async () => {};
      };
    }, [auth.user?.id, origin, filter, own, focusID, focusLibrary]),
  );

  const refresh = useCallback(() => refreshRef.current(), []);
  const loadMore = useCallback(async () => {
    depth.current++;
    setLoading(true);
    await refreshRef.current();
  }, []);
  return { items, loading, error, hasMore, refresh, loadMore };
}
