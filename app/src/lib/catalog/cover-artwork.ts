import type { WorkSummary } from '@/generated/api';

/** Try the other format when the primary image fails, not the same default URL again. */
export function fallbackCoverURL(
  work: Pick<WorkSummary, 'cover_url' | 'ebook_cover_url' | 'audiobook_cover_url'>,
  format: 'ebook' | 'audiobook' = work.cover_url === work.audiobook_cover_url
    ? 'audiobook'
    : 'ebook',
): string | undefined {
  const primary =
    (format === 'ebook' ? work.ebook_cover_url : work.audiobook_cover_url) || work.cover_url;
  const other = format === 'ebook' ? work.audiobook_cover_url : work.ebook_cover_url;
  return [other, work.cover_url].find((url) => Boolean(url) && url !== primary);
}
