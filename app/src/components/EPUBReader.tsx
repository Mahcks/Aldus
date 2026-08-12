import { forwardRef, useImperativeHandle } from 'react';
import { Text, View } from 'react-native';

export type RangeBoundary = { dom_path: string; node_offset: number };
export type ReaderCapture = { href: string; cfi: string; text: string; normalized_text: string; start: RangeBoundary; end: RangeBoundary };
export type EPUBReaderHandle = { captureSelection: () => ReaderCapture | null; restoreSelection: (capture: ReaderCapture) => Promise<string> };

export const EPUBReader = forwardRef<EPUBReaderHandle, { source?: string }>(function EPUBReader(_, ref) {
  useImperativeHandle(ref, () => ({ captureSelection: () => null, restoreSelection: async () => '' }), []);
  return <View><Text>The EPUB anchor tool is web-only.</Text></View>;
});
