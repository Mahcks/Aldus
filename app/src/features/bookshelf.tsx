import type { PropsWithChildren } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from './ui';

const covers = [
  ['#74402f', '#f7ede1'], ['#48594b', '#f3eee2'], ['#665473', '#f6ecdf'], ['#8a6237', '#fff1dd'], ['#3f5960', '#f4eee3'],
] as const;

export function BookCover({ title, author, compact }: { title: string; author?: string; compact?: boolean }) {
  const palette = covers[hash(title + author) % covers.length];
  const initials = title.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  return <View accessibilityLabel={`Cover for ${title}`} style={[styles.cover, compact && styles.compact, { backgroundColor: palette[0] }]}><View style={[styles.rule, { borderColor: palette[1] }]}><Text numberOfLines={2} style={[styles.initials, compact && styles.compactInitials, { color: palette[1] }]}>{initials || 'A'}</Text></View></View>;
}

export function Badge({ children }: PropsWithChildren) { return <View style={styles.badge}><Text style={styles.badgeText}>{children}</Text></View>; }

function hash(value: string) { let result = 0; for (const character of value) result = (result * 31 + character.charCodeAt(0)) >>> 0; return result; }

const styles = StyleSheet.create({
  cover: { width: '100%', aspectRatio: 0.72, padding: 12, justifyContent: 'center' }, compact: { width: 150, height: 205 }, rule: { flex: 1, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }, initials: { fontSize: 48, fontWeight: '800' }, compactInitials: { fontSize: 54 },
  badge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel }, badgeText: { color: colors.muted, fontSize: 11, fontWeight: '700' },
});
