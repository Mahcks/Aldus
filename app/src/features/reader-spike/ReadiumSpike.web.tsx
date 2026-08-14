import { Text, View } from '../tw';

export function ReadiumSpike() {
  return (
    <View className="flex-1 items-center justify-center bg-canvas p-6">
      <Text className="text-base text-ink">
        The Readium renderer spike runs only in a native development build.
      </Text>
    </View>
  );
}
