import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState, Platform } from 'react-native';
import type { TitleRequest } from '@/generated/api';
import { api, errorMessage } from '@/lib/api';
import { getAPIBaseURL } from '@/lib/api-base';
import { useAuth } from '@/components/auth/AuthProvider';
import { isActiveRequestState } from '@/lib/activity/activity-presentation';

/** Both the reader and administrator page titles before loading their formats. */
export function useTitleRequests(filter: string, own: boolean, focusID = '', focusLibrary = '') {
  const auth = useAuth();
  const [items, setItems] = useState<TitleRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const depth = useRef(1);
  const loadedScope = useRef('');
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const origin = getAPIBaseURL();

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      let running = false;
      let reload = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let generation = 0;
      const scope = JSON.stringify([auth.user?.id, origin, filter, own, focusID, focusLibrary]);
      if (loadedScope.current !== scope) {
        loadedScope.current = scope;
        depth.current = 1;
        setItems([]);
        setHasMore(false);
        setLoading(true);
      }

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
          // Libraries are independent; cursors within one library remain sequential.
          // Settle a bounded batch before continuing so failures cannot leave requests
          // from this refresh racing the next one. Publish only a complete result.
          const pageDepth = depth.current;
          for (let start = 0; start < libraries.length; start += 4) {
            if (!current()) return;
            const results = await Promise.allSettled(
              libraries.slice(start, start + 4).map(async (library) => {
                const items: TitleRequest[] = [];
                let cursor = '';
                for (let page = 0; page < pageDepth; page++) {
                  if (!current()) break;
                  const result = await api.titleRequestPage(library.id, { filter, own, cursor });
                  items.push(...result.items);
                  cursor = result.next_cursor ?? '';
                  if (!cursor) break;
                }
                return { items, cursor };
              }),
            );
            if (!current()) return;
            for (const result of results) {
              if (result.status === 'rejected') throw result.reason;
              next.push(...result.value.items);
              more ||= Boolean(result.value.cursor);
            }
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
