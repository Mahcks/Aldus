export type ReaderContentsSource = {
  title?: string;
  label?: string;
  href?: string;
  children?: ReaderContentsSource[];
  subitems?: ReaderContentsSource[];
};

export type FlattenedReaderContents = { title: string; href: string; depth: number };

export function flattenReaderContents(
  items: ReaderContentsSource[] = [],
  depth = 0,
): FlattenedReaderContents[] {
  return items.flatMap((item) => [
    ...(item.href
      ? [
          {
            title: item.title?.trim() || item.label?.trim() || 'Untitled section',
            href: item.href,
            depth,
          },
        ]
      : []),
    ...flattenReaderContents(item.children ?? item.subitems ?? [], depth + 1),
  ]);
}
