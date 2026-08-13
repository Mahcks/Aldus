import type { WorkSummary } from '../generated/api';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { WorkCard } from './bookshelf';
import { Button, Field, Row, colors, space } from './ui';

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
    <View style={styles.controls}>
      <Field
        label="Search title or author"
        value={query}
        onChangeText={onQueryChange}
        returnKeyType="search"
      />
      <View style={styles.controlGroup} accessibilityRole="radiogroup">
        <Text style={styles.label}>Sort</Text>
        <Row>
          {browseSorts.map(([value, label]) => (
            <Button
              key={value}
              label={label}
              kind={sort === value ? 'primary' : 'secondary'}
              selected={sort === value}
              onPress={() => onSortChange(value)}
            />
          ))}
        </Row>
      </View>
      <View style={styles.controlGroup} accessibilityRole="radiogroup">
        <Text style={styles.label}>Show</Text>
        <Row>
          {browseFilters.map(([value, label]) => (
            <Button
              key={value}
              label={label}
              kind={availability === value ? 'primary' : 'secondary'}
              selected={availability === value}
              onPress={() => onAvailabilityChange(value)}
            />
          ))}
        </Row>
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
    <View style={styles.grid}>
      {works.map((work) => (
        <WorkCard
          key={work.id}
          title={work.title}
          author={work.author}
          badges={summaryBadges(work)}
          progress={work.in_progress ? 'Continue where you left off' : undefined}
          context={showLibrary ? work.library_name : undefined}
          narrow={narrow}
          onPress={() => onOpen(work)}
        />
      ))}
    </View>
  );
}

export function summaryBadges(work: WorkSummary) {
  return [
    work.readable ? 'Read' : '',
    work.listenable ? 'Listen' : '',
    work.synchronized ? 'Synced' : '',
  ].filter(Boolean);
}

const styles = StyleSheet.create({
  controls: {
    padding: space.lg,
    gap: space.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    backgroundColor: colors.paper,
  },
  controlGroup: { gap: 6 },
  label: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: space.xl },
});
