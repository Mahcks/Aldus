import type { WorkSummary } from '../generated/api';
import { useWindowDimensions } from 'react-native';
import { WorkCard } from './bookshelf';
import { View } from './tw';
import { SearchField, Select } from './ui';

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
  return (
    <View className="gap-3 border-y border-line py-3">
      <View className="w-full max-w-[760px]">
        <SearchField
          label="Search title or author"
          value={query}
          onChangeText={onQueryChange}
          placeholder="Search title or author"
        />
      </View>
      <View className="flex-row flex-wrap items-start gap-x-10 gap-y-3">
        <Select
          label="Sort by"
          options={browseSorts.map(([value, label]) => ({ value, label }))}
          value={sort}
          onChange={onSortChange}
        />
        <Select
          label="Availability"
          options={browseFilters.map(([value, label]) => ({ value, label }))}
          value={availability}
          onChange={onAvailabilityChange}
        />
      </View>
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
    <View className="flex-row flex-wrap items-start gap-6">
      {works.map((work) => (
        <WorkCard
          key={work.id}
          title={work.title}
          author={work.author}
          availability={work}
          progress={work.in_progress ? 'Continue where you left off' : undefined}
          context={showLibrary ? work.library_name : undefined}
          narrow={narrow}
          onPress={() => onOpen(work)}
        />
      ))}
    </View>
  );
}
