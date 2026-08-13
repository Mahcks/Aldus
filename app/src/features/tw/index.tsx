import { useCssElement, useNativeVariable as useFunctionalVariable } from 'react-native-css';

import { Link as RouterLink } from 'expo-router';
import Animated from 'react-native-reanimated';
import React from 'react';
import {
  View as RNView,
  Text as RNText,
  Pressable as RNPressable,
  ScrollView as RNScrollView,
  TextInput as RNTextInput,
} from 'react-native';

/**
 * `useCssElement`'s generic mapping type walks the full (deeply recursive)
 * RN style prop types to validate dot-notation keys. For components with
 * large style unions (`View`, `ScrollView`, the router `Link`) that
 * recursion is expensive enough to blow past TypeScript's instantiation
 * limits, so the component type is narrowed to just the keys the mapping
 * actually references before handing it to `useCssElement`.
 */
type MinimalStyledComponent = React.ComponentType<{
  style?: unknown;
  className?: unknown;
}>;

export const Link = (
  props: React.ComponentProps<typeof RouterLink> & { className?: string },
): React.ReactElement => {
  return useCssElement(RouterLink as unknown as MinimalStyledComponent, props, {
    className: 'style',
  }) as React.ReactElement;
};

export const useCSSVariable =
  process.env.EXPO_OS !== 'web' ? useFunctionalVariable : (variable: string) => `var(${variable})`;

export type ViewProps = React.ComponentProps<typeof RNView> & {
  className?: string;
};

export const View = (props: ViewProps): React.ReactElement => {
  return useCssElement(RNView as unknown as MinimalStyledComponent, props, {
    className: 'style',
  }) as React.ReactElement;
};
View.displayName = 'CSS(View)';

export type TextProps = React.ComponentProps<typeof RNText> & {
  className?: string;
};

export const Text = (props: TextProps): React.ReactElement => {
  return useCssElement(RNText as unknown as MinimalStyledComponent, props, {
    className: 'style',
  }) as React.ReactElement;
};
Text.displayName = 'CSS(Text)';

export type ScrollViewProps = React.ComponentProps<typeof RNScrollView> & {
  className?: string;
  contentContainerClassName?: string;
};

type MinimalStyledScrollComponent = React.ComponentType<{
  style?: unknown;
  contentContainerStyle?: unknown;
  className?: unknown;
  contentContainerClassName?: unknown;
}>;

export const ScrollView = (props: ScrollViewProps): React.ReactElement => {
  return useCssElement(RNScrollView as unknown as MinimalStyledScrollComponent, props, {
    className: 'style',
    contentContainerClassName: 'contentContainerStyle',
  }) as React.ReactElement;
};
ScrollView.displayName = 'CSS(ScrollView)';

export type PressableProps = React.ComponentProps<typeof RNPressable> & {
  className?: string;
};

export const Pressable = (props: PressableProps): React.ReactElement => {
  return useCssElement(RNPressable as unknown as MinimalStyledComponent, props, {
    className: 'style',
  }) as React.ReactElement;
};
Pressable.displayName = 'CSS(Pressable)';

export type TextInputProps = React.ComponentProps<typeof RNTextInput> & {
  className?: string;
};

export const TextInput = (props: TextInputProps): React.ReactElement => {
  return useCssElement(RNTextInput as unknown as MinimalStyledComponent, props, {
    className: 'style',
  }) as React.ReactElement;
};
TextInput.displayName = 'CSS(TextInput)';

export type AnimatedScrollViewProps = React.ComponentProps<typeof Animated.ScrollView> & {
  className?: string;
  contentContainerClassName?: string;
};

export const AnimatedScrollView = (props: AnimatedScrollViewProps): React.ReactElement => {
  return useCssElement(Animated.ScrollView as unknown as MinimalStyledScrollComponent, props, {
    className: 'style',
    contentContainerClassName: 'contentContainerStyle',
  }) as React.ReactElement;
};
AnimatedScrollView.displayName = 'CSS(AnimatedScrollView)';
