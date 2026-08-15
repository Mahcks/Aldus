import { useState, type PropsWithChildren } from 'react';
import { useWindowDimensions } from 'react-native';
import { apiBaseURL } from '../lib/api-base';
import { AppIcon, type AppIconName } from './icons';
import { Button, colors, IconButton, resolvePressStateClass } from './ui';
import { Image, Pressable, Text, View } from './tw';

const coverTones = ['bg-ink', 'bg-text-secondary', 'bg-accent-strong', 'bg-info', 'bg-success'];

export type CoverPresentation = {
  coverFit?: 'cover' | 'contain';
  coverFocalX?: number;
  coverFocalY?: number;
  generatedCoverStyle?: 'classic' | 'minimal' | 'framed';
  generatedCoverTone?: number;
  generatedCoverLayout?: 'top' | 'center' | 'bottom';
};

export function coverPresentation(work: {
  cover_fit: 'cover' | 'contain';
  cover_focal_x: number;
  cover_focal_y: number;
  generated_cover_style: 'classic' | 'minimal' | 'framed';
  generated_cover_tone: number;
  generated_cover_layout: 'top' | 'center' | 'bottom';
}): CoverPresentation {
  return {
    coverFit: work.cover_fit,
    coverFocalX: work.cover_focal_x,
    coverFocalY: work.cover_focal_y,
    generatedCoverStyle: work.generated_cover_style,
    generatedCoverTone: work.generated_cover_tone,
    generatedCoverLayout: work.generated_cover_layout,
  };
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
  size,
  coverURL,
  coverFit = 'cover',
  coverFocalX = 50,
  coverFocalY = 50,
  generatedCoverStyle = 'classic',
  generatedCoverTone = -1,
  generatedCoverLayout = 'center',
}: {
  title: string;
  author?: string;
  compact?: boolean;
  size?: 'mini' | 'small' | 'tile' | 'continue' | 'hero';
  coverURL?: string;
} & CoverPresentation) {
  const [failedURL, setFailedURL] = useState('');
  const showImage = Boolean(coverURL && failedURL !== coverURL);
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
  const coverTone =
    coverTones[
      generatedCoverTone >= 0 ? generatedCoverTone : hash(title + author) % coverTones.length
    ];
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

  const layoutClass = {
    top: 'justify-start',
    center: 'justify-center',
    bottom: 'justify-end',
  }[generatedCoverLayout];
  const frameClass = generatedCoverStyle === 'minimal' ? '' : 'border border-paper/60';

  return (
    <View
      accessibilityLabel={`Cover for ${title}`}
      className={`relative shrink-0 overflow-hidden rounded-control shadow-card ${outerPaddingClass} ${coverTone} ${sizeClass}`}
    >
      {showImage ? (
        <Image
          source={{ uri: coverURL?.startsWith('/') ? `${apiBaseURL}${coverURL}` : coverURL }}
          resizeMode={coverFit}
          style={{ objectPosition: `${coverFocalX}% ${coverFocalY}%` } as never}
          accessibilityIgnoresInvertColors
          className="absolute inset-0 h-full w-full bg-panel"
          onError={() => setFailedURL(coverURL || '')}
        />
      ) : null}
      {showImage ? null : (
        <>
          {generatedCoverStyle === 'classic' ? (
            <View className="absolute bottom-0 left-0 top-0 w-1 bg-paper/20" />
          ) : null}
          <View
            className={`flex-1 items-center gap-5 ${layoutClass} ${frameClass} ${innerPaddingClass}`}
          >
            {resolvedSize !== 'mini' && generatedCoverStyle !== 'minimal' ? (
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
        </>
      )}
    </View>
  );
}

/** Legacy plain chip. Prefer `StatusBadge` for new call sites. */
export function Badge({ children }: PropsWithChildren) {
  return (
    <View className="rounded-control border border-line bg-panel px-1.5 py-0.5">
      <Text className="text-[11px] font-bold text-muted">{children}</Text>
    </View>
  );
}

type WorkPresentationProps = {
  title: string;
  author?: string;
  coverURL?: string;
  coverPresentation?: CoverPresentation;
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
  coverURL,
  coverPresentation,
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
      accessibilityLabel={`${title}${author ? ` by ${author}` : ''}${progress ? `. ${progress}` : ''}`}
      onBlur={handleBlur}
      onFocus={handleFocus}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={onPress}
      className={`gap-1.5 rounded-control ${widthClass} ${stateClass}`}
    >
      <View className="relative">
        <BookCover
          title={title}
          author={author}
          coverURL={coverURL}
          {...coverPresentation}
          size={narrow ? 'small' : 'tile'}
        />
        {progress ? (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            className="absolute left-2 top-2 max-w-[85%] rounded-pill bg-accent px-2 py-1 shadow-xs"
          >
            <Text numberOfLines={1} className="text-[10px] font-bold text-on-accent">
              {progress}
            </Text>
          </View>
        ) : null}
      </View>
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
  coverURL,
  coverPresentation,
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
  const progressBorderClass = progress ? 'border-l-2 border-l-accent pl-3' : 'pl-3.5';

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${title}${author ? ` by ${author}` : ''}${progress ? `. ${progress}` : ''}`}
      onBlur={handleBlur}
      onFocus={handleFocus}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={onPress}
      className={`flex-row items-center gap-4 rounded-control border-b border-line py-3 ${progressBorderClass} ${stateClass}`}
    >
      <View className="w-14">
        <BookCover
          title={title}
          author={author}
          coverURL={coverURL}
          size="mini"
          {...coverPresentation}
        />
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

/**
 * Synchronized only ever occurs when both an EPUB and audio edition are
 * available (a ready alignment requires both), so a synced Work collapses to
 * one "Read & Listen" chip instead of three chips repeating the same fact.
 */
export function AvailabilityIcons({ value }: { value: WorkAvailability }) {
  const items: { enabled: boolean; icon: AppIconName; label: string; short: string }[] =
    value.synchronized
      ? [
          {
            enabled: true,
            icon: 'synced',
            label: 'Read and Listen, synchronized',
            short: 'Read & Listen',
          },
        ]
      : [
          { enabled: value.readable, icon: 'read', label: 'Readable', short: 'Read' },
          { enabled: value.listenable, icon: 'listen', label: 'Listenable', short: 'Listen' },
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
  coverURL,
  coverPresentation,
  context,
  availability,
  progress,
  continueMode,
  onOpen,
  onContinue,
  onRead,
  onListen,
}: {
  title: string;
  author?: string;
  coverURL?: string;
  coverPresentation?: CoverPresentation;
  context?: string;
  availability: WorkAvailability;
  progress?: string;
  continueMode: 'read' | 'listen';
  onOpen: () => void;
  onContinue: () => void;
  onRead?: () => void;
  onListen?: () => void;
}) {
  const compact = useWindowDimensions().width < 600;
  const [coverFocused, setCoverFocused] = useState(false);
  const [coverPressed, setCoverPressed] = useState(false);
  const [titleFocused, setTitleFocused] = useState(false);
  const [titlePressed, setTitlePressed] = useState(false);
  const coverStateClass = resolvePressStateClass({ focused: coverFocused, pressed: coverPressed });
  const titleStateClass = resolvePressStateClass({ focused: titleFocused, pressed: titlePressed });

  return (
    <View className="w-[336px] max-w-full flex-row gap-3.5 rounded-card bg-paper p-3.5 shadow-sm">
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${title}${author ? ` by ${author}` : ''}`}
        onBlur={() => setCoverFocused(false)}
        onFocus={() => setCoverFocused(true)}
        onPressIn={() => setCoverPressed(true)}
        onPressOut={() => setCoverPressed(false)}
        onPress={onOpen}
        className={`shrink-0 rounded-control ${coverStateClass}`}
      >
        <BookCover
          title={title}
          author={author}
          coverURL={coverURL}
          size="continue"
          {...coverPresentation}
        />
      </Pressable>
      <View className="min-w-0 flex-1 justify-between gap-2 py-0.5">
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Open ${title}`}
          onBlur={() => setTitleFocused(false)}
          onFocus={() => setTitleFocused(true)}
          onPressIn={() => setTitlePressed(true)}
          onPressOut={() => setTitlePressed(false)}
          onPress={onOpen}
          className={`rounded-control ${titleStateClass}`}
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
          {progress ? (
            <Text numberOfLines={1} className="mt-1 text-xs font-bold text-accent">
              {progress}
            </Text>
          ) : null}
        </Pressable>
        <View className="gap-2">
          <AvailabilityIcons value={availability} />
          <View className="flex-row flex-wrap items-center gap-2">
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
