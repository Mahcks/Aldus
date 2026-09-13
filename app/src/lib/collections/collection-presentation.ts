export function collectionCount(count: number) {
  return `${count} ${count === 1 ? 'book' : 'books'}`;
}

export function moveCollectionWork(ids: string[], index: number, direction: -1 | 1) {
  const destination = index + direction;
  if (index < 0 || index >= ids.length || destination < 0 || destination >= ids.length) return ids;
  const next = [...ids];
  [next[index], next[destination]] = [next[destination], next[index]];
  return next;
}
