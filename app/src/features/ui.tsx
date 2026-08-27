import { useEffect, useId, useRef, useState, type PropsWithChildren, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  useWindowDimensions,
} from 'react-native';
import Animated from 'react-native-reanimated';
import Head from 'expo-router/head';
import { AppIcon, type AppIconName } from './icons';
import { fadeIn } from './motion';
import { colors } from './theme';
import { Pressable, ScrollView, Text, TextInput, View, type TextInputProps } from './tw';

export { colors } from './theme';

/**
 * `shared` is a map of Tailwind className strings (not StyleSheet objects).
 * Screens still using the legacy `style={shared.x}` pattern need updating to
 * `className={shared.x}` when they're migrated to NativeWind in later phases.
 */
export const shared = {
  listItem: 'min-h-11 border-b border-line py-3.5 gap-1',
  itemTitle: 'text-base font-sans-bold text-ink',
  itemMeta: 'text-sm text-muted',
  form: 'max-w-[560px] gap-3',
  split: 'flex-row flex-wrap gap-6',
  grow: 'flex-grow basis-[360px]',
  mono: 'text-muted font-mono text-xs',
};

type ButtonKind = 'primary' | 'secondary' | 'danger' | 'quiet';
type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';
type NoticeTone = 'info' | 'warning' | 'success' | 'danger';

function resolveButtonBackgroundClass({
  kind,
  selected,
  pressed,
  inactive,
}: {
  kind: ButtonKind;
  selected: boolean;
  pressed: boolean;
  inactive: boolean;
}) {
  if (inactive && kind !== 'quiet') return 'bg-panel-strong';
  if (selected) return 'bg-accent-soft';
  if (kind === 'primary') return pressed ? 'bg-accent-strong' : 'bg-accent';
  if (kind === 'danger') return pressed ? 'bg-danger-soft' : 'bg-transparent';
  if (kind === 'quiet') return pressed ? 'bg-panel' : 'bg-transparent';
  return pressed ? 'bg-panel' : 'bg-paper';
}

function resolveButtonBorderClass({
  kind,
  selected,
  focused,
  inactive,
}: {
  kind: ButtonKind;
  selected: boolean;
  focused: boolean;
  inactive: boolean;
}) {
  if (focused) return 'border-2 border-focus';
  if (inactive && kind !== 'quiet') return 'border border-line-strong';
  if (selected) return 'border border-accent';
  if (kind === 'primary') return 'border border-accent';
  if (kind === 'danger') return 'border border-danger';
  if (kind === 'quiet') return 'border border-transparent';
  return 'border border-line-strong';
}

function resolveButtonTextClass({
  kind,
  selected,
  inactive,
}: {
  kind: ButtonKind;
  selected: boolean;
  inactive: boolean;
}) {
  if (inactive && kind !== 'quiet') return 'text-subtle';
  if (selected) return 'text-accent-strong';
  if (kind === 'primary') return 'text-on-accent';
  if (kind === 'danger') return 'text-danger';
  if (kind === 'quiet') return 'text-accent';
  return 'text-ink';
}

function resolveButtonIconColor({
  kind,
  selected,
  inactive,
}: {
  kind: ButtonKind;
  selected: boolean;
  inactive: boolean;
}) {
  if (inactive && kind !== 'quiet') return colors.subtle;
  if (selected) return colors.accentStrong;
  if (kind === 'primary') return colors.onAccent;
  if (kind === 'danger') return colors.danger;
  if (kind === 'quiet') return colors.accent;
  return colors.ink;
}

/**
 * Solid/outlined buttons get a soft lift so they read as physical controls
 * rather than flat HTML rectangles; `quiet` and `danger` stay flat by design
 * (quiet is meant to read as text, danger already reads via its red outline).
 * Radiogroup members (Select, filter chips, …) stay flat too — a shadow on
 * every pill in a row makes each one float individually instead of reading
 * as one connected control; the selected pill's accent border/fill already
 * carries the distinction.
 */
function resolveButtonShadowClass({
  kind,
  inactive,
  pressed,
  grouped,
}: {
  kind: ButtonKind;
  inactive: boolean;
  pressed: boolean;
  grouped: boolean;
}) {
  if (inactive || pressed || grouped) return '';
  if (kind === 'primary') return 'shadow-sm';
  if (kind === 'secondary') return 'shadow-xs';
  return '';
}

/**
 * Generic press/focus feedback for plain `Pressable`-based controls that
 * don't go through `Button`/`IconButton` (nav links, tab bar items, custom
 * rows). Keeps every hand-rolled interactive element responding the same way.
 */
export function resolvePressStateClass({
  focused,
  pressed,
}: {
  focused: boolean;
  pressed: boolean;
}) {
  if (focused) return 'outline outline-2 outline-focus';
  if (pressed) return 'opacity-75';
  return '';
}

export function Button({
  label,
  onPress,
  kind = 'secondary',
  disabled,
  selected = false,
  icon,
  iconOnly,
  loading,
  accessibilityRole = 'button',
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  selected?: boolean;
  icon?: AppIconName;
  iconOnly?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
  /** Override for use inside a radiogroup or tablist. */
  accessibilityRole?: 'button' | 'radio' | 'tab';
}) {
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const handleFocus = () => setFocused(true);
  const handleBlur = () => setFocused(false);
  const handlePressIn = () => setPressed(true);
  const handlePressOut = () => setPressed(false);

  const isInactive = Boolean(disabled || loading);
  const backgroundClass = resolveButtonBackgroundClass({
    kind,
    selected,
    pressed,
    inactive: isInactive,
  });
  const borderClass = resolveButtonBorderClass({ kind, selected, focused, inactive: isInactive });
  const textClass = resolveButtonTextClass({ kind, selected, inactive: isInactive });
  const iconColor = resolveButtonIconColor({ kind, selected, inactive: isInactive });
  const shadowClass = resolveButtonShadowClass({
    kind,
    inactive: isInactive,
    pressed,
    grouped: accessibilityRole === 'radio' || accessibilityRole === 'tab',
  });
  const paddingClass = kind === 'quiet' ? 'px-2' : 'px-4';
  const inactiveClass = isInactive ? 'opacity-50' : '';

  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel || label}
      accessibilityState={{
        disabled: isInactive,
        selected: accessibilityRole === 'radio' ? undefined : selected,
        checked: accessibilityRole === 'radio' ? selected : undefined,
        busy: loading,
      }}
      disabled={isInactive}
      onBlur={handleBlur}
      onFocus={handleFocus}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={onPress}
      className={`will-change-variable min-h-11 flex-row items-center justify-center gap-2 rounded-control py-2.5 ${paddingClass} ${backgroundClass} ${borderClass} ${shadowClass} ${inactiveClass}`}
    >
      {loading ? (
        <ActivityIndicator color={kind === 'primary' ? colors.onAccent : colors.accent} />
      ) : (
        <>
          {icon ? <AppIcon name={icon} size={18} color={iconColor} /> : null}
          {iconOnly ? null : <Text className={`text-sm font-sans-bold ${textClass}`}>{label}</Text>}
        </>
      )}
    </Pressable>
  );
}

/**
 * Preferred primitive for icon-only actions. `label` is required and becomes
 * the accessibility label — prefer this over `Button`'s `iconOnly` prop,
 * which remains only for backward compatibility during the NativeWind
 * migration.
 */
export function IconButton({
  icon,
  label,
  onPress,
  kind = 'secondary',
  disabled,
  selected = false,
  nativeID,
  size = 'default',
}: {
  icon: AppIconName;
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  selected?: boolean;
  nativeID?: string;
  size?: 'default' | 'large';
}) {
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const handleFocus = () => setFocused(true);
  const handleBlur = () => setFocused(false);
  const handlePressIn = () => setPressed(true);
  const handlePressOut = () => setPressed(false);

  const backgroundClass = resolveButtonBackgroundClass({
    kind,
    selected,
    pressed,
    inactive: Boolean(disabled),
  });
  const borderClass = resolveButtonBorderClass({
    kind,
    selected,
    focused,
    inactive: Boolean(disabled),
  });
  const iconColor = resolveButtonIconColor({ kind, selected, inactive: Boolean(disabled) });
  const shadowClass = resolveButtonShadowClass({
    kind,
    inactive: Boolean(disabled),
    pressed,
    grouped: false,
  });
  const opacityClass = disabled ? 'opacity-50' : '';

  const sizeClass = size === 'large' ? 'h-16 w-16 rounded-pill' : 'h-11 w-11 rounded-control';

  return (
    <Pressable
      nativeID={nativeID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onBlur={handleBlur}
      onFocus={handleFocus}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={onPress}
      className={`will-change-variable ${sizeClass} items-center justify-center ${backgroundClass} ${borderClass} ${shadowClass} ${opacityClass}`}
    >
      <AppIcon name={icon} size={size === 'large' ? 30 : 20} color={iconColor} />
    </Pressable>
  );
}

/** Accessible radiogroup of mutually-exclusive pill/chip choices. */
export function Select({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View className="gap-1.5">
      <Text className="text-sm font-sans-semibold text-ink">{label}</Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        className="flex-row flex-wrap items-center gap-2"
      >
        {options.map((option) => (
          <Button
            key={option.value}
            label={option.label}
            kind="secondary"
            selected={option.value === value}
            accessibilityRole="radio"
            onPress={() => onChange(option.value)}
          />
        ))}
      </View>
    </View>
  );
}

function resolveFieldBorderClass({ focused, error }: { focused: boolean; error: boolean }) {
  if (focused) return 'border-2 border-focus';
  if (error) return 'border-2 border-danger';
  return 'border-2 border-line';
}

/** Inputs are inset — darker than their surroundings until focused, when they lift to paper. */
function resolveFieldBackgroundClass({ focused }: { focused: boolean }) {
  return focused ? 'bg-control-focus' : 'bg-control';
}

export function Field({
  label,
  help,
  error,
  ...props
}: TextInputProps & { label: string; help?: string; error?: string }) {
  const [focused, setFocused] = useState(false);

  const handleBlur: TextInputProps['onBlur'] = (event) => {
    setFocused(false);
    props.onBlur?.(event);
  };

  const handleFocus: TextInputProps['onFocus'] = (event) => {
    setFocused(true);
    props.onFocus?.(event);
  };

  const borderClass = resolveFieldBorderClass({ focused, error: Boolean(error) });
  const backgroundClass = resolveFieldBackgroundClass({ focused });

  return (
    <View className="gap-1.5">
      <Text className="text-sm font-sans-semibold text-ink">{label}</Text>
      {/*
        `text-base` carries a 24px line-height against a 16px font — fine for
        paragraph text, but on iOS a single-line TextInput doesn't distribute
        that extra leading evenly the way a Text node does; it pushes the
        glyphs toward the top of the box instead of centering them.
        `text-[16px]` below sets only the font size, no companion
        line-height, which is what actually centers it. Android has the
        opposite failure mode for the same "box taller than the text" setup —
        `textAlignVertical` (an Android-only prop, no-op on iOS) covers that
        side, and multiline fields stay top-aligned.
      */}
      <TextInput
        {...props}
        accessibilityLabel={label}
        onBlur={handleBlur}
        onFocus={handleFocus}
        placeholderTextColor={colors.subtle}
        textAlignVertical={props.multiline ? 'top' : 'center'}
        className={`min-h-11 rounded-control px-3 py-2 text-[16px] text-ink outline-none ${backgroundClass} ${borderClass}`}
      />
      {error || help ? (
        <Text
          accessibilityRole={error ? 'alert' : undefined}
          className={`text-xs ${error ? 'text-danger' : 'text-muted'}`}
        >
          {error || help}
        </Text>
      ) : null}
    </View>
  );
}

/** Same component as `Field`, exported under the name used by the design plan. */
export const TextField = Field;

/** Labeled search input with a leading search icon, for library search boxes. */
export function SearchField({
  label = 'Search',
  value,
  onChangeText,
  onSubmit,
  placeholder,
}: {
  label?: string;
  value: string;
  onChangeText: (value: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
}) {
  const [focused, setFocused] = useState(false);

  const handleFocus = () => setFocused(true);
  const handleBlur = () => setFocused(false);

  const borderClass = resolveFieldBorderClass({ focused, error: false });
  const backgroundClass = resolveFieldBackgroundClass({ focused });

  return (
    <View className="gap-1.5">
      <Text className="text-sm font-sans-semibold text-ink">{label}</Text>
      <View
        className={`min-h-11 flex-row items-center gap-2 rounded-control px-3 ${backgroundClass} ${borderClass}`}
      >
        <AppIcon name="search" size={18} color={colors.subtle} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmit}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={placeholder}
          placeholderTextColor={colors.subtle}
          accessibilityLabel={label}
          returnKeyType="search"
          textAlignVertical="center"
          className="min-h-11 flex-1 py-2 text-[16px] text-ink outline-none"
        />
      </View>
    </View>
  );
}

export function Checkbox({
  label,
  checked,
  onPress,
}: {
  label: string;
  checked: boolean;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const handleFocus = () => setFocused(true);
  const handleBlur = () => setFocused(false);
  const handlePressIn = () => setPressed(true);
  const handlePressOut = () => setPressed(false);

  const boxClass = checked ? 'border-accent bg-accent' : 'border-line bg-paper';
  const stateClass = resolvePressStateClass({ focused, pressed });

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onBlur={handleBlur}
      onFocus={handleFocus}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={onPress}
      className={`min-h-11 flex-row items-center gap-2 rounded-control ${stateClass}`}
    >
      <View className={`h-6 w-6 items-center justify-center rounded-control border ${boxClass}`}>
        {checked ? <AppIcon name="check" size={16} color={colors.onAccent} /> : null}
      </View>
      <Text className="text-base text-ink">{label}</Text>
    </Pressable>
  );
}

/** Single radio item, for custom radiogroups (role pickers, destination pickers, …). */
export function Radio({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const handleFocus = () => setFocused(true);
  const handleBlur = () => setFocused(false);
  const handlePressIn = () => setPressed(true);
  const handlePressOut = () => setPressed(false);

  const ringClass = selected ? 'border-accent' : 'border-line';
  const stateClass = resolvePressStateClass({ focused, pressed });

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onBlur={handleBlur}
      onFocus={handleFocus}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={onPress}
      className={`min-h-11 flex-row items-center gap-2 rounded-control ${stateClass}`}
    >
      <View
        className={`h-6 w-6 items-center justify-center rounded-full border bg-paper ${ringClass}`}
      >
        {selected ? <View className="h-3 w-3 rounded-full bg-accent" /> : null}
      </View>
      <Text className="text-base text-ink">{label}</Text>
    </Pressable>
  );
}

function noop() {
  // Swallows presses on dialog content so they don't bubble to the backdrop.
}

/**
 * Shared modal primitive. Replaces one-off `Modal` wrappers throughout the
 * app. Dismisses on backdrop press; on web, Escape closes it and focus moves
 * into the dialog on open and is restored to the previously focused element
 * on close.
 */
export function Dialog({
  visible,
  onClose,
  title,
  children,
  wide,
}: PropsWithChildren<{
  visible: boolean;
  onClose: () => void;
  title: string;
  wide?: boolean;
}>) {
  const closeButtonId = useId();
  const titleId = useId();
  const previouslyFocusedRef = useRef<{ focus: () => void } | null>(null);
  const { height: windowHeight } = useWindowDimensions();

  useEffect(() => {
    if (Platform.OS !== 'web' || !visible) return;

    previouslyFocusedRef.current = document.activeElement as { focus: () => void } | null;
    const focusTimer = setTimeout(() => {
      document.getElementById(closeButtonId)?.focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
      previouslyFocusedRef.current?.focus();
    };
  }, [visible, closeButtonId, onClose]);

  if (!visible) return null;

  const maxWidthClass = wide ? 'max-w-[720px]' : 'max-w-[480px]';
  const dialogMaxHeight = Math.max(0, windowHeight - 32);

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      {/*
       * Modal renders in its own native window on Android, so the activity's
       * automatic keyboard resize never reaches content inside it — without
       * this, the keyboard simply covers whatever field is focused. `padding`
       * on iOS avoids the double-adjustment that `height` causes there.
       */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <View className="flex-1 items-center justify-center p-4">
          {/*
           * The backdrop is a plain (non-button) Pressable positioned behind the
           * dialog content, not a wrapping ancestor of it — an ancestor with
           * accessibilityRole="button" renders as an actual <button> on web,
           * which would illegally nest the dialog's own interactive controls
           * (e.g. the Close IconButton) inside it. Escape and the visible Close
           * button remain the accessible dismiss paths; this is a supplementary
           * pointer convenience only, so it intentionally carries no button role.
           */}
          <Pressable
            accessibilityLabel="Dismiss dialog"
            onPress={onClose}
            className="absolute inset-0 bg-ink/40"
          />
          <Animated.View entering={fadeIn} style={{ width: '100%', alignItems: 'center' }}>
            <Pressable
              onPress={noop}
              accessibilityViewIsModal
              aria-labelledby={titleId}
              role="dialog"
              style={{ maxHeight: dialogMaxHeight }}
              className={`w-full overflow-hidden rounded-dialog border border-line bg-raised shadow-popover ${maxWidthClass}`}
            >
              <View className="flex-row items-center justify-between gap-4 border-b border-line px-6 py-3">
                <Text
                  nativeID={titleId}
                  accessibilityRole="header"
                  className="flex-shrink text-lg font-sans-bold text-ink"
                >
                  {title}
                </Text>
                <IconButton
                  icon="close"
                  label="Close dialog"
                  kind="quiet"
                  onPress={onClose}
                  nativeID={closeButtonId}
                />
              </View>
              <ScrollView
                className="min-h-0 flex-shrink px-6 py-4"
                contentContainerClassName="pb-1"
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator
              >
                {children}
              </ScrollView>
            </Pressable>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * Shared confirmation dialog. Replaces raw `Alert.alert` confirms used for
 * destructive actions (remove member, delete library, delete source, …).
 */
export function ConfirmDialog({
  visible,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  danger,
  busy,
}: {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
}) {
  return (
    <Dialog visible={visible} onClose={onClose} title={title}>
      <View className="gap-6">
        <Text className="text-base leading-6 text-muted">{description}</Text>
        <Row>
          <Button label="Cancel" kind="secondary" onPress={onClose} disabled={busy} />
          <Button
            label={confirmLabel}
            kind={danger ? 'danger' : 'primary'}
            onPress={onConfirm}
            loading={busy}
          />
        </Row>
      </View>
    </Dialog>
  );
}

const NOTICE_TONE_TEXT_CLASS: Record<NoticeTone, string> = {
  info: 'text-info',
  warning: 'text-warning',
  success: 'text-success',
  danger: 'text-danger',
};

export function Notice({
  children,
  danger,
  tone,
}: PropsWithChildren<{ danger?: boolean; tone?: NoticeTone }>) {
  const resolvedTone: NoticeTone | undefined = danger ? 'danger' : tone;
  const textClass = resolvedTone ? NOTICE_TONE_TEXT_CLASS[resolvedTone] : 'text-muted';

  return (
    <Text
      accessibilityRole={resolvedTone === 'danger' ? 'alert' : undefined}
      className={`text-base leading-5 ${textClass}`}
    >
      {children}
    </Text>
  );
}

export function Empty({ children }: PropsWithChildren) {
  return <Text className="py-4 text-muted">{children}</Text>;
}

/** Shared body for `EmptyState`/`ErrorState` — same layout, only icon/tone/default-title differ. */
function StateBlock({
  icon,
  iconBackgroundClass,
  iconColor,
  title,
  children,
  action,
  titleIsHeader = true,
}: PropsWithChildren<{
  icon: AppIconName;
  iconBackgroundClass: string;
  iconColor: string;
  title: string;
  action?: ReactNode;
  titleIsHeader?: boolean;
}>) {
  return (
    <View
      accessibilityLiveRegion="polite"
      className="min-h-[180px] max-w-[420px] items-center justify-center gap-3 self-center py-4"
    >
      <View
        className={`h-14 w-14 items-center justify-center rounded-full shadow-xs ${iconBackgroundClass}`}
      >
        <AppIcon name={icon} size={28} color={iconColor} />
      </View>
      <Text
        accessibilityRole={titleIsHeader ? 'header' : undefined}
        className="text-center text-lg font-sans-bold text-ink"
      >
        {title}
      </Text>
      <Text className="text-center text-base leading-6 text-muted">{children}</Text>
      {action}
    </View>
  );
}

export function EmptyState({
  icon = 'read',
  title,
  children,
  action,
}: PropsWithChildren<{
  icon?: AppIconName;
  title: string;
  action?: ReactNode;
}>) {
  return (
    <StateBlock
      icon={icon}
      iconBackgroundClass="bg-neutral-soft"
      iconColor={colors.neutral}
      title={title}
      action={action}
      titleIsHeader={false}
    >
      {children}
    </StateBlock>
  );
}

/** Same shape as `EmptyState` but for genuine error conditions, not "nothing here yet". */
export function ErrorState({
  title = 'Something went wrong',
  children,
  action,
}: PropsWithChildren<{
  title?: string;
  action?: ReactNode;
}>) {
  return (
    <StateBlock
      icon="error"
      iconBackgroundClass="bg-danger-soft"
      iconColor={colors.danger}
      title={title}
      action={action}
    >
      {children}
    </StateBlock>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  const compact = useWindowDimensions().width < 600;
  const placeholders = compact ? [0, 1] : [0, 1, 2, 3];

  return (
    <View
      accessibilityLabel={label}
      className="min-h-[240px] w-full overflow-hidden px-4 py-4 opacity-60"
    >
      <View className="gap-3">
        <View className="h-5 w-36 rounded-control bg-panel-strong" />
        <View className="flex-row gap-5">
          {placeholders.map((item) => (
            <View key={item} className="w-[148px] gap-2">
              <View className="h-[218px] rounded-control bg-panel-strong" />
              <View className="h-3 rounded-control bg-panel-strong" />
              <View className="h-3 w-2/3 rounded-control bg-panel-strong" />
            </View>
          ))}
        </View>
      </View>
      <Text className="mt-8 text-sm text-muted">{label}</Text>
    </View>
  );
}

/**
 * Page-agnostic boot state for the session check that runs before any route
 * is known — `AuthGate` and the root redirect. Deliberately not
 * `LoadingState`: that renders a shelf-of-book-cards skeleton shaped for a
 * library grid, which is wrong for most destinations (Account, Users,
 * Acquisitions, …) and, worse, back-to-back with the destination page's own
 * `LoadingState` reads as two different skeletons flashing in succession.
 * This is a brief brand moment, not a content placeholder.
 */
export function AppBootState() {
  return (
    <View className="min-h-full flex-1 items-center justify-center gap-3 bg-canvas">
      <Text className="font-editorial-bold text-2xl text-accent">Aldus</Text>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

/** `Loading` is kept as an alias of `LoadingState` for existing imports. */
export const Loading = LoadingState;

const STATUS_BADGE_TONE_CLASS: Record<
  StatusTone,
  { background: string; text: string; spine: string }
> = {
  neutral: { background: 'bg-neutral-soft', text: 'text-neutral', spine: 'bg-neutral' },
  info: { background: 'bg-info-soft', text: 'text-info', spine: 'bg-info' },
  success: { background: 'bg-success-soft', text: 'text-success', spine: 'bg-success' },
  warning: { background: 'bg-warning-soft', text: 'text-warning', spine: 'bg-warning' },
  danger: { background: 'bg-danger-soft', text: 'text-danger', spine: 'bg-danger' },
};

const STATUS_BADGE_TONE_COLOR: Record<StatusTone, string> = {
  neutral: colors.neutral,
  info: colors.info,
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
};

/**
 * Aldus's signature status treatment — a "spine label," styled after the
 * color-coded spine tag on a library book, not a generic rounded pill. A
 * solid 3px tone spine sits flush against the left edge; the tag only
 * rounds on the right, where it lifts off the page. Used for Read/Listen/
 * Synced, source health, scan state, import proposals, and role/status —
 * never for decorative metadata.
 */
export function StatusBadge({
  tone = 'neutral',
  label,
  icon,
}: {
  tone?: StatusTone;
  label: string;
  icon?: AppIconName;
}) {
  const toneClass = STATUS_BADGE_TONE_CLASS[tone];

  return (
    <View
      className={`flex-row items-stretch self-start overflow-hidden rounded-r-control ${toneClass.background}`}
    >
      <View className={`w-[3px] ${toneClass.spine}`} />
      <View className="flex-row items-center gap-1.5 py-1 pl-1.5 pr-2">
        {icon ? <AppIcon name={icon} size={12} color={STATUS_BADGE_TONE_COLOR[tone]} /> : null}
        <Text className={`text-[11px] font-sans-bold uppercase tracking-wide ${toneClass.text}`}>
          {label}
        </Text>
      </View>
    </View>
  );
}

export function Row({ children }: PropsWithChildren) {
  return <View className="flex-row flex-wrap items-center gap-2">{children}</View>;
}

/**
 * Navigable list row for independently actionable objects (Libraries, and
 * similar collections outside the Work/book presentation in `bookshelf.tsx`):
 * an icon badge, title, optional subtitle, and a trailing chevron.
 */
export function IconRow({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: AppIconName;
  title: string;
  subtitle?: string;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const handleFocus = () => setFocused(true);
  const handleBlur = () => setFocused(false);
  const handlePressIn = () => setPressed(true);
  const handlePressOut = () => setPressed(false);
  const stateClass = resolvePressStateClass({ focused, pressed });

  return (
    <Pressable
      accessibilityRole="link"
      onBlur={handleBlur}
      onFocus={handleFocus}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={onPress}
      className={`min-h-11 flex-row items-center gap-4 rounded-card border border-line bg-paper px-4 py-3.5 shadow-xs ${stateClass}`}
    >
      <View className="min-w-0 flex-1 flex-row items-center gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-full bg-accent-soft">
          <AppIcon name={icon} size={18} color={colors.accent} />
        </View>
        <View className="min-w-0 flex-1 gap-0.5">
          <Text numberOfLines={1} className="text-base font-sans-bold text-ink">
            {title}
          </Text>
          {subtitle ? (
            <Text numberOfLines={1} className="text-sm text-muted">
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      <AppIcon name="chevron" size={20} color={colors.subtle} />
    </Pressable>
  );
}

/**
 * App-level page header: title, optional back control, and at most one
 * obvious primary action row. Extracted from `Page` so it can be reused
 * independently if a screen ever needs the header without the scroll shell.
 */
export function PageHeader({
  title,
  actions,
  back,
  compact,
  editorial = true,
}: {
  title: string;
  actions?: ReactNode;
  back?: ReactNode;
  compact: boolean;
  /** Consumer screens show the Work/Library title in editorial serif; administration titles ("Sources & imports", "Users", "Manage · …") are operational text and use system sans instead. */
  editorial?: boolean;
}) {
  const paddingClass = compact ? 'px-4' : 'px-6';
  const layoutClass = compact ? 'items-stretch' : 'items-center';
  const titleSizeClass = compact ? 'text-2xl leading-7' : 'text-[26px] leading-8';
  const actionsWidthClass = compact ? 'w-full' : '';
  const titleFontClass = editorial ? 'font-editorial-bold' : 'font-sans-bold';

  return (
    <View
      className={`min-h-[72px] flex-row flex-wrap justify-between gap-3 border-b border-line py-3 ${paddingClass} ${layoutClass}`}
    >
      <View className="min-w-0 flex-row items-center gap-2.5">
        {back}
        <Text
          accessibilityRole="header"
          className={`flex-shrink text-ink ${titleFontClass} ${titleSizeClass}`}
        >
          {title}
        </Text>
      </View>
      {actions ? (
        <View className={`flex-row flex-wrap items-center gap-2 ${actionsWidthClass}`}>
          {actions}
        </View>
      ) : null}
    </View>
  );
}

export function Page({
  children,
  title,
  actions,
  back,
  hideHeader = false,
  editorial = true,
}: PropsWithChildren<{
  title: string;
  actions?: ReactNode;
  back?: ReactNode;
  hideHeader?: boolean;
  /** See `PageHeader`'s `editorial` prop — set false for administration screens. */
  editorial?: boolean;
}>) {
  const compact = useWindowDimensions().width < 600;
  const contentPaddingClass = compact ? 'gap-6 px-4 py-6' : 'gap-8 px-6 py-8';

  return (
    <SafeAreaView style={{ flex: 1 }}>
      {Platform.OS === 'web' ? (
        <Head>
          <title>{`${title} · Aldus`}</title>
        </Head>
      ) : null}
      <View className="flex-1 bg-canvas">
        {hideHeader ? null : (
          <PageHeader
            title={title}
            actions={actions}
            back={back}
            compact={compact}
            editorial={editorial}
          />
        )}
        <ScrollView
          role="main"
          className="flex-1"
          contentContainerClassName={`w-full max-w-[1240px] flex-grow ${contentPaddingClass}`}
        >
          {children}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View className="min-h-[42px] flex-row items-center justify-between gap-3 border-b border-line">
      <Text accessibilityRole="header" className="text-lg font-sans-bold text-ink">
        {title}
      </Text>
      {action}
    </View>
  );
}

export function Section({
  title,
  action,
  children,
}: PropsWithChildren<{ title: string; action?: ReactNode }>) {
  return (
    <View className="gap-3">
      <SectionHeader title={title} action={action} />
      {children}
    </View>
  );
}
