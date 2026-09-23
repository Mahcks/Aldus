import { useState } from 'react';
import { BookCover } from './bookshelf';
import { Pressable, Text, View } from '@/components/ui/tw';
import { resolvePressStateClass } from '@/components/ui';

/** Image-first choice. Opening it previews; applying a cover is a separate action. */
export function CoverTile({
  title,
  detail,
  imageURL,
  square,
  selected = false,
  disabled,
  onPress,
}: {
  title: string;
  detail: string;
  imageURL: string;
  square: boolean;
  selected?: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const stateClass = resolvePressStateClass({ focused, pressed });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Preview cover: ${title}, ${detail}${selected ? ', current cover' : ''}`}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={onPress}
      className={`w-[148px] gap-2 rounded-control ${stateClass} ${disabled ? 'opacity-50' : ''}`}
    >
      <View
        className={
          selected ? 'rounded-control ring-2 ring-accent ring-offset-2 ring-offset-canvas' : ''
        }
      >
        <BookCover
          title={title}
          coverURL={imageURL}
          size="small"
          coverFit="contain"
          square={square}
        />
      </View>
      <Text numberOfLines={2} className="text-sm font-sans-medium text-ink">
        {title}
      </Text>
      <Text numberOfLines={2} className="text-xs leading-4 text-muted">
        {selected ? 'Current cover' : detail}
      </Text>
    </Pressable>
  );
}
