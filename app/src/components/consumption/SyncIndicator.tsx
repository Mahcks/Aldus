import { ActivityIndicator } from 'react-native';
import { AppIcon, type AppIconName } from '@/components/ui/icons';
import { popIn } from '@/components/ui/motion';
import { useThemeColors, type ThemeColors } from '@/components/ui/theme';
import { AnimatedView, Text, View } from '@/components/ui/tw';
import { saveStatusView, type SaveStatusState } from '@/lib/consumption/handoff-copy';

export type NarrationSync = 'full' | 'partial' | 'none';

type Tone = 'success' | 'neutral' | 'warning' | 'danger' | 'info';

const TONE_CLASS: Record<Tone, { surface: string; text: string }> = {
  success: { surface: 'bg-success-soft', text: 'text-success' },
  neutral: { surface: 'bg-neutral-soft', text: 'text-neutral' },
  warning: { surface: 'bg-warning-soft', text: 'text-warning' },
  danger: { surface: 'bg-danger-soft', text: 'text-danger' },
  info: { surface: 'bg-info-soft', text: 'text-info' },
};

const SAVE_DISPLAY: Record<SaveStatusState, { label: string; icon?: AppIconName; tone: Tone }> = {
  saving: { label: 'Saving…', tone: 'neutral' },
  saved: { label: 'Synced', icon: 'check', tone: 'success' },
  'on-device': { label: 'Saved on this device', icon: 'cloudUpload', tone: 'neutral' },
  error: { label: 'Couldn’t save', icon: 'error', tone: 'danger' },
  paused: { label: 'Not saving', icon: 'warning', tone: 'warning' },
};

const NARRATION_DISPLAY: Record<
  NarrationSync,
  { label: string; icon: AppIconName; tone: Tone; description: string }
> = {
  full: {
    label: 'In sync with audiobook',
    icon: 'synced',
    tone: 'info',
    description: 'Reading and listening follow each other here.',
  },
  partial: {
    label: 'Partly in sync',
    icon: 'synced',
    tone: 'neutral',
    description: 'Move to synchronized text to listen from here.',
  },
  none: {
    label: 'Not in sync here',
    icon: 'linkOff',
    tone: 'neutral',
    description: 'Synchronization is unavailable in this section.',
  },
};

/**
 * Two small answers in one place: is my place saved to the server, and can
 * reading and listening follow each other here. They stay separate pills so
 * neither claims the other's meaning. The save icon pops in whenever the
 * state changes, so a fresh "Synced" is noticeable without being loud.
 */
export function SyncIndicator({
  save,
  narration,
}: {
  save: SaveStatusState;
  narration?: NarrationSync;
}) {
  const colors = useThemeColors();
  const display = SAVE_DISPLAY[save];
  const saveClass = TONE_CLASS[display.tone];

  return (
    <View className="flex-row flex-wrap items-center justify-center gap-2">
      <View
        accessibilityLiveRegion="polite"
        accessibilityLabel={saveStatusView(save, 'read').label}
        className={`h-7 flex-row items-center gap-1.5 rounded-pill px-3 ${saveClass.surface}`}
      >
        <AnimatedView key={save} entering={popIn} className="items-center justify-center">
          {save === 'saving' ? (
            <ActivityIndicator size="small" color={colors.neutral} />
          ) : display.icon ? (
            <AppIcon name={display.icon} size={14} color={toneColor(colors, display.tone)} />
          ) : null}
        </AnimatedView>
        <Text className={`text-xs font-sans-semibold ${saveClass.text}`}>{display.label}</Text>
      </View>

      {narration ? <NarrationPill narration={narration} colors={colors} /> : null}
    </View>
  );
}

function NarrationPill({ narration, colors }: { narration: NarrationSync; colors: ThemeColors }) {
  const display = NARRATION_DISPLAY[narration];
  const toneClass = TONE_CLASS[display.tone];

  return (
    <View
      accessibilityLabel={`${display.label}. ${display.description}`}
      className={`h-7 flex-row items-center gap-1.5 rounded-pill px-3 ${toneClass.surface}`}
    >
      <AppIcon name={display.icon} size={14} color={toneColor(colors, display.tone)} />
      <Text className={`text-xs font-sans-medium ${toneClass.text}`}>{display.label}</Text>
    </View>
  );
}

function toneColor(colors: ThemeColors, tone: Tone) {
  return colors[tone];
}
