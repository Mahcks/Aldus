import { useRef, useState, type ReactNode } from 'react';
import { useWindowDimensions, type FlatList as NativeFlatList } from 'react-native';
import type { WorkSummary } from '@/generated/api';
import { WorkCard, WorkRow, coverPresentation } from '@/features/bookshelf';
import { FlatList, View } from '@/features/tw';
import { workResumeMode } from './work-resume';
import { workProgressLabel } from './consumption';
import { workHref, type WorkQuickAction } from './work-actions';
import { libraryColumns, type LibraryDensity } from './library-layout';

export function LibraryGrid({
  works,
  density,
  listView = false,
  header,
  footer,
  onEndReached,
  onOpen,
  actions,
  onBeforeOpen,
  initialOffset = 0,
  onScrollOffset,
}: {
  works: WorkSummary[];
  density: LibraryDensity;
  listView?: boolean;
  header: ReactNode;
  footer: ReactNode;
  onEndReached: () => void;
  onOpen: (work: WorkSummary) => void;
  /** Builds the press-and-hold quick-action menu for a card; omit to disable it. */
  actions?: (work: WorkSummary) => WorkQuickAction[];
  /** Pure side effect run before a card opens, by tap or by quick action — Library uses it to save scroll/filter state for Back. */
  onBeforeOpen?: () => void;
  initialOffset?: number;
  onScrollOffset: (offset: number) => void;
}) {
  const { width, fontScale } = useWindowDimensions();
  const columns = listView ? 1 : libraryColumns(width, density);
  const [headerHeight, setHeaderHeight] = useState(0);
  const available = Math.min(width - (width >= 820 ? 224 : 0), 1240) - 32;
  // 98 = WorkCard's caption stack below the cover: mt-1 (4) + two gap-1.5
  // gaps (12) + a 2-line title at leading-5 (40) + a 1-line author at 18px
  // (18) + the cell wrapper's pb-6 (24). Any looser and every row carries
  // dead space under the caption, not just the shelf-aligned ones.
  const rowHeight = ((available / columns - 12) * 218) / 148 + 98 * fontScale;
  const list = useRef<NativeFlatList<WorkSummary>>(null);
  const restored = useRef(false);
  return (
    <FlatList
      ref={list}
      key={columns}
      role="main"
      className="flex-1"
      contentContainerClassName="w-full max-w-[1240px] self-center px-4 pb-6 pt-3"
      data={works}
      numColumns={columns}
      keyExtractor={(work) => work.id}
      ListHeaderComponent={
        <View onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}>{header}</View>
      }
      ListFooterComponent={<>{footer}</>}
      renderItem={({ item, index }) =>
        listView ? (
          <WorkRow
            separator={index > 0}
            title={item.title}
            author={item.author}
            coverURL={
              (workResumeMode(item) === 'listen'
                ? item.audiobook_cover_url
                : item.ebook_cover_url) || item.cover_url
            }
            fallbackCoverURL={item.cover_url}
            audioArtwork={workResumeMode(item) === 'listen'}
            coverPresentation={coverPresentation(item)}
            progress={workProgressLabel(item.in_progress, item.completion_percent)}
            availability={{
              readable: workResumeMode(item) === 'read',
              listenable: workResumeMode(item) === 'listen',
              synchronized: false,
            }}
            onPress={() => onOpen(item)}
          />
        ) : (
          <View
            style={{ width: `${100 / columns}%`, height: rowHeight }}
            className="justify-end px-1.5 pb-6"
          >
            <WorkCard
              title={item.title}
              author={item.author}
              coverURL={item.cover_url}
              audioArtwork={!item.readable && item.listenable}
              shelfAligned
              uniformTitleHeight
              coverPresentation={coverPresentation(item)}
              availability={item}
              progress={workProgressLabel(item.in_progress, item.completion_percent)}
              narrow
              dense={density === 'compact'}
              href={workHref(item)}
              actions={actions?.(item)}
              onBeforeOpen={onBeforeOpen}
              onPress={() => onOpen(item)}
            />
          </View>
        )
      }
      getItemLayout={
        listView
          ? undefined
          : (_, index) => ({
              length: rowHeight,
              offset: headerHeight + index * rowHeight,
              index,
            })
      }
      initialNumToRender={12}
      maxToRenderPerBatch={12}
      windowSize={5}
      onEndReachedThreshold={0.5}
      onEndReached={onEndReached}
      onScroll={(event) => {
        const offset = event.nativeEvent.contentOffset.y;
        if (Math.abs(offset - initialOffset) < 2) restored.current = true;
        onScrollOffset(offset);
      }}
      scrollEventThrottle={100}
      onContentSizeChange={() => {
        if (!restored.current && initialOffset > 0 && works.length) {
          list.current?.scrollToOffset({ offset: initialOffset, animated: false });
        }
      }}
    />
  );
}
