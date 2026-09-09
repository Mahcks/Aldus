import Animated from 'react-native-reanimated';
import { Text, View } from './tw';
import { AppIcon } from './icons';
import { colors } from './theme';
import { fadeIn } from './motion';

export function ReaderSaveFeedback({ result }: { result: 'saved' | 'offline' | 'restored' }) {
  const restored = result === 'restored';
  const title = restored ? 'Back where you left off' : 'Reading place saved';
  let detail = 'Synced to your server';
  if (result === 'offline') detail = 'On this device · syncs when connected';
  if (restored) detail = 'Your saved passage is highlighted';
  return (
    <Animated.View entering={fadeIn}>
      <View
        accessible
        accessibilityLiveRegion="polite"
        accessibilityLabel={`${title}. ${detail}`}
        className="min-h-12 flex-row items-center gap-2"
      >
        <AppIcon name={restored ? 'read' : 'check'} size={20} color={colors.accent} />
        <View className="min-w-0 shrink gap-0.5">
          <Text className="text-sm font-sans-semibold text-ink">{title}</Text>
          <Text className="text-xs text-muted">{detail}</Text>
        </View>
      </View>
    </Animated.View>
  );
}
