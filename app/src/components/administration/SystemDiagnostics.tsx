import { AppIcon, type AppIconName } from '@/components/ui/icons';
import { useThemeColors } from '@/components/ui/theme';
import { Text, View } from '@/components/ui/tw';

export function DiagnosticRow({
  label,
  detail,
  healthy,
  optional = false,
}: {
  label: string;
  detail: string;
  healthy: boolean;
  optional?: boolean;
}) {
  const colors = useThemeColors();
  let status: { label: string; icon: AppIconName; color: string; textClass: string } = {
    label: 'Needs attention',
    icon: 'warning',
    color: colors.danger,
    textClass: 'text-danger',
  };
  if (optional) {
    status = {
      label: 'Not configured',
      icon: 'disabled',
      color: colors.muted,
      textClass: 'text-muted',
    };
  }
  if (healthy) {
    status = {
      label: 'Healthy',
      icon: 'enabled',
      color: colors.success,
      textClass: 'text-success',
    };
  }

  return (
    <View className="min-h-14 flex-row flex-wrap items-center justify-between gap-3 border-b border-line-subtle py-3">
      <View className="min-w-0 flex-1 gap-1">
        <Text className="font-sans-semibold text-ink">{label}</Text>
        <Text className="text-sm text-muted">{detail}</Text>
      </View>
      <View className="flex-row items-center gap-1.5">
        <AppIcon name={status.icon} size={15} color={status.color} />
        <Text className={`text-xs font-sans-semibold ${status.textClass}`}>{status.label}</Text>
      </View>
    </View>
  );
}

export function DiagnosticMeta({ label, value }: { label: string; value: string }) {
  return (
    <View className="gap-1">
      <Text className="text-xs font-sans-bold uppercase tracking-wide text-subtle">{label}</Text>
      <Text selectable className="text-sm text-ink">
        {value}
      </Text>
    </View>
  );
}
