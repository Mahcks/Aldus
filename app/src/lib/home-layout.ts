import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { parseStoredJSON } from './stored-json';

export type HomeLayout = 'shelf' | 'grid';

const key = 'aldus:home-layout';

/**
 * One global choice for every horizontal shelf on Home (Continue, Want to
 * read, Recently added, Finished) — not a per-section setting, so switching
 * it anywhere on the page changes how all of them read.
 */
export function useHomeLayout(): [HomeLayout, (value: HomeLayout) => void] {
  const [layout, setLayoutState] = useState<HomeLayout>('shelf');

  useEffect(() => {
    let canceled = false;
    AsyncStorage.getItem(key).then((raw) => {
      const saved = parseStoredJSON<HomeLayout>(raw);
      if (!canceled && (saved === 'shelf' || saved === 'grid')) setLayoutState(saved);
    });
    return () => {
      canceled = true;
    };
  }, []);

  function setLayout(value: HomeLayout) {
    setLayoutState(value);
    void AsyncStorage.setItem(key, JSON.stringify(value));
  }

  return [layout, setLayout];
}
