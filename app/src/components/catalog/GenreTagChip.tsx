import { AppIcon, isAppIconName } from '@/components/ui/icons';
import { useThemeColors } from '@/components/ui/theme';
import { Text, View } from '@/components/ui/tw';

export function GenreTagChip({ icon, label }: { icon: string; label: string }) {
  const colors = useThemeColors();
  return (
    <View className="flex-row items-center gap-1.5 rounded-control border border-line bg-panel px-2.5 py-1.5">
      <AppIcon name={isAppIconName(icon) ? icon : 'genres'} size={15} color={colors.muted} />
      <Text className="text-sm font-sans-semibold text-muted">{label}</Text>
    </View>
  );
}
