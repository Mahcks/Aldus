/**
 * Shared motion vocabulary for Aldus — mirrors how `theme.ts` centralizes
 * color tokens. A small, fixed set of durations, easing, and Reanimated
 * presets, reused everywhere instead of each screen hand-tuning its own
 * curve. All entrance/exit presets carry `reduceMotion(ReduceMotion.System)`
 * so they automatically resolve to an instant transition when the OS/browser
 * reduced-motion setting is on — no separate per-screen check needed.
 */
import {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
  ReduceMotion,
  SlideInDown,
  SlideOutDown,
} from 'react-native-reanimated';

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
export const sheetEnter = SlideInDown.duration(DURATION_STANDARD)
  .easing(EASE_STANDARD)
  .reduceMotion(ReduceMotion.System);
export const sheetExit = SlideOutDown.duration(DURATION_QUICK)
  .easing(EASE_STANDARD)
  .reduceMotion(ReduceMotion.System);

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

/** Content leaving without a slide — the counterpart to `fadeIn`. */
export const fadeOut = FadeOut.duration(DURATION_QUICK).reduceMotion(ReduceMotion.System);

/**
 * A view moving or resizing because its siblings changed (a cover shrinking
 * to make room for text, then growing back). An ease-in-out rather than the
 * app's usual fast-start ease-out: that curve is right for something
 * appearing, but on a large move it lurches and then crawls.
 */
export const layoutShift = LinearTransition.duration(380)
  .easing(Easing.bezier(0.4, 0, 0.2, 1))
  .reduceMotion(ReduceMotion.System);

/**
 * Text that has to change size or alignment can't glide (it would reflow
 * every frame), so it fades out quickly and the new version fades in as the
 * moving parts settle.
 */
export const textSwapExit = FadeOut.duration(100).reduceMotion(ReduceMotion.System);
export const textSwapEnter = FadeIn.duration(220)
  .delay(160)
  .easing(EASE_STANDARD)
  .reduceMotion(ReduceMotion.System);

/**
 * A line of read-along text arriving: it rises a little as it fades in.
 * `rank` is its distance from the phrase being read (0 = that phrase), so the
 * text settles outward from where the eye already is. Capped so a long
 * window still lands quickly.
 */
export function phraseEnter(rank: number) {
  return FadeInDown.duration(340)
    .delay(240 + Math.min(rank, 4) * 80)
    .easing(EASE_STANDARD)
    .reduceMotion(ReduceMotion.System);
}
