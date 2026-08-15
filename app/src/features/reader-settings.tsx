import type { ReaderPreferences } from '../components/EPUBReader';
import { Button } from './ui';
import { Text, View } from './tw';

type Props = {
  value: ReaderPreferences;
  disabled?: boolean;
  compact?: boolean;
  onChange: (value: ReaderPreferences) => void;
};

export function ReaderSettings({ value, disabled, compact, onChange }: Props) {
  return (
    <View className={compact ? 'bg-raised' : 'border-b border-line bg-panel px-4 py-3'}>
      <View
        className={
          compact
            ? 'w-full gap-5'
            : 'mx-auto w-full max-w-[900px] flex-row flex-wrap items-end gap-x-6 gap-y-3'
        }
      >
        <ChoiceGroup
          label="Text size"
          options={[
            ['Small', 0.9],
            ['Standard', 1],
            ['Large', 1.15],
            ['Larger', 1.3],
          ]}
          selected={value.zoom}
          disabled={disabled}
          onSelect={(zoom) => onChange({ ...value, zoom })}
        />
        <ChoiceGroup
          label="Line spacing"
          options={[
            ['Compact', 1.5],
            ['Standard', 1.72],
            ['Relaxed', 1.95],
          ]}
          selected={value.lineHeight}
          disabled={disabled}
          onSelect={(lineHeight) => onChange({ ...value, lineHeight })}
        />
        <ChoiceGroup
          label="Margins"
          options={[
            ['Narrow', 1],
            ['Standard', 2],
            ['Wide', 3],
          ]}
          selected={value.margin}
          disabled={disabled}
          onSelect={(margin) => onChange({ ...value, margin })}
        />
        <ChoiceGroup
          label="Page"
          options={[
            ['Paper', 'paper'],
            ['Sepia', 'sepia'],
          ]}
          selected={value.theme}
          disabled={disabled}
          onSelect={(theme) => onChange({ ...value, theme })}
        />
        <ChoiceGroup
          label="Layout"
          options={[
            ['Pages', 'paginated'],
            ['Scroll', 'scrolled'],
          ]}
          selected={value.layout}
          disabled={disabled}
          onSelect={(layout) => onChange({ ...value, layout })}
        />
      </View>
    </View>
  );
}

function ChoiceGroup<T extends string | number>({
  label,
  options,
  selected,
  disabled,
  onSelect,
}: {
  label: string;
  options: [string, T][];
  selected: T;
  disabled?: boolean;
  onSelect: (value: T) => void;
}) {
  return (
    <View className="gap-1.5">
      <Text className="text-sm font-semibold text-ink">{label}</Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        className="flex-row flex-wrap gap-1"
      >
        {options.map(([optionLabel, option]) => (
          <Button
            key={String(option)}
            label={optionLabel}
            accessibilityRole="radio"
            selected={selected === option}
            disabled={disabled}
            onPress={() => onSelect(option)}
          />
        ))}
      </View>
    </View>
  );
}
