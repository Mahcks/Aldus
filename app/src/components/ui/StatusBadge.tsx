import { AppIcon, type AppIconName } from './icons';
import { useThemeColors, type ThemeColors } from './theme';
import { Text, View } from './tw';

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const STATUS_BADGE_TONE_CLASS: Record<StatusTone, { background: string; text: string }> = {
  neutral: { background: 'bg-neutral-soft', text: 'text-neutral' },
  info: { background: 'bg-info-soft', text: 'text-info' },
  success: { background: 'bg-success-soft', text: 'text-success' },
  warning: { background: 'bg-warning-soft', text: 'text-warning' },
  danger: { background: 'bg-danger-soft', text: 'text-danger' },
};

function statusBadgeToneColor(colors: ThemeColors): Record<StatusTone, string> {
  return {
    neutral: colors.neutral,
    info: colors.info,
    success: colors.success,
    warning: colors.warning,
    danger: colors.danger,
  };
}

/** Quiet status labels share tone and geometry across consumer and admin screens. */
export function StatusBadge({
  tone = 'neutral',
  label,
  icon,
}: {
  tone?: StatusTone;
  label: string;
  icon?: AppIconName;
}) {
  const colors = useThemeColors();
  const toneClass = STATUS_BADGE_TONE_CLASS[tone];

  return (
    <View className={`flex-row items-center self-start rounded-control ${toneClass.background}`}>
      <View className="flex-row items-center gap-1.5 px-2 py-1">
        {icon ? <AppIcon name={icon} size={12} color={statusBadgeToneColor(colors)[tone]} /> : null}
        <Text className={`text-xs font-sans-medium ${toneClass.text}`}>{label}</Text>
      </View>
    </View>
  );
}
