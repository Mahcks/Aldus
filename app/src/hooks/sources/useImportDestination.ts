import { useEffect, useState } from 'react';
import type { Representation, Work } from '@/generated/api';
import { api, errorMessage } from '@/lib/api';

const pageSize = 20;

/** Search results and the selected destination have independent lifetimes. */
export function useImportDestination(libraryID: string, proposalID: string, workID: string) {
  const [search, setSearch] = useState({ scope: '', query: '', offset: 0 });
  const [searchRetry, setSearchRetry] = useState(0);
  const [selectionRetry, setSelectionRetry] = useState(0);
  const [page, setPage] = useState({ key: '', works: [] as Work[], hasMore: false, error: '' });
  const [selection, setSelection] = useState({
    key: '',
    work: undefined as Work | undefined,
    representations: [] as Representation[],
    error: '',
  });
  const scope = `${libraryID}/${proposalID}`;
  const query = search.scope === scope ? search.query : '';
  const offset = search.scope === scope ? search.offset : 0;
  const searchKey = JSON.stringify([scope, query, offset, searchRetry]);
  const selectionKey = JSON.stringify([scope, workID, selectionRetry]);

  useEffect(() => {
    if (!proposalID) return;
    let current = true;
    void api.browseWorks({ libraryID, q: query, limit: pageSize, offset, sort: 'title' }).then(
      (result) => {
        if (!current) return;
        setPage((previous) => ({
          key: searchKey,
          works: offset ? [...previous.works, ...result.items] : result.items,
          hasMore: result.has_more,
          error: '',
        }));
      },
      (value: unknown) => {
        if (!current) return;
        setPage((previous) => ({
          key: searchKey,
          works: offset ? previous.works : [],
          hasMore: false,
          error: errorMessage(value),
        }));
      },
    );
    return () => {
      current = false;
    };
  }, [libraryID, proposalID, query, offset, searchKey]);

  useEffect(() => {
    if (!proposalID || !workID) return;
    let current = true;
    async function loadSelection() {
      try {
        const work = await api.work(workID);
        if (work.library_id !== libraryID) {
          if (current) {
            setSelection({
              key: selectionKey,
              work: undefined,
              representations: [],
              error: 'This book is no longer in this library. Choose another destination.',
            });
          }
          return;
        }
        const representations = await api.representations(workID);
        if (current) setSelection({ key: selectionKey, work, representations, error: '' });
      } catch (value) {
        if (current) {
          setSelection({
            key: selectionKey,
            work: undefined,
            representations: [],
            error: errorMessage(value),
          });
        }
      }
    }
    void loadSelection();
    return () => {
      current = false;
    };
  }, [libraryID, proposalID, workID, selectionKey]);

  const selectionCurrent = selection.key === selectionKey;
  const selectionLoading = Boolean(workID) && !selectionCurrent;
  const selectedWork = selectionCurrent ? selection.work : undefined;
  const selectionError = selectionCurrent ? selection.error : '';
  const searchLoading = page.key !== searchKey;

  return {
    query,
    works: searchLoading ? [] : page.works,
    hasMore: !searchLoading && page.hasMore,
    searchLoading,
    searchError: searchLoading ? '' : page.error,
    selectedWork,
    selectionLoading,
    selectionError,
    representations: selectionCurrent && workID ? selection.representations : [],
    ready: !workID || Boolean(selectedWork && !selectionError),
    search: (value: string) => setSearch({ scope, query: value, offset: 0 }),
    loadMore: () => setSearch({ scope, query, offset: page.works.length }),
    retrySearch: () => setSearchRetry((value) => value + 1),
    retrySelection: () => setSelectionRetry((value) => value + 1),
  };
}
