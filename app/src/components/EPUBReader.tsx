import { forwardRef, useImperativeHandle } from 'react';
import { Text, View } from 'react-native';

export type RangeBoundary = { dom_path: string; node_offset: number };
export type ReaderCapture = {
  href: string;
  cfi: string;
  text: string;
  normalized_text: string;
  start: RangeBoundary;
  end: RangeBoundary;
};
export type ReaderLocation = {
  href: string;
  cfi: string;
  sync?: {
    href: string;
    locator: { type: 'dom-element'; dom_path: string; segment_id: string };
    offset: number;
  };
  syncState?: 'full' | 'partial' | 'none';
  reason?: 'relocate' | 'forward' | 'explicit' | 'restore';
};
export type EPUBReaderHandle = {
  captureSelection: () => ReaderCapture | null;
  restoreSelection: (capture: ReaderCapture) => Promise<string>;
  restoreLocation: (location: unknown, highlight?: boolean) => Promise<boolean>;
  navigate: (location: unknown) => Promise<boolean>;
  search: (query: string) => Promise<ReaderSearchResult[]>;
};
export type ReaderNavigationItem = { title: string; location: unknown; depth: number };
export type ReaderSearchResult = { title: string; excerpt: string; location: unknown };
export type ReaderPreferences = {
  layout: 'paginated' | 'scrolled';
  zoom: number;
  lineHeight: number;
  margin: number;
  theme: 'paper' | 'sepia' | 'night';
};
export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  layout: 'paginated',
  zoom: 1,
  lineHeight: 1.72,
  margin: 2,
  theme: 'paper',
};

export const EPUBReader = forwardRef<
  EPUBReaderHandle,
  {
    source?: string | Blob;
    product?: boolean;
    segments?: unknown[];
    preferences?: ReaderPreferences;
    compactChrome?: boolean;
    statusLabel?: string;
    onLocation?: (location: ReaderLocation) => void;
    onReady?: (contents: ReaderNavigationItem[]) => void;
    onError?: (error: Error) => void;
  }
>(function EPUBReader(_, ref) {
  useImperativeHandle(
    ref,
    () => ({
      captureSelection: () => null,
      restoreSelection: async () => '',
      restoreLocation: async () => false,
      navigate: async () => false,
      search: async () => [],
    }),
    [],
  );
  return (
    <View>
      <Text>EPUB reading is currently available on the web app.</Text>
    </View>
  );
});
