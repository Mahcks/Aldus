import type { ReaderPreferences } from '../generated/api';

export async function cachedReaderPreferences(): Promise<ReaderPreferences | null> {
  return null;
}

export async function cacheReaderPreferences(_value: ReaderPreferences) {}
