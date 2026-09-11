import { Link, type Href } from 'expo-router';
import { Platform } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useState, type PropsWithChildren, type ReactNode } from 'react';
import { apiBaseURL } from '@/lib/api-base';
import { AppIcon, type AppIconName } from './icons';
import { Button, Dialog, IconButton, colors, resolvePressStateClass } from './ui';
import { Pressable, Text, View } from './tw';
import type { WorkQuickAction } from './work-actions';

const coverTones = ['bg-ink', 'bg-text-secondary', 'bg-accent-strong', 'bg-info', 'bg-success'];
/**
 * Hex twin of `coverTones`, same order — the cover image itself is rendered
 * by `expo-image` (see below), which takes a real color for its background
 * rather than a className, so the letterboxed strips around a `contain`-fit
 * cover still pick up the generated tone instead of falling back to white.
 */
const coverToneHex = [
  colors.ink,
  colors.textSecondary,
  colors.accentStrong,
  colors.info,
  colors.success,
];

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
    coverFit: 'cover',
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
  square = false,
  size,
  aspectRatio,
  coverURL,
  fallbackCoverURL,
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
  square?: boolean;
  size?: 'mini' | 'small' | 'grid' | 'tile' | 'continue' | 'hero' | 'audio';
  /** `size="grid"` only: overrides the usual square-or-portrait choice with an exact width/height ratio — see `square` on `WorkCard` for why this exists. */
  aspectRatio?: number;
  coverURL?: string;
  fallbackCoverURL?: string;
} & CoverPresentation) {
  const [failedURLs, setFailedURLs] = useState<string[]>([]);
  const imageURL = [coverURL, fallbackCoverURL].find((url) => url && !failedURLs.includes(url));
  const showImage = Boolean(imageURL);
  const resolvedSize = size ?? (compact ? 'hero' : 'tile');
  const sizeClass = {
    mini: square ? 'h-14 w-14' : 'h-20 w-14',
    small: square ? 'h-[148px] w-[148px]' : 'h-[218px] w-[148px]',
    grid: 'w-full',
    tile: square ? 'h-[184px] w-[184px]' : 'h-[270px] w-[184px]',
    continue: square ? 'h-[106px] w-[106px]' : 'h-[156px] w-[106px]',
    hero: square ? 'h-[204px] w-[204px]' : 'h-[300px] w-[204px]',
    audio: 'aspect-square w-full max-w-[340px]',
  }[resolvedSize];
  const coverToneIndex =
    generatedCoverTone >= 0 ? generatedCoverTone : hash(title + author) % coverTones.length;
  const coverTone = coverTones[coverToneIndex];
  const thumbnail =
    resolvedSize === 'mini' || resolvedSize === 'continue' || (square && resolvedSize === 'small');
  const outerPaddingClass = thumbnail ? 'p-1.5' : 'p-2.5';
  const innerPaddingClass = thumbnail ? 'px-1.5 py-2' : 'px-2 py-4';
  const displayTitle = coverDisplayTitle(title);
  /**
   * Threshold and type scale both track the cover's own width — a "small"
   * cover (148px) has meaningfully less line width than "tile" (184px), so
   * sharing one long-title cutoff between them left small covers truncating
   * titles that fit fine on tile.
   */
  const titleFit = {
    audio: { threshold: 28, base: 'text-3xl leading-9', long: 'text-2xl leading-7' },
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
      style={
        resolvedSize === 'grid'
          ? { aspectRatio: aspectRatio ?? (square ? 1 : 148 / 218) }
          : undefined
      }
    >
      {showImage ? (
        <ExpoImage
          source={{
            uri: imageURL?.startsWith('/')
              ? `${apiBaseURL}${imageURL}`
              : resolveCoverSrc(imageURL || ''),
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
          onError={() => {
            if (imageURL) setFailedURLs((urls) => [...urls, imageURL]);
          }}
        />
      ) : null}
      {showImage ? null : (
        <>
          {generatedCoverStyle === 'classic' ? (
            <View className="absolute bottom-0 left-0 top-0 w-1 bg-paper/20" />
          ) : null}
          <View
            className={`flex-1 items-center ${thumbnail ? 'gap-2' : 'gap-4'} ${layoutClass} ${frameClass} ${innerPaddingClass}`}
          >
            {!thumbnail && generatedCoverStyle !== 'minimal' ? (
              <Text className="text-center text-[9px] font-sans-bold uppercase tracking-[2px] text-paper/70">
                Aldus edition
              </Text>
            ) : (
              <View />
            )}
            <Text
              numberOfLines={resolvedSize === 'mini' ? 2 : isLongTitle ? 4 : 3}
              className={`min-h-0 shrink text-center font-editorial text-paper ${titleSizeClass}`}
            >
              {coverTitle}
            </Text>
            <View className="items-center gap-2">
              <View className="h-px w-7 bg-paper/70" />
              {resolvedSize !== 'mini' ? (
                <Text
                  numberOfLines={2}
                  className="text-center font-editorial text-[10px] leading-3 text-paper/80"
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
      className={`w-full flex-row items-center gap-3 border-b border-line py-4 ${stateClass}`}
    >
      <View className="h-11 w-11 items-center justify-center rounded-full bg-accent-soft">
        <AppIcon name="libraries" size={20} color={colors.accent} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="font-sans-semibold text-base text-ink">{name}</Text>
        <Text className="mt-0.5 text-xs font-sans-semibold text-subtle">
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
  fallbackCoverURL?: string;
  availability?: WorkAvailability;
  progress?: string;
  narrow?: boolean;
  dense?: boolean;
  onPress: () => void;
};

/**
 * A soft dark scrim over just the bottom edge of a cover, with the progress
 * label — and, when there's room, the format icon — sitting on it, the same
 * move streaming apps use for "continue watching" tiles. Replaces the pill
 * badge this used to be: a badge anchored to a cover's corner sits squarely
 * on top of whatever real artwork is there (a title, an illustration),
 * which is fine over our own generated covers but not over a book's or an
 * audiobook's actual cover. The bottom edge isn't risk-free either — some
 * covers put a credit line right there — but it's the one edge that's never
 * the *title*, so it's the safer default everywhere rather than picking a
 * different treatment per format.
 *
 * `icon` folds the format indicator (read/listen/synced) into this same
 * bar instead of giving it a separate overlay elsewhere on the cover — one
 * thing sitting on the art, not two. `FormatIconChip` below is the
 * no-progress equivalent: format info lives on the cover either way, never
 * duplicated into the caption as text.
 *
 * Stacked flat layers, not a real gradient: the smooth version needs
 * `expo-linear-gradient`, a native module a dev-client build doesn't have
 * until it's rebuilt from Xcode/Android Studio, not just reloaded from
 * Metro. Four steps of increasing `bg-ink` opacity reads as a soft fade at
 * cover scale without needing any native code at all.
 */
function ProgressScrim({ progress, icon }: { progress: string; icon?: AppIconName | null }) {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="absolute inset-x-0 bottom-0 overflow-hidden rounded-b-control"
    >
      <View className="h-2 bg-ink/10" />
      <View className="h-2 bg-ink/30" />
      <View className="h-2 bg-ink/55" />
      <View className="flex-row items-center justify-between bg-ink/85 px-2 pb-1.5 pt-1">
        <Text numberOfLines={1} className="shrink text-[10px] font-sans-bold text-on-accent">
          {progress}
        </Text>
        {icon ? <AppIcon name={icon} size={12} color={colors.onAccent} /> : null}
      </View>
    </View>
  );
}

/**
 * The no-progress counterpart to `ProgressScrim`: with no progress text to
 * anchor a whole bar to, format info shrinks to a small icon-only dot in
 * the same bottom-right corner the scrim's icon would occupy — never a
 * full bar with nothing else in it, and never a second, separate label
 * back in the caption (the two used to show the same fact twice).
 */
function FormatIconChip({ icon }: { icon: AppIconName }) {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="absolute bottom-1.5 right-1.5 h-5 w-5 items-center justify-center rounded-pill bg-ink/75"
    >
      <AppIcon name={icon} size={11} color={colors.onAccent} />
    </View>
  );
}

/**
 * Card-shaped presentation of a Work, for grids. `actions`, when given, turns
 * on a press-and-hold quick menu — the same affordance `ContinueCard` offers
 * on Home. With `href` also given, iOS gets the real native context menu
 * (`Link.Menu`); everywhere else falls back to a plain `Dialog` opened on
 * long-press. Neither adds visible chrome to the card at rest, so dense
 * grids (Library) stay exactly the size their layout math already accounts
 * for.
 *
 * `onBeforeOpen` is a pure side effect (no navigation of its own) run right
 * before the card opens, by tap or by any quick action — Library uses it to
 * stash scroll position and filters so Back can restore them. It matters
 * only on the native-menu path: there, `Link` owns the actual navigation via
 * `href`, so `onPress` must not also push the route, or Back would have to
 * pop the same screen twice.
 */
export function WorkCard({
  title,
  author,
  coverURL,
  fallbackCoverURL,
  audioArtwork = false,
  shelfAligned = false,
  coverPresentation,
  availability,
  progress,
  narrow,
  dense,
  href,
  actions,
  onBeforeOpen,
  onPress,
}: WorkPresentationProps & {
  href?: Href;
  audioArtwork?: boolean;
  /**
   * Opts a narrow, `audioArtwork` tile into "resting on a shelf": the cover
   * renders at its true, uncropped shape (square for audio, portrait for a
   * book) instead of being forced into a shared portrait footprint. Only
   * makes sense inside a row/wrap container the caller has bottom-aligned
   * (`items-end`) — a shorter square cover next to a taller portrait one,
   * both sitting on the row's bottom edge, reads like books of different
   * heights standing on a shelf rather than a mis-sized image. Home's
   * shelves opt in; Library's virtualized grid (fixed per-row cell height,
   * no shared bottom edge to rest on) keeps the reserved-footprint default.
   */
  shelfAligned?: boolean;
  actions?: WorkQuickAction[];
  onBeforeOpen?: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuActions = actions ?? [];
  const hasActions = menuActions.length > 0;
  const useNativeMenu = hasActions && Platform.OS === 'ios' && Boolean(href);
  const wrappedActions = menuActions.map((action) => ({
    label: action.label,
    onPress: () => {
      onBeforeOpen?.();
      action.onPress();
    },
  }));

  const handleFocus = () => setFocused(true);
  const handleBlur = () => setFocused(false);
  const handlePressIn = () => setPressed(true);
  const handlePressOut = () => setPressed(false);

  const widthClass = narrow ? 'w-full' : 'w-[184px]';
  const stateClass = resolvePressStateClass({ focused, pressed });
  // Computed once — decides which of `ProgressScrim` or `FormatIconChip`
  // the cover renders below. Format info lives only on the cover, never
  // duplicated as text in the caption.
  const formatIcon = availability ? availabilityIcon(availability) : null;

  const card = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}${author ? ` by ${author}` : ''}${progress ? `. ${progress}` : ''}`}
      accessibilityHint={hasActions ? 'Press and hold for book actions' : undefined}
      onBlur={handleBlur}
      onFocus={handleFocus}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={useNativeMenu ? undefined : onPress}
      onLongPress={hasActions && !useNativeMenu ? () => setMenuOpen(true) : undefined}
      className={`gap-1.5 rounded-control ${widthClass} ${stateClass}`}
    >
      {/*
       * `audioArtwork` never crops: real cover art routinely puts a title
       * right at the edge (an audiobook's own cover is the one place this
       * app shows real, non-generated artwork uncropped elsewhere, so this
       * shouldn't be the exception), and a square source can only be
       * cropped to portrait by trimming its *sides*, which loses just as
       * much of the actual art. `shelfAligned` picks how the resulting
       * shorter square sits next to taller portrait covers — see its prop
       * doc above for the two treatments.
       */}
      {audioArtwork && narrow && shelfAligned ? (
        <View className="relative w-full">
          <BookCover
            title={title}
            author={author}
            coverURL={coverURL}
            fallbackCoverURL={fallbackCoverURL}
            {...coverPresentation}
            // Forced, not inherited: `coverPresentation.coverFit` is the
            // library cover's own crop preference, tuned for a known
            // portrait shape. The real embedded audiobook art isn't
            // guaranteed to actually be square — `contain` is what
            // guarantees nothing gets cropped no matter its real shape.
            coverFit="contain"
            size="grid"
            square
          />
          {progress ? (
            <ProgressScrim progress={progress} icon={formatIcon} />
          ) : formatIcon ? (
            <FormatIconChip icon={formatIcon} />
          ) : null}
        </View>
      ) : audioArtwork && narrow ? (
        // Outer reserves the usual portrait footprint (captions still line
        // up across the row); inner wraps just the actual, shorter square
        // image, so the scrim sits on the real cover rather than floating
        // in the blank gap the outer view leaves beneath it.
        <View className="w-full" style={{ aspectRatio: 148 / 218 }}>
          <View className="relative w-full">
            <BookCover
              title={title}
              author={author}
              coverURL={coverURL}
              fallbackCoverURL={fallbackCoverURL}
              {...coverPresentation}
              coverFit="contain"
              size="grid"
              aspectRatio={1}
            />
            {progress ? (
              <ProgressScrim progress={progress} icon={formatIcon} />
            ) : formatIcon ? (
              <FormatIconChip icon={formatIcon} />
            ) : null}
          </View>
        </View>
      ) : (
        <View className="relative">
          <BookCover
            title={title}
            author={author}
            coverURL={coverURL}
            fallbackCoverURL={fallbackCoverURL}
            {...coverPresentation}
            coverFit={coverPresentation?.coverFit}
            size={narrow ? 'grid' : 'tile'}
          />
          {progress ? (
            <ProgressScrim progress={progress} icon={formatIcon} />
          ) : formatIcon ? (
            <FormatIconChip icon={formatIcon} />
          ) : null}
        </View>
      )}
      {/*
       * `min-h-10` reserves the full 2-line height even when a title only
       * wraps to 1 line. Tried letting it size naturally instead — a short
       * title next to a 2-line one staggers every line below it (author,
       * availability) across the row, which reads worse than the blank gap
       * a short title leaves here. Same reason Spotify, Apple Books, and
       * Audible all reserve a fixed title height in their grids instead of
       * letting rows stagger.
       */}
      <Text
        numberOfLines={2}
        className={
          dense
            ? 'mt-1 min-h-10 font-editorial-bold text-sm leading-5 text-ink'
            : 'mt-1 min-h-10 font-editorial-bold text-base leading-5 text-ink'
        }
      >
        {title}
      </Text>
      <Text
        numberOfLines={1}
        className={
          dense ? 'text-xs leading-[18px] text-muted' : 'text-sm leading-[18px] text-muted'
        }
      >
        {author || 'Unknown author'}
      </Text>
    </Pressable>
  );

  return (
    <>
      {href && useNativeMenu ? (
        <Link href={href} asChild onPress={onBeforeOpen}>
          <Link.Trigger>{card}</Link.Trigger>
          <Link.Menu title={title}>
            {wrappedActions.map((action) => (
              <Link.MenuAction key={action.label} onPress={action.onPress}>
                {action.label}
              </Link.MenuAction>
            ))}
          </Link.Menu>
        </Link>
      ) : (
        card
      )}
      {hasActions && !useNativeMenu ? (
        <Dialog title={title} visible={menuOpen} onClose={() => setMenuOpen(false)}>
          <View className="gap-1">
            {wrappedActions.map((action) => (
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
      ) : null}
    </>
  );
}

/** Alias of `WorkCard`, matching the design plan's naming. */
export const WorkTile = WorkCard;

/** Horizontal list-row presentation of a Work: thumbnail + title/author/badges/progress. */
export function WorkRow({
  title,
  author,
  coverURL,
  fallbackCoverURL,
  coverPresentation,
  availability,
  progress,
  onPress,
  action,
  separator = false,
  audioArtwork = false,
}: WorkPresentationProps & { action?: ReactNode; separator?: boolean; audioArtwork?: boolean }) {
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);

  const handleFocus = () => setFocused(true);
  const handleBlur = () => setFocused(false);
  const handlePressIn = () => setPressed(true);
  const handlePressOut = () => setPressed(false);

  const stateClass = resolvePressStateClass({ focused, pressed });

  return (
    <View className={`flex-row items-center gap-2 ${separator ? 'border-t border-line' : ''}`}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${title}${author ? ` by ${author}` : ''}${progress ? `. ${progress}` : ''}`}
        onBlur={handleBlur}
        onFocus={handleFocus}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={onPress}
        className={`min-w-0 flex-1 flex-row items-center gap-4 rounded-control py-3 ${stateClass}`}
      >
        <View className="w-14">
          <BookCover
            title={title}
            author={author}
            coverURL={coverURL}
            fallbackCoverURL={fallbackCoverURL}
            size="mini"
            square={audioArtwork}
            {...coverPresentation}
            coverFit={coverPresentation?.coverFit}
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

/** Shared by `ProgressScrim` and `FormatIconChip` — one rule for which icon represents a Work's availability, wherever it ends up rendered. */
function availabilityIcon(value: WorkAvailability): AppIconName | null {
  return value.synchronized
    ? 'synced'
    : value.listenable
      ? 'listen'
      : value.readable
        ? 'read'
        : null;
}

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
 * A shelf tile, not a detail card: covers line up side by side like books
 * standing on a shelf, so the primary "pick up where I left off" action is
 * a single tap on the cover itself (the ribbon names it) rather than a
 * full-width button competing with title/author/context text underneath.
 * Long-press exposes secondary book actions; the visible menu button keeps
 * the same actions available without a gesture.
 */
const continueSizeClass = {
  continue: { width: 'w-[106px]', title: 'text-sm leading-4 min-h-[32px]', titleLines: 2 },
  hero: { width: 'w-full', title: 'text-lg leading-6 min-h-[48px]', titleLines: 3 },
} as const;

export function ContinueCard({
  title,
  author,
  coverURL,
  fallbackCoverURL,
  coverPresentation,
  progress,
  continueMode,
  audioArtwork = false,
  onRead,
  onListen,
  completionPercent,
  size = 'continue',
  onOpen,
  onContinue,
  continueHref,
  actions,
}: {
  title: string;
  author?: string;
  coverURL?: string;
  fallbackCoverURL?: string;
  coverPresentation?: CoverPresentation;
  context?: string;
  availability: WorkAvailability;
  progress?: string;
  continueMode: 'read' | 'listen';
  /** Square-crop the cover, same as `WorkRow`'s prop of the same name — pass this only when `coverURL` is genuine album-style audiobook art, not just because the mode is "listen". A portrait book cover forced square gets letterboxed. */
  audioArtwork?: boolean;
  completionPercent?: number;
  /** `hero` gives the cover and title room to breathe — use it where Continue is the star of the screen (Home). */
  size?: keyof typeof continueSizeClass;
  onOpen: () => void;
  onContinue: () => void;
  continueHref: Href;
  actions: WorkQuickAction[];
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
      className={`relative rounded-control ${audioArtwork ? (size === 'hero' ? 'w-[148px]' : 'w-[106px]') : ''} ${coverStateClass}`}
    >
      <BookCover
        title={title}
        author={author}
        coverURL={coverURL}
        fallbackCoverURL={fallbackCoverURL}
        size={size === 'hero' ? 'small' : size}
        square={audioArtwork}
        {...coverPresentation}
        coverFit={coverPresentation?.coverFit}
      />
      {progress && size !== 'hero' ? (
        <View className="absolute left-1.5 top-1.5 max-w-[85%] rounded-pill bg-ink/80 px-1.5 py-0.5 shadow-xs">
          <Text numberOfLines={1} className="text-[10px] font-sans-bold text-paper">
            {progress}
          </Text>
        </View>
      ) : null}
      {size !== 'hero' ? (
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
      ) : null}
    </Pressable>
  );

  return (
    <View
      className={`${dimensions.width} ${size === 'hero' ? 'flex-row items-start gap-4' : 'gap-1.5'}`}
    >
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
      <View className={size === 'hero' ? 'min-w-0 flex-1 gap-2' : ''}>
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
            className={`font-editorial text-ink ${dimensions.title}`}
          >
            {title}
          </Text>
        </Pressable>
        <View className="flex-row items-center justify-between">
          <Text numberOfLines={1} className="min-w-0 flex-1 px-0.5 text-[11px] text-muted">
            {author || 'Unknown author'}
          </Text>
          {size !== 'hero' ? (
            <IconButton
              icon="more"
              kind="quiet"
              label={`Book actions for ${title}`}
              onPress={() => setMenuOpen(true)}
            />
          ) : null}
        </View>
        {size === 'hero' ? (
          <View className="gap-2 pt-2">
            {progress ? <Text className="text-xs text-muted">{progress}</Text> : null}
            {completionPercent != null ? (
              <View
                accessibilityRole="progressbar"
                accessibilityValue={{ min: 0, max: 100, now: completionPercent }}
                className="mb-2 h-1 overflow-hidden rounded-pill bg-line"
              >
                <View
                  className="h-full rounded-pill bg-accent"
                  style={{ width: `${Math.max(0, Math.min(100, completionPercent))}%` }}
                />
              </View>
            ) : null}
            <Button
              label={continueMode === 'read' ? 'Continue reading' : 'Continue listening'}
              kind="primary"
              onPress={onContinue}
            />
            {continueMode === 'read' && onListen ? (
              <Button label="Listen" icon="listen" onPress={onListen} />
            ) : null}
            {continueMode === 'listen' && onRead ? (
              <Button label="Read" icon="read" onPress={onRead} />
            ) : null}
          </View>
        ) : null}
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
