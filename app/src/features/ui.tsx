import type { PropsWithChildren, ReactNode } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

export const colors = { canvas: '#f5f0e7', paper: '#fffdf9', panel: '#eee7dc', ink: '#29231d', muted: '#655b51', line: '#c9c0b3', accent: '#8b3a24', danger: '#81392d' };

export function Page({ children, title, actions, back }: PropsWithChildren<{ title: string; actions?: ReactNode; back?: ReactNode }>) {
  return <SafeAreaView style={styles.page}><View style={styles.header}><View style={styles.heading}>{back}<Text accessibilityRole="header" style={styles.title}>{title}</Text></View><View style={styles.actions}>{actions}</View></View><ScrollView contentContainerStyle={styles.content}>{children}</ScrollView></SafeAreaView>;
}

export function Section({ title, action, children }: PropsWithChildren<{ title: string; action?: ReactNode }>) {
  return <View style={styles.section}><View style={styles.sectionHeader}><Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>{action}</View>{children}</View>;
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} placeholderTextColor="#8a8075" style={styles.input} {...props} /></View>;
}

export function Button({ label, onPress, kind = 'secondary', disabled }: { label: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger' | 'quiet'; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, styles[`${kind}Button`], disabled && styles.disabled, pressed && styles.pressed]}><Text style={[styles.buttonText, styles[`${kind}Text`]]}>{label}</Text></Pressable>;
}

export function Notice({ children, danger }: PropsWithChildren<{ danger?: boolean }>) { return <Text accessibilityRole={danger ? 'alert' : undefined} style={[styles.notice, danger && styles.error]}>{children}</Text>; }
export function Empty({ children }: PropsWithChildren) { return <Text style={styles.empty}>{children}</Text>; }
export function Loading() { return <View style={styles.loading}><ActivityIndicator color={colors.accent} /><Text style={styles.muted}>Loading…</Text></View>; }
export function Row({ children }: PropsWithChildren) { return <View style={styles.row}>{children}</View>; }

export const shared = StyleSheet.create({
  listItem: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 4 },
  itemTitle: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  itemMeta: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  form: { maxWidth: 560, gap: 12 },
  split: { flexDirection: 'row', flexWrap: 'wrap', gap: 24 },
  grow: { flexGrow: 1, flexBasis: 360 },
  mono: { color: colors.muted, fontFamily: 'monospace', fontSize: 12 },
});

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.canvas },
  header: { minHeight: 66, paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10 }, title: { color: colors.ink, fontSize: 22, fontWeight: '800' }, actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  content: { width: '100%', maxWidth: 1160, alignSelf: 'center', paddingHorizontal: 20, paddingVertical: 24, gap: 26 },
  section: { gap: 10 }, sectionHeader: { minHeight: 38, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, sectionTitle: { color: colors.ink, fontSize: 17, fontWeight: '700' },
  field: { gap: 5 }, label: { color: colors.ink, fontSize: 13, fontWeight: '600' }, input: { minHeight: 42, borderWidth: 1, borderColor: '#b7ac9e', borderRadius: 6, backgroundColor: colors.paper, paddingHorizontal: 11, paddingVertical: 9, color: colors.ink, fontSize: 15 },
  button: { minHeight: 38, borderRadius: 6, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 9, alignItems: 'center', justifyContent: 'center' }, buttonText: { fontSize: 13, fontWeight: '700' },
  primaryButton: { backgroundColor: colors.accent, borderColor: colors.accent }, primaryText: { color: '#fffaf2' }, secondaryButton: { backgroundColor: colors.paper, borderColor: '#b7ac9e' }, secondaryText: { color: colors.ink }, dangerButton: { backgroundColor: 'transparent', borderColor: '#9c5547' }, dangerText: { color: colors.danger }, quietButton: { backgroundColor: 'transparent', borderColor: 'transparent', paddingHorizontal: 5 }, quietText: { color: colors.accent },
  disabled: { opacity: 0.45 }, pressed: { opacity: 0.72 }, notice: { color: colors.muted, lineHeight: 20 }, error: { color: colors.danger }, empty: { color: colors.muted, paddingVertical: 18 }, muted: { color: colors.muted }, loading: { minHeight: 120, alignItems: 'center', justifyContent: 'center', gap: 10 }, row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
});
