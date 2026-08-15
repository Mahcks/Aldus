/**
 * Shared motion vocabulary for Aldus — mirrors how `theme.ts` centralizes
 * color tokens. A small, fixed set of durations, easing, and Reanimated
 * presets, reused everywhere instead of each screen hand-tuning its own
 * curve. All entrance/exit presets carry `reduceMotion(ReduceMotion.System)`
 * so they automatically resolve to an instant transition when the OS/browser
 * reduced-motion setting is on — no separate per-screen check needed.
 */
import { Easing, FadeIn, ReduceMotion, SlideInDown, SlideOutDown } from 'react-native-reanimated';

/** Quick UI feedback: sheet dismissal, small state changes. */
export const DURATION_QUICK = 150;
/** Standard content transitions: fades, passage changes, list entrances. */
export const DURATION_STANDARD = 180;

/** The one "settling into place" ease-out curve used app-wide. */
export const EASE_STANDARD = Easing.bezier(0.22, 1, 0.36, 1);

/** Content fading into view — Read Along passages, section reveals, … */
export const fadeIn = FadeIn.duration(DURATION_STANDARD)
  .easing(EASE_STANDARD)
  .reduceMotion(ReduceMotion.System);

/** Bottom sheets and slide-up panels entering/exiting. */
export const sheetEnter = SlideInDown.springify().damping(22).reduceMotion(ReduceMotion.System);
export const sheetExit = SlideOutDown.duration(DURATION_QUICK).reduceMotion(ReduceMotion.System);

/**
 * Staggered fade-in for list/grid items. Delay is capped so long lists don't
 * feel slow to settle.
 */
export function listItemEnter(index: number) {
  return FadeIn.duration(DURATION_STANDARD)
    .delay(Math.min(index, 8) * 40)
    .easing(EASE_STANDARD)
    .reduceMotion(ReduceMotion.System);
}
