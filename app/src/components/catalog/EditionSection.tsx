import { useState } from 'react';
import type { MediaChoice } from '@/lib/consumption/consumption';
import { formatMediaSize as formatBytes } from '@/lib/format';
import { AppIcon } from '@/components/ui/icons';
import { useThemeColors } from '@/components/ui/theme';
import { resolvePressStateClass } from '@/components/ui';
import { Pressable, Text, View } from '@/components/ui/tw';

/** Edition/narration picker — renders nothing unless a group genuinely has more than one option, per "only when choices actually exist." */
export function EditionSection({
  epubs,
  audio,
  epubID,
  audioID,
  onSelectEPUB,
  onSelectAudio,
}: {
  epubs: MediaChoice[];
  audio: MediaChoice[];
  epubID: string;
  audioID: string;
  onSelectEPUB: (id: string) => void;
  onSelectAudio: (id: string) => void;
}) {
  if (epubs.length <= 1 && audio.length <= 1) return null;

  return (
    <View className="gap-6 sm:flex-row sm:gap-12">
      {epubs.length > 1 ? (
        <EditionGroup
          label="Reading edition"
          icon="read"
          items={epubs}
          selected={epubID}
          onSelect={onSelectEPUB}
        />
      ) : null}
      {audio.length > 1 ? (
        <EditionGroup
          label="Narration"
          icon="listen"
          items={audio}
          selected={audioID}
          onSelect={onSelectAudio}
        />
      ) : null}
    </View>
  );
}

function EditionGroup({
  label,
  icon,
  items,
  selected,
  onSelect,
}: {
  label: string;
  icon: 'read' | 'listen';
  items: MediaChoice[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const colors = useThemeColors();
  return (
    <View className="w-full min-w-0 gap-2 sm:flex-1">
      <View className="flex-row items-center gap-1.5 pb-1">
        <AppIcon name={icon} size={15} color={colors.subtle} />
        <Text className="text-xs font-sans-bold uppercase tracking-wide text-subtle">{label}</Text>
      </View>
      <View accessibilityRole="radiogroup" accessibilityLabel={label}>
        {items.map((item) => (
          <View key={item.id}>
            <EditionOption
              label={item.representation.label}
              detail={formatBytes(item.size_bytes)}
              selected={selected === item.id}
              onPress={() => onSelect(item.id)}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

function EditionOption({
  label,
  detail,
  selected,
  onPress,
}: {
  label: string;
  detail: string;
  selected: boolean;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const stateClass = resolvePressStateClass({ focused, pressed });
  const ringClass = selected ? 'border-accent' : 'border-line-strong';

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      aria-checked={selected}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={onPress}
      className={`min-h-11 flex-row items-center gap-3 rounded-control py-2 ${stateClass}`}
    >
      <View
        className={`h-5 w-5 shrink-0 items-center justify-center rounded-full border bg-paper ${ringClass}`}
      >
        {selected ? <View className="h-2.5 w-2.5 rounded-full bg-accent" /> : null}
      </View>
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-sm font-sans-semibold text-ink">
          {label}
        </Text>
        <Text className="text-xs text-subtle">{detail}</Text>
      </View>
    </Pressable>
  );
}
