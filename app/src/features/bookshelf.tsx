import { useState, type PropsWithChildren } from 'react';
import { colors, StatusBadge } from './ui';
import { Pressable, Text, View } from './tw';

const covers = [
  ['#74402f', '#f7ede1'],
  ['#48594b', '#f3eee2'],
  ['#665473', '#f6ecdf'],
  ['#8a6237', '#fff1dd'],
  ['#3f5960', '#f4eee3'],
] as const;

type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/** Maps the informal badge labels used across summary badges to a status tone. */
function resolveBadgeTone(label: string): StatusTone {
  if (label === 'Synced') return 'success';
  if (label === 'Read' || label === 'Listen') return 'info';
  return 'neutral';
}

function hash(value: string) {
  let result = 0;
  for (const character of value) result = (result * 31 + character.charCodeAt(0)) >>> 0;
  return result;
}

export function BookCover({
  title,
  author,
  compact,
}: {
  title: string;
  author?: string;
  compact?: boolean;
}) {
  const palette = covers[hash(title + author) % covers.length];
  const sizeClass = compact ? 'h-[252px] w-[172px]' : 'aspect-[0.68] w-full';
  const titleSizeClass = compact ? 'text-[22px] leading-7' : 'text-xl leading-6';

  return (
    <View
      accessibilityLabel={`Cover for ${title}`}
      className={`justify-center rounded-[3px] p-3 ${sizeClass}`}
      style={{
        backgroundColor: palette[0],
        shadowColor: colors.ink,
        shadowOpacity: 0.16,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 3 },
      }}
    >
      <View
        className="flex-1 items-center justify-between border px-3 py-6"
        style={{ borderColor: palette[1] }}
      >
        <Text
          numberOfLines={4}
          adjustsFontSizeToFit
          className={`text-center font-editorial font-bold ${titleSizeClass}`}
          style={{ color: palette[1] }}
        >
          {title}
        </Text>
        <View className="h-px w-7" style={{ backgroundColor: palette[1] }} />
        <Text
          numberOfLines={2}
          className="text-center font-editorial text-[11px] leading-[15px]"
          style={{ color: palette[1] }}
        >
          {author || 'Aldus Library'}
        </Text>
      </View>
    </View>
  );
}

/** Legacy plain chip. Prefer `StatusBadge` for new call sites. */
export function Badge({ children }: PropsWithChildren) {
  return (
    <View className="rounded border border-line bg-panel px-1.5 py-0.5">
      <Text className="text-[11px] font-bold text-muted">{children}</Text>
    </View>
  );
}

function resolvePressStateClass({ focused, pressed }: { focused: boolean; pressed: boolean }) {
  if (focused) return 'outline outline-2 outline-focus';
  if (pressed) return 'opacity-75';
  return '';
}

type WorkPresentationProps = {
  title: string;
  author?: string;
  badges?: string[];
  progress?: string;
  context?: string;
  narrow?: boolean;
  onPress: () => void;
};

/** Card-shaped presentation of a Work, for grids. */
export function WorkCard({
  title,
  author,
  badges = [],
  progress,
  context,
  narrow,
  onPress,
}: WorkPresentationProps) {
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);

  const handleFocus = () => setFocused(true);
  const handleBlur = () => setFocused(false);
  const handlePressIn = () => setPressed(true);
  const handlePressOut = () => setPressed(false);

  const widthClass = narrow ? 'w-[148px]' : 'w-[184px]';
  const stateClass = resolvePressStateClass({ focused, pressed });

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${title}${author ? ` by ${author}` : ''}`}
      onBlur={handleBlur}
      onFocus={handleFocus}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={onPress}
      className={`gap-1.5 rounded ${widthClass} ${stateClass}`}
    >
      <BookCover title={title} author={author} />
      <Text
        numberOfLines={2}
        className="mt-1 font-editorial text-base font-bold leading-5 text-ink"
      >
        {title}
      </Text>
      <Text numberOfLines={1} className="text-sm leading-[18px] text-muted">
        {author || 'Unknown author'}
      </Text>
      {context ? <Text className="text-[11px] font-bold text-muted">{context}</Text> : null}
      {progress ? (
        <Text numberOfLines={1} className="text-xs font-bold text-accent">
          {progress}
        </Text>
      ) : null}
      {badges.length ? (
        <View className="min-h-6 flex-row flex-wrap gap-1">
          {badges.map((badge) => (
            <StatusBadge key={badge} tone={resolveBadgeTone(badge)} label={badge} />
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

/** Alias of `WorkCard`, matching the design plan's naming. */
export const WorkTile = WorkCard;

/** Horizontal list-row presentation of a Work: thumbnail + title/author/badges/progress. */
export function WorkRow({
  title,
  author,
  badges = [],
  progress,
  context,
  onPress,
}: WorkPresentationProps) {
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);

  const handleFocus = () => setFocused(true);
  const handleBlur = () => setFocused(false);
  const handlePressIn = () => setPressed(true);
  const handlePressOut = () => setPressed(false);

  const stateClass = resolvePressStateClass({ focused, pressed });

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${title}${author ? ` by ${author}` : ''}`}
      onBlur={handleBlur}
      onFocus={handleFocus}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={onPress}
      className={`flex-row items-center gap-4 rounded border-b border-line py-3 ${stateClass}`}
    >
      <View className="w-14">
        <BookCover title={title} author={author} />
      </View>
      <View className="min-w-0 flex-1 gap-1">
        <Text numberOfLines={1} className="font-editorial text-base font-bold text-ink">
          {title}
        </Text>
        <Text numberOfLines={1} className="text-sm text-muted">
          {author || 'Unknown author'}
        </Text>
        {context ? <Text className="text-[11px] font-bold text-muted">{context}</Text> : null}
        {progress ? (
          <Text numberOfLines={1} className="text-xs font-bold text-accent">
            {progress}
          </Text>
        ) : null}
        {badges.length ? (
          <View className="flex-row flex-wrap gap-1">
            {badges.map((badge) => (
              <StatusBadge key={badge} tone={resolveBadgeTone(badge)} label={badge} />
            ))}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
