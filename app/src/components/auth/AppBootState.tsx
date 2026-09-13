import { SafeAreaView } from 'react-native-safe-area-context';
import { LoadingState } from '@/components/ui/loading-skeleton';
import { Text, View } from '@/components/ui/tw';

/** Session checks show anonymous placeholders, never another account's data. */
export function AppBootState() {
  return (
    <View className="flex-1 bg-canvas">
      <SafeAreaView>
        <View className="mx-auto w-full max-w-[1240px] px-6">
          <Text className="py-5 font-editorial text-2xl text-ink">Aldus</Text>
          <LoadingState label="Opening your library…" layout="home" />
        </View>
      </SafeAreaView>
    </View>
  );
}
