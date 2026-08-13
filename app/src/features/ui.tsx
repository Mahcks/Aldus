import type { PropsWithChildren, ReactNode } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View, type TextInputProps } from 'react-native';

export const colors = { canvas: '#f4efe6', paper: '#fffdf8', panel: '#ece4d8', panelStrong: '#dfd3c3', ink: '#27211c', muted: '#6c6258', line: '#cbbfb0', accent: '#914027', accentSoft: '#f1ded5', danger: '#8a3028', focus: '#bd6a4e' };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48, huge: 64 };
export const type = StyleSheet.create({ display: { fontFamily: 'Georgia', fontSize: 34, lineHeight: 41, fontWeight: '700' }, pageTitle: { fontFamily: 'Georgia', fontSize: 26, lineHeight: 32, fontWeight: '700' }, sectionTitle: { fontSize: 17, lineHeight: 22, fontWeight: '800' }, body: { fontSize: 15, lineHeight: 22 }, label: { fontSize: 13, lineHeight: 18, fontWeight: '700' }, meta: { fontSize: 13, lineHeight: 18 } });

export function Page({ children, title, actions, back }: PropsWithChildren<{ title: string; actions?: ReactNode; back?: ReactNode }>) {
  const compact = useWindowDimensions().width < 600;
  return <SafeAreaView style={styles.page}><View style={[styles.header, compact && styles.compactHeader]}><View style={styles.heading}>{back}<Text accessibilityRole="header" style={[styles.title, compact && styles.compactTitle]}>{title}</Text></View>{actions ? <View style={[styles.actions, compact && styles.compactActions]}>{actions}</View> : null}</View><ScrollView contentContainerStyle={[styles.content, compact && styles.compactContent]}>{children}</ScrollView></SafeAreaView>;
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
export function Loading({ label = 'Loading your library…' }: { label?: string }) { return <View style={styles.loading}><View style={styles.skeleton}><View style={styles.skeletonCover} /><View style={styles.skeletonLines}><View style={styles.skeletonLine} /><View style={[styles.skeletonLine, styles.skeletonShort]} /></View></View><ActivityIndicator color={colors.accent} /><Text style={styles.muted}>{label}</Text></View>; }
export function Row({ children }: PropsWithChildren) { return <View style={styles.row}>{children}</View>; }

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
  header: { minHeight: 72, paddingHorizontal: space.xl, paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  compactHeader: { alignItems: 'stretch', paddingHorizontal: space.lg }, heading: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 }, title: { color: colors.ink, ...type.pageTitle, flexShrink: 1 }, compactTitle: { fontSize: 22, lineHeight: 27 }, actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm }, compactActions: { width: '100%' },
  content: { width: '100%', maxWidth: 1240, alignSelf: 'center', paddingHorizontal: space.xl, paddingVertical: space.xxl, gap: space.xxl }, compactContent: { paddingHorizontal: space.lg, paddingVertical: space.xl, gap: space.xl },
  section: { gap: space.md }, sectionHeader: { minHeight: 42, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md }, sectionTitle: { color: colors.ink, ...type.sectionTitle },
  field: { gap: 5 }, label: { color: colors.ink, fontSize: 13, fontWeight: '600' }, input: { minHeight: 42, borderWidth: 1, borderColor: '#b7ac9e', borderRadius: 6, backgroundColor: colors.paper, paddingHorizontal: 11, paddingVertical: 9, color: colors.ink, fontSize: 15 },
  button: { minHeight: 42, borderRadius: 6, borderWidth: 1, paddingHorizontal: 15, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' }, buttonText: { fontSize: 13, fontWeight: '800' },
  primaryButton: { backgroundColor: colors.accent, borderColor: colors.accent }, primaryText: { color: '#fffaf2' }, secondaryButton: { backgroundColor: colors.paper, borderColor: '#b7ac9e' }, secondaryText: { color: colors.ink }, dangerButton: { backgroundColor: 'transparent', borderColor: '#9c5547' }, dangerText: { color: colors.danger }, quietButton: { backgroundColor: 'transparent', borderColor: 'transparent', paddingHorizontal: 5 }, quietText: { color: colors.accent },
  disabled: { opacity: 0.45 }, pressed: { opacity: 0.72 }, notice: { color: colors.muted, lineHeight: 20 }, error: { color: colors.danger }, empty: { color: colors.muted, paddingVertical: 18 }, muted: { color: colors.muted }, loading: { flex: 1, minHeight: 240, alignItems: 'center', justifyContent: 'center', gap: space.md }, row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  skeleton: { width: 250, flexDirection: 'row', gap: space.md, opacity: .55 }, skeletonCover: { width: 54, height: 76, backgroundColor: colors.panelStrong }, skeletonLines: { flex: 1, gap: space.sm, justifyContent: 'center' }, skeletonLine: { height: 10, backgroundColor: colors.panelStrong, borderRadius: 3 }, skeletonShort: { width: '62%' },
});
