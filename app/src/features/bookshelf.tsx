import { useState, type PropsWithChildren } from 'react';
import { useWindowDimensions } from 'react-native';
import { AppIcon, type AppIconName } from './icons';
import { Button, colors, IconButton } from './ui';
import { Pressable, Text, View } from './tw';

const coverTones = ['bg-ink', 'bg-text-secondary', 'bg-accent-strong', 'bg-info', 'bg-success'];

function hash(value: string) {
  let result = 0;
  for (const character of value) result = (result * 31 + character.charCodeAt(0)) >>> 0;
  return result;
}

export function BookCover({
  title,
  author,
  compact,
  size,
}: {
  title: string;
  author?: string;
  compact?: boolean;
  size?: 'mini' | 'small' | 'tile' | 'continue' | 'hero';
}) {
  const resolvedSize = size ?? (compact ? 'hero' : 'tile');
  const sizeClass = {
    mini: 'h-20 w-14',
    small: 'h-[218px] w-[148px]',
    tile: 'h-[270px] w-[184px]',
    continue: 'h-[156px] w-[106px]',
    hero: 'h-[300px] w-[204px]',
  }[resolvedSize];
  const titleSizeClass =
    resolvedSize === 'hero'
      ? 'text-2xl leading-7'
      : resolvedSize === 'mini'
        ? 'text-[10px] leading-3'
        : resolvedSize === 'continue'
          ? 'text-base leading-5'
          : 'text-xl leading-6';
  const coverTone = coverTones[hash(title + author) % coverTones.length];
  const outerPaddingClass = resolvedSize === 'mini' ? 'p-1' : 'p-3';
  const innerPaddingClass = resolvedSize === 'mini' ? 'px-1 py-2' : 'px-3 py-5';
  const coverTitle =
    resolvedSize === 'mini'
      ? title
          .split(/\s+/)
          .slice(0, 2)
          .map((word) => word[0])
          .join('')
          .toUpperCase()
      : title;

  return (
    <View
      accessibilityLabel={`Cover for ${title}`}
      className={`relative shrink-0 overflow-hidden rounded-[3px] shadow-card ${outerPaddingClass} ${coverTone} ${sizeClass}`}
      style={{
        shadowColor: colors.ink,
        shadowOpacity: 0.16,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 3 },
      }}
    >
      <View className="absolute bottom-0 left-0 top-0 w-1 bg-paper/20" />
      <View
        className={`flex-1 items-center justify-between border border-paper/60 ${innerPaddingClass}`}
      >
        {resolvedSize !== 'mini' ? (
          <Text className="text-center text-[9px] font-bold uppercase tracking-[2px] text-paper/70">
            Aldus edition
          </Text>
        ) : (
          <View />
        )}
        <Text
          numberOfLines={3}
          className={`text-center font-editorial font-bold text-paper ${titleSizeClass}`}
        >
          {coverTitle}
        </Text>
        <View className="items-center gap-2">
          <View className="h-px w-7 bg-paper/70" />
          {resolvedSize !== 'mini' ? (
            <Text
              numberOfLines={1}
              className="text-center font-editorial text-[11px] text-paper/80"
            >
              {author || 'Aldus Library'}
            </Text>
          ) : null}
        </View>
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
  availability?: WorkAvailability;
  progress?: string;
  context?: string;
  narrow?: boolean;
  onPress: () => void;
};

/** Card-shaped presentation of a Work, for grids. */
export function WorkCard({
  title,
  author,
  availability,
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
      <BookCover title={title} author={author} size={narrow ? 'small' : 'tile'} />
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
      {availability ? <AvailabilityIcons value={availability} /> : null}
    </Pressable>
  );
}

/** Alias of `WorkCard`, matching the design plan's naming. */
export const WorkTile = WorkCard;

/** Horizontal list-row presentation of a Work: thumbnail + title/author/badges/progress. */
export function WorkRow({
  title,
  author,
  availability,
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
        <BookCover title={title} author={author} size="mini" />
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
        {availability ? <AvailabilityIcons value={availability} /> : null}
      </View>
    </Pressable>
  );
}

export type WorkAvailability = { readable: boolean; listenable: boolean; synchronized: boolean };

export function AvailabilityIcons({ value }: { value: WorkAvailability }) {
  const items: { enabled: boolean; icon: AppIconName; label: string; short: string }[] = [
    { enabled: value.readable, icon: 'read', label: 'Readable', short: 'Read' },
    { enabled: value.listenable, icon: 'listen', label: 'Listenable', short: 'Listen' },
    {
      enabled: value.synchronized,
      icon: 'synced',
      label: 'Read and Listen synchronized',
      short: 'Synced',
    },
  ];
  const available = items.filter((item) => item.enabled);
  return (
    <View
      accessibilityLabel={available.map((item) => item.label).join(', ')}
      className="min-h-6 flex-row flex-wrap items-center gap-x-3 gap-y-1"
    >
      {available.map((item) => (
        <View key={item.label} className="flex-row items-center gap-1">
          <AppIcon name={item.icon} size={15} color={colors.muted} />
          <Text className="text-[11px] font-semibold text-muted">{item.short}</Text>
        </View>
      ))}
    </View>
  );
}

export function ContinueCard({
  title,
  author,
  context,
  availability,
  continueMode,
  onOpen,
  onContinue,
  onRead,
  onListen,
}: {
  title: string;
  author?: string;
  context?: string;
  availability: WorkAvailability;
  continueMode: 'read' | 'listen';
  onOpen: () => void;
  onContinue: () => void;
  onRead?: () => void;
  onListen?: () => void;
}) {
  const compact = useWindowDimensions().width < 600;

  return (
    <View className="w-[420px] max-w-full flex-row gap-4 rounded-card bg-paper p-4 shadow-sm">
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${title}${author ? ` by ${author}` : ''}`}
        onPress={onOpen}
        className="shrink-0 rounded focus:outline focus:outline-2 focus:outline-focus"
      >
        <BookCover title={title} author={author} size="continue" />
      </Pressable>
      <View className="min-w-0 flex-1 justify-between gap-2">
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Open ${title}`}
          onPress={onOpen}
          className="rounded focus:outline focus:outline-2 focus:outline-focus"
        >
          <Text numberOfLines={2} className="font-editorial text-base font-bold leading-5 text-ink">
            {title}
          </Text>
          <Text numberOfLines={1} className="mt-0.5 text-sm text-muted">
            {author || 'Unknown author'}
          </Text>
          {context ? (
            <Text numberOfLines={1} className="mt-1 text-[11px] font-semibold text-subtle">
              {context}
            </Text>
          ) : null}
        </Pressable>
        <View className="gap-2">
          <AvailabilityIcons value={availability} />
          <View className="flex-row items-center gap-2">
            <View className="flex-1">
              <Button
                label={
                  compact
                    ? 'Continue'
                    : `Continue ${continueMode === 'read' ? 'reading' : 'listening'}`
                }
                icon={continueMode === 'read' ? 'read' : 'listen'}
                kind="primary"
                onPress={onContinue}
              />
            </View>
            {availability.readable && continueMode !== 'read' && onRead ? (
              <IconButton icon="read" label="Read this work" kind="quiet" onPress={onRead} />
            ) : null}
            {availability.listenable && continueMode !== 'listen' && onListen ? (
              <IconButton
                icon="listen"
                label="Listen to this work"
                kind="quiet"
                onPress={onListen}
              />
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}
