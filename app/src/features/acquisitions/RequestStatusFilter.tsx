import { useState } from 'react';
import { Button, Dialog, Radio } from '@/features/ui';
import { View } from '@/features/tw';

export type RequestStatusFilterProps = {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
};

export function RequestStatusFilter({ label, options, value, onChange }: RequestStatusFilterProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value)?.label || 'Choose status';

  function choose(next: string) {
    onChange(next);
    setOpen(false);
  }

  return (
    <>
      <Button
        label={selected}
        accessibilityLabel={`${label}: ${selected}`}
        icon="chevronDown"
        kind="secondary"
        onPress={() => setOpen(true)}
      />
      <Dialog title={label} visible={open} onClose={() => setOpen(false)}>
        <View accessibilityRole="radiogroup" accessibilityLabel={label} className="gap-1">
          {options.map((option) => (
            <Radio
              key={option.value}
              label={option.label}
              selected={option.value === value}
              onPress={() => choose(option.value)}
            />
          ))}
        </View>
      </Dialog>
    </>
  );
}
