import { useEffect, useState } from 'react';
import { AppIcon, type AppIconName } from '@/components/ui/icons';
import { useThemeColors, type ThemeColors } from '@/components/ui/theme';
import { Text, View } from '@/components/ui/tw';
import { saveStatusView, type SaveStatusState } from '@/lib/consumption/handoff-copy';

export type ReaderSaveStatus = SaveStatusState | 'idle';

type AttentionTone = 'neutral' | 'warning' | 'danger';

/** A save shorter than this keeps showing the last settled state instead of "Saving…". */
const SLOW_SAVE_MS = 1500;

/** Routine states: plain text, no motion, so turning pages never flickers. */
const QUIET_LABEL: Partial<Record<ReaderSaveStatus, string>> = {
  idle: 'Ready to read',
  saving: 'Saving…',
  saved: 'Saved',
};

/** States the reader should notice: a toned pill with an icon. */
const ATTENTION_DISPLAY: Partial<
  Record<ReaderSaveStatus, { label: string; icon: AppIconName; tone: AttentionTone }>
> = {
  'on-device': { label: 'Saved on this device', icon: 'cloudUpload', tone: 'neutral' },
  error: { label: 'Couldn’t save', icon: 'error', tone: 'danger' },
  paused: { label: 'Not saving', icon: 'warning', tone: 'warning' },
};

const TONE_CLASS: Record<AttentionTone, { surface: string; text: string }> = {
  neutral: { surface: 'bg-neutral-soft', text: 'text-neutral' },
  warning: { surface: 'bg-warning-soft', text: 'text-warning' },
  danger: { surface: 'bg-danger-soft', text: 'text-danger' },
};

/**
 * Whether the reader's place is saved to the server. It never claims "Saved"
 * before the server confirms. Routine saving stays quiet text in a fixed-height
 * slot, so status changes never move the pager; only a problem becomes a pill.
 */
export function SyncIndicator({ save }: { save: ReaderSaveStatus }) {
  const colors = useThemeColors();
  const shown = useCalmSaveStatus(save);
  const attention = ATTENTION_DISPLAY[shown];

  return (
    <View className="h-7 items-center justify-center">
      {attention ? (
        <View
          accessibilityLiveRegion="polite"
          accessibilityLabel={saveStatusView(shown as SaveStatusState, 'read').label}
          className={`h-7 flex-row items-center gap-1.5 rounded-pill px-3 ${TONE_CLASS[attention.tone].surface}`}
        >
          <AppIcon name={attention.icon} size={14} color={toneColor(colors, attention.tone)} />
          <Text className={`text-xs font-sans-semibold ${TONE_CLASS[attention.tone].text}`}>
            {attention.label}
          </Text>
        </View>
      ) : (
        <View className="flex-row items-center gap-1">
          {shown === 'saved' ? <AppIcon name="check" size={12} color={colors.muted} /> : null}
          <Text className="text-xs text-muted">{QUIET_LABEL[shown]}</Text>
        </View>
      )}
    </View>
  );
}

/**
 * Every page turn starts a save that usually finishes within a second. Showing
 * "Saving…" for each one made the pager flicker, so a routine save keeps the
 * last settled state and "Saving…" appears only once a save is actually slow.
 * Problems (error, paused, on-device) still show immediately.
 */
function useCalmSaveStatus(save: ReaderSaveStatus): ReaderSaveStatus {
  const [settled, setSettled] = useState(save);
  const [slow, setSlow] = useState(false);

  // Derived state: remember the latest non-saving state as it arrives.
  if (save !== 'saving' && save !== settled) setSettled(save);

  useEffect(() => {
    if (save !== 'saving') return;
    const timer = setTimeout(() => setSlow(true), SLOW_SAVE_MS);
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [save]);

  if (save === 'saving' && !slow) return settled;
  return save;
}

function toneColor(colors: ThemeColors, tone: AttentionTone) {
  return colors[tone];
}
