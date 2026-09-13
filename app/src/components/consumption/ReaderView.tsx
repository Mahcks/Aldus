import type { Alignment, Work } from '@/generated/api';
import { ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  EPUBReader,
  type EPUBReaderHandle,
  type ReaderLocation,
  type ReaderNavigationItem,
  type ReaderPreferences,
} from './reader/EPUBReader';
import { BookCover, coverPresentation } from '@/components/catalog/bookshelf';
import { type MediaChoice } from '@/lib/consumption/consumption';
import { Button, colors, EmptyState } from '@/components/ui';
import { Text, View } from '@/components/ui/tw';

// Keep the web publication mounted during handoff; native releases it while listening.
type ReaderViewProps = {
  mode: 'read' | 'listen';
  selectedEPUB: MediaChoice | undefined;
  epubSource: string | Blob | undefined;
  readerInteractionReady: boolean;
  compactNative: boolean;
  reader: React.RefObject<EPUBReaderHandle | null>;
  alignment: Alignment | undefined;
  readerPreferences: ReaderPreferences;
  canListenFromReader: boolean;
  progressStatus: string;
  alignmentID: string | undefined;
  compactPageSyncLabel: string;
  syncAvailable: boolean;
  syncLabel: string;
  onReaderLocation: (location: ReaderLocation) => void;
  switchToListen: (location?: ReaderLocation) => Promise<void>;
  onReaderReady: (contents: ReaderNavigationItem[]) => void;
  setReaderRestoreError: (failed: boolean) => void;
  setNotice: (message: string) => void;
  readerHelper: string;
  mediaLoading: boolean;
  work: Work;
  readerRestoreError: boolean;
  readerTarget: unknown;
  canRetryRestore: boolean;
  restoreReader: (target: unknown) => Promise<void>;
  leaveReader: () => Promise<void>;
};

export function ReaderView({
  mode,
  selectedEPUB,
  epubSource,
  readerInteractionReady,
  compactNative,
  reader,
  alignment,
  readerPreferences,
  canListenFromReader,
  progressStatus,
  alignmentID,
  compactPageSyncLabel,
  syncAvailable,
  syncLabel,
  onReaderLocation,
  switchToListen,
  onReaderReady,
  setReaderRestoreError,
  setNotice,
  readerHelper,
  mediaLoading,
  work,
  readerRestoreError,
  readerTarget,
  canRetryRestore,
  restoreReader,
  leaveReader,
}: ReaderViewProps) {
  return (
    <View className={mode === 'read' ? 'min-h-0 flex-1' : 'hidden'}>
      {(Platform.OS === 'web' || mode === 'read') && selectedEPUB && epubSource ? (
        <View
          pointerEvents={readerInteractionReady ? 'auto' : 'none'}
          accessibilityElementsHidden={!readerInteractionReady}
          importantForAccessibility={readerInteractionReady ? 'auto' : 'no-hide-descendants'}
          aria-hidden={!readerInteractionReady}
          {...(Platform.OS === 'web' ? { inert: !readerInteractionReady } : {})}
          className={
            compactNative
              ? 'min-h-0 w-full flex-1'
              : 'min-h-0 w-full max-w-[1100px] flex-1 self-center px-4 pt-2.5'
          }
        >
          <EPUBReader
            ref={reader}
            source={epubSource}
            product
            segments={alignment?.segments}
            preferences={readerPreferences}
            compactChrome={compactNative}
            statusLabel={
              compactNative
                ? canListenFromReader
                  ? [progressStatus, 'Select text to listen from there'].filter(Boolean).join(' · ')
                  : progressStatus ||
                    (alignmentID
                      ? compactPageSyncLabel
                      : syncAvailable
                        ? 'Synchronized'
                        : syncLabel)
                : undefined
            }
            onLocation={onReaderLocation}
            onListenFromLocation={(location) => void switchToListen(location)}
            onReady={onReaderReady}
            onError={(error) => {
              setReaderRestoreError(true);
              setNotice(error.message || 'Unable to open EPUB.');
            }}
          />
          {!compactNative ? (
            <SafeAreaView edges={['bottom']}>
              <View className="min-h-[62px] w-full shrink-0 flex-row items-center justify-between gap-3 border-t border-line py-2.5">
                <Text className="flex-1 text-[13px] leading-[19px] text-muted">{readerHelper}</Text>
                <Button
                  label={canListenFromReader ? 'Listen from here' : 'Listen unavailable here'}
                  icon="listen"
                  disabled={!canListenFromReader || !readerInteractionReady}
                  onPress={() => void switchToListen()}
                />
              </View>
            </SafeAreaView>
          ) : null}
        </View>
      ) : (
        <View className="flex-1 items-center justify-center p-8">
          {mediaLoading ? (
            <View accessibilityLiveRegion="polite" className="items-center gap-3">
              <ActivityIndicator color={colors.accent} />
              <Text className="text-sm text-muted">Preparing ebook…</Text>
            </View>
          ) : (
            <EmptyState
              icon="read"
              title={selectedEPUB ? 'Couldn’t open this ebook' : 'No EPUB available'}
            >
              {selectedEPUB
                ? 'Try opening it again.'
                : 'This Work doesn’t have a readable edition yet.'}
            </EmptyState>
          )}
        </View>
      )}
      {!readerInteractionReady && (mediaLoading || Boolean(epubSource)) ? (
        <View
          accessibilityLiveRegion="polite"
          className="absolute inset-0 items-center justify-center gap-5 bg-canvas px-6"
        >
          <BookCover
            title={work.title}
            author={work.author}
            coverURL={
              work.ebook_cover_url ||
              (selectedEPUB ? `/api/media/${selectedEPUB.id}/cover` : work.cover_url)
            }
            fallbackCoverURL={work.cover_url}
            size="hero"
            {...coverPresentation(work)}
            coverFit="cover"
          />
          {readerRestoreError ? (
            <View className="w-full max-w-sm items-center gap-3">
              <Text className="text-center text-sm text-ink">
                Couldn’t restore your saved page. Your reading position hasn’t changed.
              </Text>
              {readerTarget && canRetryRestore ? (
                <Button
                  label="Retry opening book"
                  onPress={() => void restoreReader(readerTarget)}
                />
              ) : (
                <Button label="Back to book" onPress={() => void leaveReader()} />
              )}
            </View>
          ) : (
            <View className="items-center gap-3">
              <ActivityIndicator color={colors.accent} />
              <Text className="text-sm text-muted">
                {readerTarget ? 'Returning to your saved page…' : 'Opening your book…'}
              </Text>
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
}
