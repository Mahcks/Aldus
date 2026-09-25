import { useEffect } from 'react';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { AppIcon } from './icons';
import { EASE_STANDARD } from './motion';

/** A disclosure chevron that turns from pointing right to pointing down as its section opens. */
export function RotatingChevron({
  open,
  size = 18,
  color,
}: {
  open: boolean;
  size?: number;
  color?: string;
}) {
  const progress = useSharedValue(open ? 1 : 0);

  useEffect(() => {
    progress.set(
      withTiming(open ? 1 : 0, {
        duration: 220,
        easing: EASE_STANDARD,
        reduceMotion: ReduceMotion.System,
      }),
    );
  }, [open, progress]);

  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${progress.get() * 90}deg` }],
  }));

  return (
    <Animated.View style={style}>
      <AppIcon name="chevron" size={size} color={color} />
    </Animated.View>
  );
}
