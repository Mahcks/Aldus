import { Platform, useWindowDimensions } from 'react-native';

/**
 * True where the app should behave like a website: the web build on a window
 * at least 600px wide. There, menus and choices anchor to their trigger and
 * filters sit inline; phones and native apps keep bottom sheets.
 */
export function usePointerLayout(): boolean {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= 600;
}
