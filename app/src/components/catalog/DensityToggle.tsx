import type { LibraryDensity } from '@/lib/catalog/library-layout';
import { IconButton } from '@/components/ui';
import { View } from '@/components/ui/tw';

/** Two-state cover-size switch for the library toolbar on wide web windows. */
export function DensityToggle({
  value,
  onChange,
}: {
  value: LibraryDensity;
  onChange: (value: LibraryDensity) => void;
}) {
  return (
    <View
      accessibilityLabel="Cover size"
      className="flex-row gap-0.5 rounded-control border border-line-strong bg-control p-0.5"
    >
      <IconButton
        icon="gridLayout"
        label="Comfortable covers"
        kind="quiet"
        selected={value === 'comfortable'}
        pressed={value === 'comfortable'}
        onPress={() => onChange('comfortable')}
      />
      <IconButton
        icon="compactGridLayout"
        label="Compact covers"
        kind="quiet"
        selected={value === 'compact'}
        pressed={value === 'compact'}
        onPress={() => onChange('compact')}
      />
    </View>
  );
}
