import { forwardRef, useImperativeHandle } from 'react';
import { Text, View } from 'react-native';

export type RangeBoundary = { dom_path: string; node_offset: number };
export type ReaderCapture = { href: string; cfi: string; text: string; normalized_text: string; start: RangeBoundary; end: RangeBoundary };
export type ReaderLocation = { href: string; cfi: string; sync?: { href: string; locator: { type: 'dom-element'; dom_path: string; segment_id: string }; offset: number }; syncState?: 'full' | 'partial' | 'none'; reason?: 'relocate' | 'forward' | 'explicit' | 'restore' };
export type EPUBReaderHandle = { captureSelection: () => ReaderCapture | null; restoreSelection: (capture: ReaderCapture) => Promise<string>; restoreLocation: (location: unknown, highlight?: boolean) => Promise<boolean> };

export const EPUBReader = forwardRef<EPUBReaderHandle, { source?: string | Blob; product?: boolean; segments?: unknown[]; onLocation?: (location: ReaderLocation) => void; onReady?: () => void }>(function EPUBReader(_, ref) {
  useImperativeHandle(ref, () => ({ captureSelection: () => null, restoreSelection: async () => '', restoreLocation: async () => false }), []);
  return <View><Text>EPUB reading is currently available on the web app.</Text></View>;
});
