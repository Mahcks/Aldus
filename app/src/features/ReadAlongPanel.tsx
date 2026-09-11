import { useEffect, useRef } from 'react';
import { ScrollView as NativeScrollView } from 'react-native';
import type { audioPassage } from './consumption';
import { ScrollView, Text, View } from './tw';

/** A view of the playing passage, never a navigation or progress writer. */
export function ReadAlongPanel({
  passage,
  playing,
  scrollEnabled = true,
}: {
  passage: NonNullable<ReturnType<typeof audioPassage>>;
  playing: boolean;
  scrollEnabled?: boolean;
}) {
  const scroll = useRef<NativeScrollView>(null);
  let label = 'Read along';
  if (passage.active) label = playing ? 'Following the narration' : 'Paused here';

  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [passage.current.id]);

  return (
    <View className="mt-5 min-h-[220px] w-full flex-1 gap-3 border-t border-line pt-5">
      <Text className="text-sm font-sans-semibold text-accent">{label}</Text>
      <ScrollView
        ref={scroll}
        scrollEnabled={scrollEnabled}
        bounces={false}
        alwaysBounceVertical={false}
        accessibilityLabel="Read along text"
        className="min-h-[160px] w-full flex-1"
        contentContainerClassName="gap-6 pb-5 pr-3"
      >
        <Text selectable className="font-reading text-[24px] leading-[36px] text-ink">
          {passage.current.text.replace(/\s+/g, ' ').trim()}
        </Text>
        {passage.next ? (
          <Text selectable className="font-reading text-xl leading-8 text-muted">
            {passage.next.text.replace(/\s+/g, ' ').trim()}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}
