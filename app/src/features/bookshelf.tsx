import { Image as ExpoImage } from 'expo-image';
import { useState, type PropsWithChildren, type ReactNode } from 'react';
import { apiBaseURL } from '../lib/api-base';
import { AppIcon, type AppIconName } from './icons';
import { colors, resolvePressStateClass } from './ui';
import { Pressable, Text, View } from './tw';

const coverTones = ['bg-ink', 'bg-text-secondary', 'bg-accent-strong', 'bg-info', 'bg-success'];
/**
 * Hex twin of `coverTones`, same order — the cover image itself is rendered
 * by `expo-image` (see below), which takes a real color for its background
 * rather than a className, so the letterboxed strips around a `contain`-fit
 * cover still pick up the generated tone instead of falling back to white.
 */
const coverToneHex = [colors.ink, '#4a4038', colors.accentStrong, colors.info, colors.success];

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
  const coverToneIndex =
    generatedCoverTone >= 0 ? generatedCoverTone : hash(title + author) % coverTones.length;
  const coverTone = coverTones[coverToneIndex];
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
        <ExpoImage
          source={{ uri: coverURL?.startsWith('/') ? `${apiBaseURL}${coverURL}` : coverURL }}
          contentFit={coverFit}
          contentPosition={{ left: `${coverFocalX}%`, top: `${coverFocalY}%` }}
          accessibilityIgnoresInvertColors
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: coverFit === 'contain' ? coverToneHex[coverToneIndex] : colors.panel,
          }}
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
              <Text className="text-center text-[9px] font-sans-bold uppercase tracking-[2px] text-paper/70">
                Aldus edition
              </Text>
            ) : (
              <View />
            )}
            <Text
              numberOfLines={3}
              className={`text-center font-editorial-bold text-paper ${titleSizeClass}`}
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
      <Text className="text-[11px] font-sans-bold text-muted">{children}</Text>
    </View>
  );
}

/**
 * Compact card for a Library in a collection grid — Home, Libraries, and
 * Account all list "the libraries I belong to". A fixed human-scaled card
 * (matching `WorkCard`'s footprint) reads as one intentional grid unit even
 * when there's only one library, unlike a full-width list row stretched
 * across the page with nothing beside it.
 */
export function LibraryCard({
  name,
  role,
  onPress,
}: {
  name: string;
  role?: string;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const stateClass = resolvePressStateClass({ focused, pressed });

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={name}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={onPress}
      className={`w-[228px] max-w-full flex-row items-center gap-3 rounded-card border border-line bg-paper p-4 shadow-card ${stateClass}`}
    >
      <View className="h-11 w-11 items-center justify-center rounded-full bg-accent-soft">
        <AppIcon name="libraries" size={20} color={colors.accent} />
      </View>
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="font-editorial-bold text-base text-ink">
          {name}
        </Text>
        <Text numberOfLines={1} className="mt-0.5 text-xs font-sans-semibold text-subtle">
          {role || 'Administrator access'}
        </Text>
      </View>
      <AppIcon name="chevron" size={16} color={colors.subtle} />
    </Pressable>
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
            <Text numberOfLines={1} className="text-[10px] font-sans-bold text-on-accent">
              {progress}
            </Text>
          </View>
        ) : null}
      </View>
      <Text
        numberOfLines={2}
        className="mt-1 font-editorial-bold text-base leading-5 text-ink"
      >
        {title}
      </Text>
      <Text numberOfLines={1} className="text-sm leading-[18px] text-muted">
        {author || 'Unknown author'}
      </Text>
      {context ? <Text className="text-[11px] font-sans-bold text-muted">{context}</Text> : null}
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
  action,
}: WorkPresentationProps & { action?: ReactNode }) {
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);

  const handleFocus = () => setFocused(true);
  const handleBlur = () => setFocused(false);
  const handlePressIn = () => setPressed(true);
  const handlePressOut = () => setPressed(false);

  const stateClass = resolvePressStateClass({ focused, pressed });
  const progressBorderClass = progress ? 'border-l-2 border-l-accent pl-3' : 'pl-3.5';

  return (
    <View className="flex-row items-center gap-2 border-b border-line">
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${title}${author ? ` by ${author}` : ''}${progress ? `. ${progress}` : ''}`}
        onBlur={handleBlur}
        onFocus={handleFocus}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={onPress}
        className={`min-w-0 flex-1 flex-row items-center gap-4 rounded-control py-3 ${progressBorderClass} ${stateClass}`}
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
          <Text numberOfLines={1} className="font-editorial-bold text-base text-ink">
            {title}
          </Text>
          <Text numberOfLines={1} className="text-sm text-muted">
            {author || 'Unknown author'}
          </Text>
          {context ? <Text className="text-[11px] font-sans-bold text-muted">{context}</Text> : null}
          {progress ? (
            <Text numberOfLines={1} className="text-xs font-sans-bold text-accent">
              {progress}
            </Text>
          ) : null}
          {availability ? <AvailabilityIcons value={availability} /> : null}
        </View>
      </Pressable>
      {action}
    </View>
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
          <Text className="text-[11px] font-sans-semibold text-muted">{item.short}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * A shelf tile, not a detail card: covers line up side by side like books
 * standing on a shelf, so the primary "pick up where I left off" action is
 * a single tap on the cover itself (the ribbon names it) rather than a
 * full-width button competing with title/author/context text underneath.
 * Switching read/listen mid-book is a detail-page action now — this tile
 * only shows what's needed to recognize the book and resume it.
 */
export function ContinueCard({
  title,
  author,
  coverURL,
  coverPresentation,
  progress,
  continueMode,
  onOpen,
  onContinue,
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
  const [coverFocused, setCoverFocused] = useState(false);
  const [coverPressed, setCoverPressed] = useState(false);
  const [titleFocused, setTitleFocused] = useState(false);
  const [titlePressed, setTitlePressed] = useState(false);
  const coverStateClass = resolvePressStateClass({ focused: coverFocused, pressed: coverPressed });
  const titleStateClass = resolvePressStateClass({ focused: titleFocused, pressed: titlePressed });

  return (
    <View className="w-[106px] gap-1.5">
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Continue ${continueMode === 'read' ? 'reading' : 'listening to'} ${title}`}
        onBlur={() => setCoverFocused(false)}
        onFocus={() => setCoverFocused(true)}
        onPressIn={() => setCoverPressed(true)}
        onPressOut={() => setCoverPressed(false)}
        onPress={onContinue}
        className={`relative rounded-control ${coverStateClass}`}
      >
        <BookCover
          title={title}
          author={author}
          coverURL={coverURL}
          size="continue"
          {...coverPresentation}
        />
        {progress ? (
          <View className="absolute left-1.5 top-1.5 max-w-[85%] rounded-pill bg-ink/80 px-1.5 py-0.5 shadow-xs">
            <Text numberOfLines={1} className="text-[10px] font-sans-bold text-paper">
              {progress}
            </Text>
          </View>
        ) : null}
        <View className="absolute inset-x-0 bottom-0 flex-row items-center justify-center gap-1 rounded-b-control bg-accent/95 py-1.5">
          <AppIcon
            name={continueMode === 'read' ? 'read' : 'listen'}
            size={12}
            color={colors.onAccent}
          />
          <Text className="text-[10px] font-sans-bold uppercase tracking-wide text-on-accent">
            Continue
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Open ${title}`}
        onBlur={() => setTitleFocused(false)}
        onFocus={() => setTitleFocused(true)}
        onPressIn={() => setTitlePressed(true)}
        onPressOut={() => setTitlePressed(false)}
        onPress={onOpen}
        className={`gap-0.5 rounded-control px-0.5 ${titleStateClass}`}
      >
        <Text
          numberOfLines={2}
          className="min-h-[32px] font-editorial-bold text-sm leading-4 text-ink"
        >
          {title}
        </Text>
        <Text numberOfLines={1} className="text-[11px] text-muted">
          {author || 'Unknown author'}
        </Text>
      </Pressable>
    </View>
  );
}
