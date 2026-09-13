import { useCallback, useState, type RefObject } from 'react';
import type {
  EPUBReaderHandle,
  ReaderSearchResult,
} from '@/components/consumption/reader/EPUBReader';
import { errorMessage } from '@/lib/api';

export function useReaderSearch(reader: RefObject<EPUBReaderHandle | null>) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ReaderSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [ran, setRan] = useState(false);
  const [error, setError] = useState('');

  const reset = useCallback(() => {
    setQuery('');
    setResults([]);
    setRan(false);
    setError('');
  }, []);

  async function search() {
    const trimmedQuery = query.trim();
    if (!trimmedQuery || !reader.current) return;
    setSearching(true);
    setRan(false);
    setError('');
    try {
      setResults(await reader.current.search(trimmedQuery));
    } catch (error) {
      setResults([]);
      setError(errorMessage(error));
    } finally {
      setSearching(false);
      setRan(true);
    }
  }

  function changeQuery(query: string) {
    setQuery(query);
    setResults([]);
    setRan(false);
    setError('');
  }

  return { query, results, searching, ran, error, search, changeQuery, reset };
}
