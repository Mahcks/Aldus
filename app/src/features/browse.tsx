import type { WorkSummary } from '../generated/api';
import { useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import { WorkCard } from './bookshelf';
import { listItemEnter } from './motion';
import { ScrollView, Text, View } from './tw';
import { Button, SearchField, Select } from './ui';

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

export function BrowseControls({
  query,
  sort,
  availability,
  onQueryChange,
  onSortChange,
  onAvailabilityChange,
}: {
  query: string;
  sort: string;
  availability: string;
  onQueryChange: (value: string) => void;
  onSortChange: (value: string) => void;
  onAvailabilityChange: (value: string) => void;
}) {
  const compact = useWindowDimensions().width < 600;
  const sortOptions = browseSorts.map(([value, label]) => ({ value, label }));
  const availabilityOptions = browseFilters.map(([value, label]) => ({ value, label }));

  return (
    <View className="gap-3">
      <View className="w-full max-w-[760px]">
        <SearchField label="Search title or author" value={query} onChangeText={onQueryChange} />
      </View>
      {compact ? (
        <View className="gap-2.5">
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
      ) : (
        <View className="flex-row flex-wrap items-start gap-x-10 gap-y-3">
          <Select label="Sort by" options={sortOptions} value={sort} onChange={onSortChange} />
          <Select
            label="Availability"
            options={availabilityOptions}
            value={availability}
            onChange={onAvailabilityChange}
          />
        </View>
      )}
    </View>
  );
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
            availability={work}
            progress={work.in_progress ? 'Continue where you left off' : undefined}
            context={showLibrary ? work.library_name : undefined}
            narrow={narrow}
            onPress={() => onOpen(work)}
          />
        </Animated.View>
      ))}
    </View>
  );
}
