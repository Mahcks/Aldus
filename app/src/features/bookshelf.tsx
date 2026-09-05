import { Link, type Href } from 'expo-router';
import { Platform } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useState, type PropsWithChildren, type ReactNode } from 'react';
import { apiBaseURL } from '@/lib/api-base';
import { AppIcon, type AppIconName } from './icons';
import { Button, Dialog, IconButton, colors, resolvePressStateClass } from './ui';
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

/**
 * Cover records are stored at Open Library's "-L" size (large, often 500px+
 * on the long edge) regardless of where they render. Squeezed straight into
 * a ~150-300px card, that oversized source causes visible moire/aliasing on
 * detailed cover art. "-M" is close to our largest card (hero, 204px wide)
 * and sharper at our sizes without a size-specific request per card.
 */
function resolveCoverSrc(url: string) {
  return url.replace(/(covers\.openlibrary\.org\/b\/id\/\d+)-L\.jpg/, '$1-M.jpg');
}

/**
 * Generated covers show one clean title, not the catalog's full title —
 * classic-lit subtitles ("; or, the Modern Prometheus") read fine in the
 * caption below the cover but mid-word-truncate badly at cover scale. Real
 * covers drop the subtitle on the face and keep it on the spine; this does
 * the same, only when there's a subtitle to drop and it actually shortens
 * things.
 */
function coverDisplayTitle(title: string) {
  const main = title.split(/\s*[:;]\s+/)[0]?.trim();
  return main && main.length >= 3 && main.length < title.length ? main : title;
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
  size?: 'mini' | 'small' | 'grid' | 'tile' | 'continue' | 'hero';
  coverURL?: string;
} & CoverPresentation) {
  const [failedURL, setFailedURL] = useState('');
  const showImage = Boolean(coverURL && failedURL !== coverURL);
  const resolvedSize = size ?? (compact ? 'hero' : 'tile');
  const sizeClass = {
    mini: 'h-20 w-14',
    small: 'h-[218px] w-[148px]',
    grid: 'w-full',
    tile: 'h-[270px] w-[184px]',
    continue: 'h-[156px] w-[106px]',
    hero: 'h-[300px] w-[204px]',
  }[resolvedSize];
  const coverToneIndex =
    generatedCoverTone >= 0 ? generatedCoverTone : hash(title + author) % coverTones.length;
  const coverTone = coverTones[coverToneIndex];
  const outerPaddingClass = resolvedSize === 'mini' ? 'p-1' : 'p-3';
  const innerPaddingClass = resolvedSize === 'mini' ? 'px-1 py-2' : 'px-3 py-5';
  const displayTitle = coverDisplayTitle(title);
  /**
   * Threshold and type scale both track the cover's own width — a "small"
   * cover (148px) has meaningfully less line width than "tile" (184px), so
   * sharing one long-title cutoff between them left small covers truncating
   * titles that fit fine on tile.
   */
  const titleFit = {
    hero: { threshold: 20, base: 'text-2xl leading-7', long: 'text-xl leading-6' },
    tile: { threshold: 18, base: 'text-xl leading-6', long: 'text-lg leading-5' },
    grid: { threshold: 12, base: 'text-lg leading-5', long: 'text-base leading-4' },
    small: { threshold: 10, base: 'text-lg leading-5', long: 'text-base leading-4' },
    continue: { threshold: 12, base: 'text-base leading-5', long: 'text-sm leading-4' },
    mini: { threshold: Infinity, base: 'text-[10px] leading-3', long: 'text-[10px] leading-3' },
  }[resolvedSize];
  const isLongTitle = displayTitle.length > titleFit.threshold;
  const coverTitle =
    resolvedSize === 'mini'
      ? title
          .split(/\s+/)
          .slice(0, 2)
          .map((word) => word[0])
          .join('')
          .toUpperCase()
      : displayTitle;
  const titleSizeClass = isLongTitle ? titleFit.long : titleFit.base;

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
      style={resolvedSize === 'grid' ? { aspectRatio: 148 / 218 } : undefined}
    >
      {showImage ? (
        <ExpoImage
          source={{
            uri: coverURL?.startsWith('/')
              ? `${apiBaseURL}${coverURL}`
              : resolveCoverSrc(coverURL || ''),
          }}
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
              numberOfLines={resolvedSize === 'mini' ? 2 : isLongTitle ? 4 : 3}
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
  narrow,
  onPress,
}: WorkPresentationProps) {
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);

  const handleFocus = () => setFocused(true);
  const handleBlur = () => setFocused(false);
  const handlePressIn = () => setPressed(true);
  const handlePressOut = () => setPressed(false);

  const widthClass = narrow ? 'w-full' : 'w-[184px]';
  const stateClass = resolvePressStateClass({ focused, pressed });

  return (
    <Pressable
      accessibilityRole="button"
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
          size={narrow ? 'grid' : 'tile'}
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
      <Text numberOfLines={2} className="mt-1 font-editorial-bold text-base leading-5 text-ink">
        {title}
      </Text>
      <Text numberOfLines={1} className="text-sm leading-[18px] text-muted">
        {author || 'Unknown author'}
      </Text>
      {availability ? <AvailabilityLabel value={availability} /> : null}
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
function availabilityItems(value: WorkAvailability) {
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
  return items.filter((item) => item.enabled);
}

/** Icon + label row, for list rows (`WorkRow`) that have the horizontal room for it. */
export function AvailabilityIcons({ value }: { value: WorkAvailability }) {
  const available = availabilityItems(value);
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
 * Two boxed-chip treatments were tried here before this (a dark cover-overlay
 * pill, then a `StatusBadge` spine-label) and both read as a generic
 * component slapped onto the card rather than something that belongs to it —
 * the colored corner/spine is the same "AI slop" tell that landed on the
 * auth card earlier in this app's history. This drops the container
 * entirely: just an icon and a word, the same visual weight as the author
 * line above it, not a status widget. Only the synced case gets any color at
 * all (`text-accent`) — it's this app's actual signature feature and earns
 * standing out; read-only and listen-only stay fully muted so the common
 * case doesn't compete with the title/author for attention.
 */
function AvailabilityLabel({ value }: { value: WorkAvailability }) {
  const synced = value.synchronized;
  const icon = synced ? 'synced' : value.listenable ? 'listen' : value.readable ? 'read' : null;
  if (!icon) return null;
  const label = synced ? 'Read & Listen' : value.listenable ? 'Listen' : 'Read';
  const color = synced ? colors.accent : colors.subtle;

  return (
    <View className="mt-0.5 flex-row items-center gap-1">
      <AppIcon name={icon} size={13} color={color} />
      <Text className={`text-[11px] font-sans-semibold ${synced ? 'text-accent' : 'text-subtle'}`}>
        {label}
      </Text>
    </View>
  );
}

/**
 * A shelf tile, not a detail card: covers line up side by side like books
 * standing on a shelf, so the primary "pick up where I left off" action is
 * a single tap on the cover itself (the ribbon names it) rather than a
 * full-width button competing with title/author/context text underneath.
 * Long-press exposes secondary book actions; the visible menu button keeps
 * the same actions available without a gesture.
 */
const continueSizeClass = {
  continue: { width: 'w-[106px]', title: 'text-sm leading-4 min-h-[32px]', titleLines: 2 },
  hero: { width: 'w-[204px]', title: 'text-lg leading-6 min-h-[48px]', titleLines: 3 },
} as const;

export function ContinueCard({
  title,
  author,
  coverURL,
  coverPresentation,
  progress,
  continueMode,
  size = 'continue',
  onOpen,
  onContinue,
  continueHref,
  actions,
}: {
  title: string;
  author?: string;
  coverURL?: string;
  coverPresentation?: CoverPresentation;
  context?: string;
  availability: WorkAvailability;
  progress?: string;
  continueMode: 'read' | 'listen';
  /** `hero` gives the cover and title room to breathe — use it where Continue is the star of the screen (Home). */
  size?: keyof typeof continueSizeClass;
  onOpen: () => void;
  onContinue: () => void;
  continueHref: Href;
  actions: { label: string; onPress: () => void }[];
  onRead?: () => void;
  onListen?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [coverFocused, setCoverFocused] = useState(false);
  const [coverPressed, setCoverPressed] = useState(false);
  const [titleFocused, setTitleFocused] = useState(false);
  const [titlePressed, setTitlePressed] = useState(false);
  const coverStateClass = resolvePressStateClass({ focused: coverFocused, pressed: coverPressed });
  const titleStateClass = resolvePressStateClass({ focused: titleFocused, pressed: titlePressed });
  const dimensions = continueSizeClass[size];

  const cover = (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Continue ${continueMode === 'read' ? 'reading' : 'listening to'} ${title}`}
      onBlur={() => setCoverFocused(false)}
      onFocus={() => setCoverFocused(true)}
      onPressIn={() => setCoverPressed(true)}
      onPressOut={() => setCoverPressed(false)}
      accessibilityHint="Press and hold for book actions"
      onPress={Platform.OS === 'ios' ? undefined : onContinue}
      onLongPress={Platform.OS === 'ios' ? undefined : () => setMenuOpen(true)}
      className={`relative rounded-control ${coverStateClass}`}
    >
      <BookCover
        title={title}
        author={author}
        coverURL={coverURL}
        size={size}
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
  );

  return (
    <View className={`${dimensions.width} gap-1.5`}>
      {Platform.OS === 'ios' ? (
        <Link href={continueHref} asChild>
          <Link.Trigger>{cover}</Link.Trigger>
          <Link.Menu title={title}>
            {actions.map((action) => (
              <Link.MenuAction key={action.label} onPress={action.onPress}>
                {action.label}
              </Link.MenuAction>
            ))}
          </Link.Menu>
        </Link>
      ) : (
        cover
      )}
      <View>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Open ${title}`}
          onBlur={() => setTitleFocused(false)}
          onFocus={() => setTitleFocused(true)}
          onPressIn={() => setTitlePressed(true)}
          onPressOut={() => setTitlePressed(false)}
          onPress={onOpen}
          className={`min-h-11 rounded-control px-0.5 ${titleStateClass}`}
        >
          <Text
            numberOfLines={dimensions.titleLines}
            className={`font-editorial-bold text-ink ${dimensions.title}`}
          >
            {title}
          </Text>
        </Pressable>
        <View className="flex-row items-center justify-between">
          <Text numberOfLines={1} className="min-w-0 flex-1 px-0.5 text-[11px] text-muted">
            {author || 'Unknown author'}
          </Text>
          <IconButton
            icon="more"
            kind="quiet"
            label={`Book actions for ${title}`}
            onPress={() => setMenuOpen(true)}
          />
        </View>
      </View>
      <Dialog visible={menuOpen} title={title} onClose={() => setMenuOpen(false)}>
        <View className="gap-1">
          {actions.map((action) => (
            <Button
              key={action.label}
              label={action.label}
              kind="quiet"
              onPress={() => {
                setMenuOpen(false);
                action.onPress();
              }}
            />
          ))}
        </View>
      </Dialog>
    </View>
  );
}
