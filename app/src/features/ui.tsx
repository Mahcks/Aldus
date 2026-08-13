import { useState, type PropsWithChildren, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type TextInputProps,
} from 'react-native';
import { AppIcon, type AppIconName } from './icons';
import { colors } from './theme';

export { colors } from './theme';
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48, huge: 64 };
export const type = StyleSheet.create({
  display: { fontFamily: 'Georgia', fontSize: 34, lineHeight: 41, fontWeight: '700' },
  pageTitle: { fontFamily: 'Georgia', fontSize: 26, lineHeight: 32, fontWeight: '700' },
  sectionTitle: { fontSize: 17, lineHeight: 22, fontWeight: '800' },
  body: { fontSize: 15, lineHeight: 22 },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  meta: { fontSize: 13, lineHeight: 18 },
});

export function Page({
  children,
  title,
  actions,
  back,
}: PropsWithChildren<{ title: string; actions?: ReactNode; back?: ReactNode }>) {
  const compact = useWindowDimensions().width < 600;
  return (
    <SafeAreaView style={styles.page}>
      <View style={[styles.header, compact && styles.compactHeader]}>
        <View style={styles.heading}>
          {back}
          <Text accessibilityRole="header" style={[styles.title, compact && styles.compactTitle]}>
            {title}
          </Text>
        </View>
        {actions ? (
          <View style={[styles.actions, compact && styles.compactActions]}>{actions}</View>
        ) : null}
      </View>
      <ScrollView contentContainerStyle={[styles.content, compact && styles.compactContent]}>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Section({
  title,
  action,
  children,
}: PropsWithChildren<{ title: string; action?: ReactNode }>) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {title}
        </Text>
        {action}
      </View>
      {children}
    </View>
  );
}

export function Field({
  label,
  help,
  error,
  ...props
}: TextInputProps & { label: string; help?: string; error?: string }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...props}
        accessibilityLabel={label}
        onBlur={(event) => {
          setFocused(false);
          props.onBlur?.(event);
        }}
        onFocus={(event) => {
          setFocused(true);
          props.onFocus?.(event);
        }}
        placeholderTextColor="#8a8075"
        style={[
          styles.input,
          props.style,
          error && styles.invalidInput,
          focused && styles.focusedInput,
        ]}
      />
      {error || help ? (
        <Text
          accessibilityRole={error ? 'alert' : undefined}
          style={[styles.help, error && styles.error]}
        >
          {error || help}
        </Text>
      ) : null}
    </View>
  );
}

export function Button({
  label,
  onPress,
  kind = 'secondary',
  disabled,
  selected,
  icon,
  iconOnly,
  loading,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger' | 'quiet';
  disabled?: boolean;
  selected?: boolean;
  icon?: AppIconName;
  iconOnly?: boolean;
  loading?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading, selected, busy: loading }}
      disabled={disabled || loading}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles[`${kind}Button`],
        (disabled || loading) && styles.disabled,
        focused && styles.focused,
        pressed && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={kind === 'primary' ? colors.paper : colors.accent} />
      ) : (
        <>
          {icon ? (
            <AppIcon
              name={icon}
              size={18}
              color={
                kind === 'primary' ? colors.paper : kind === 'danger' ? colors.danger : colors.ink
              }
            />
          ) : null}
          {iconOnly ? null : (
            <Text style={[styles.buttonText, styles[`${kind}Text`]]}>{label}</Text>
          )}
        </>
      )}
    </Pressable>
  );
}

export function Notice({ children, danger }: PropsWithChildren<{ danger?: boolean }>) {
  return (
    <Text
      accessibilityRole={danger ? 'alert' : undefined}
      style={[styles.notice, danger && styles.error]}
    >
      {children}
    </Text>
  );
}
export function Empty({ children }: PropsWithChildren) {
  return <Text style={styles.empty}>{children}</Text>;
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
    <View accessibilityLiveRegion="polite" style={styles.emptyState}>
      <AppIcon name={icon} size={34} color={colors.accent} />
      <Text style={styles.emptyStateTitle}>{title}</Text>
      <Text style={styles.emptyStateText}>{children}</Text>
      {action}
    </View>
  );
}
export function Loading({ label = 'Loading your library…' }: { label?: string }) {
  return (
    <View style={styles.loading}>
      <View style={styles.skeleton}>
        <View style={styles.skeletonCover} />
        <View style={styles.skeletonLines}>
          <View style={styles.skeletonLine} />
          <View style={[styles.skeletonLine, styles.skeletonShort]} />
        </View>
      </View>
      <ActivityIndicator color={colors.accent} />
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}
export function Row({ children }: PropsWithChildren) {
  return <View style={styles.row}>{children}</View>;
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
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={onPress}
      style={styles.checkboxRow}
    >
      <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
        {checked ? <AppIcon name="check" size={16} color={colors.paper} /> : null}
      </View>
      <Text style={styles.checkboxLabel}>{label}</Text>
    </Pressable>
  );
}

export const shared = StyleSheet.create({
  listItem: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 4 },
  itemTitle: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  itemMeta: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  form: { maxWidth: 560, gap: space.md },
  split: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xl },
  grow: { flexGrow: 1, flexBasis: 360 },
  mono: { color: colors.muted, fontFamily: 'monospace', fontSize: 12 },
});

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.canvas },
  header: {
    minHeight: 72,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  compactHeader: { alignItems: 'stretch', paddingHorizontal: space.lg },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  title: { color: colors.ink, ...type.pageTitle, flexShrink: 1 },
  compactTitle: { fontSize: 22, lineHeight: 27 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  compactActions: { width: '100%' },
  content: {
    width: '100%',
    maxWidth: 1240,
    alignSelf: 'center',
    paddingHorizontal: space.xl,
    paddingVertical: space.xxl,
    gap: space.xxl,
  },
  compactContent: { paddingHorizontal: space.lg, paddingVertical: space.xl, gap: space.xl },
  section: { gap: space.md },
  sectionHeader: {
    minHeight: 42,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  sectionTitle: { color: colors.ink, ...type.sectionTitle },
  field: { gap: 5 },
  label: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  input: {
    minHeight: 42,
    borderWidth: 1,
    borderColor: '#b7ac9e',
    borderRadius: 6,
    backgroundColor: colors.paper,
    paddingHorizontal: 11,
    paddingVertical: 9,
    color: colors.ink,
    fontSize: 15,
  },
  focusedInput: { borderColor: colors.focus, borderWidth: 2 },
  invalidInput: { borderColor: colors.danger },
  help: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  button: {
    minHeight: 42,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 15,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: space.sm,
  },
  buttonText: { fontSize: 13, fontWeight: '800' },
  primaryButton: { backgroundColor: colors.accent, borderColor: colors.accent },
  primaryText: { color: '#fffaf2' },
  secondaryButton: { backgroundColor: colors.paper, borderColor: '#b7ac9e' },
  secondaryText: { color: colors.ink },
  dangerButton: { backgroundColor: 'transparent', borderColor: '#9c5547' },
  dangerText: { color: colors.danger },
  quietButton: { backgroundColor: 'transparent', borderColor: 'transparent', paddingHorizontal: 5 },
  quietText: { color: colors.accent },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.72 },
  focused: { borderColor: colors.focus, borderWidth: 2 },
  notice: { color: colors.muted, lineHeight: 20 },
  error: { color: colors.danger },
  empty: { color: colors.muted, paddingVertical: 18 },
  emptyState: {
    minHeight: 180,
    maxWidth: 560,
    justifyContent: 'center',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  emptyStateTitle: { color: colors.ink, ...type.sectionTitle },
  emptyStateText: { color: colors.muted, ...type.body },
  muted: { color: colors.muted },
  loading: {
    flex: 1,
    minHeight: 240,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  checkboxRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  checkbox: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 4,
    backgroundColor: colors.paper,
  },
  checkboxChecked: { borderColor: colors.accent, backgroundColor: colors.accent },
  checkboxLabel: { color: colors.ink, ...type.body },
  skeleton: { width: 250, flexDirection: 'row', gap: space.md, opacity: 0.55 },
  skeletonCover: { width: 54, height: 76, backgroundColor: colors.panelStrong },
  skeletonLines: { flex: 1, gap: space.sm, justifyContent: 'center' },
  skeletonLine: { height: 10, backgroundColor: colors.panelStrong, borderRadius: 3 },
  skeletonShort: { width: '62%' },
});
