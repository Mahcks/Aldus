import type { AcquisitionResult, WorkSummary } from '../generated/api';
import { useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import { acquisitionDate, acquisitionSize, parseAcquisitionRelease } from './acquisition';
import { coverPresentation, WorkCard } from './bookshelf';
import { AppIcon } from './icons';
import { listItemEnter } from './motion';
import { ScrollView, Text, View } from './tw';
import { Button, colors, Notice, Select, StatusBadge } from './ui';

export const browseSorts = [
  ['recent', 'Recently added'],
  ['updated', 'Recently updated'],
  ['title', 'Title A–Z'],
  ['author', 'Author A–Z'],
] as const;

export const browseFilters = [
  ['all', 'All'],
  ['readable', 'Readable'],
  ['listenable', 'Listenable'],
  ['synchronized', 'Synchronized'],
] as const;

/**
 * Single-row, horizontally scrollable stand-in for `Select` on narrow
 * screens, where `Select`'s wrapping button grid consumes too much vertical
 * space. Same radiogroup semantics and `Button` primitive underneath.
 */
function CompactFilterRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View className="gap-1">
      <Text className="text-xs font-semibold uppercase tracking-wide text-subtle">{label}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        contentContainerClassName="flex-row items-center gap-2 pr-4"
      >
        {options.map((option) => (
          <Button
            key={option.value}
            label={option.label}
            kind="secondary"
            selected={option.value === value}
            accessibilityRole="radio"
            onPress={() => onChange(option.value)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * Sort and availability, kept deliberately secondary to the search field:
 * a single-row, horizontally scrollable chip strip rather than a full
 * multi-row `Select` grid, at every width — filters refine results, they
 * don't compete with the query for attention.
 */
export function BrowseControls({
  sort,
  availability,
  onSortChange,
  onAvailabilityChange,
}: {
  sort: string;
  availability: string;
  onSortChange: (value: string) => void;
  onAvailabilityChange: (value: string) => void;
}) {
  const sortOptions = browseSorts.map(([value, label]) => ({ value, label }));
  const availabilityOptions = browseFilters.map(([value, label]) => ({ value, label }));

  return (
    <View className="flex-row flex-wrap gap-x-6 gap-y-2.5">
      <CompactFilterRow
        label="Sort by"
        options={sortOptions}
        value={sort}
        onChange={onSortChange}
      />
      <CompactFilterRow
        label="Availability"
        options={availabilityOptions}
        value={availability}
        onChange={onAvailabilityChange}
      />
    </View>
  );
}

const FORMAT_ICON: Record<string, 'read' | 'listen'> = {
  EPUB: 'read',
  MOBI: 'read',
  AZW3: 'read',
  PDF: 'read',
  CBZ: 'read',
  CBR: 'read',
};

type AcquisitionRowState = 'idle' | 'sending' | 'queued' | 'error';

/**
 * Polished presentation of one external search result: parsed title/author,
 * a format badge, subdued source/size/date metadata, and a single quiet
 * trailing action. Never shows torrent jargon, IDs, or hashes.
 */
export function AcquisitionResultRow({
  result,
  state,
  errorMessage,
  disabled,
  onAdd,
}: {
  result: AcquisitionResult;
  state: AcquisitionRowState;
  errorMessage?: string;
  disabled: boolean;
  onAdd: () => void;
}) {
  const parsed = parseAcquisitionRelease(result.title);
  const metadata = [result.source, acquisitionSize(result.size), acquisitionDate(result.published)]
    .filter(Boolean)
    .join(' · ');

  return (
    <View className="gap-2 border-b border-line py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <View className="min-w-0 flex-1 gap-1">
        <View className="flex-row flex-wrap items-center gap-2">
          <Text numberOfLines={2} className="font-editorial text-base font-bold leading-5 text-ink">
            {parsed.title}
          </Text>
          {parsed.format ? (
            <StatusBadge
              tone="neutral"
              icon={FORMAT_ICON[parsed.format] ?? 'listen'}
              label={parsed.format}
            />
          ) : null}
        </View>
        {parsed.author ? (
          <Text numberOfLines={1} className="text-sm text-muted">
            {parsed.author}
          </Text>
        ) : null}
        <Text numberOfLines={1} className="text-xs text-subtle">
          {metadata}
        </Text>
        {state === 'error' && errorMessage ? <Notice tone="danger">{errorMessage}</Notice> : null}
      </View>
      <View className="items-start sm:items-end">
        {state === 'queued' ? (
          <StatusBadge tone="success" icon="check" label="Queued" />
        ) : (
          <Button
            kind="quiet"
            icon={state === 'error' ? undefined : 'add'}
            label={state === 'error' ? 'Retry' : state === 'sending' ? 'Adding…' : 'Add'}
            loading={state === 'sending'}
            disabled={disabled}
            onPress={onAdd}
          />
        )}
      </View>
    </View>
  );
}

/**
 * Compact "Add to: …" control shown beside the "Available to add" heading.
 * Renders as static text when there is only one eligible destination, and
 * hides the underlying Source entirely unless a real choice exists — the
 * Source is an implementation detail readers shouldn't need to think about.
 */
export function DestinationPicker({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  if (options.length === 0) return null;
  if (options.length === 1) {
    return (
      <View className="flex-row items-center gap-1.5">
        <AppIcon name="acquire" size={14} color={colors.subtle} />
        <Text className="text-xs font-bold text-subtle">Add to: {options[0].label}</Text>
      </View>
    );
  }
  return <Select label="Add to" options={options} value={value} onChange={onChange} />;
}

export function WorkGrid({
  works,
  showLibrary,
  onOpen,
}: {
  works: WorkSummary[];
  showLibrary?: boolean;
  onOpen: (work: WorkSummary) => void;
}) {
  const narrow = useWindowDimensions().width < 600;

  return (
    <View className={`flex-row flex-wrap items-start ${narrow ? 'gap-x-4 gap-y-6' : 'gap-6'}`}>
      {works.map((work, index) => (
        <Animated.View key={work.id} entering={listItemEnter(index)}>
          <WorkCard
            title={work.title}
            author={work.author}
            coverURL={work.cover_url}
            coverPresentation={coverPresentation(work)}
            availability={work}
            progress={work.in_progress ? `${work.completion_percent}% complete` : undefined}
            context={showLibrary ? work.library_name : undefined}
            narrow={narrow}
            onPress={() => onOpen(work)}
          />
        </Animated.View>
      ))}
    </View>
  );
}
