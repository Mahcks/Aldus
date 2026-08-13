import type { PropsWithChildren } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, space, type } from './ui';

const covers = [
  ['#74402f', '#f7ede1'], ['#48594b', '#f3eee2'], ['#665473', '#f6ecdf'], ['#8a6237', '#fff1dd'], ['#3f5960', '#f4eee3'],
] as const;

export function BookCover({ title, author, compact }: { title: string; author?: string; compact?: boolean }) {
  const palette = covers[hash(title + author) % covers.length];
  return <View accessibilityLabel={`Cover for ${title}`} style={[styles.cover, compact && styles.compact, { backgroundColor: palette[0] }]}><View style={[styles.rule, { borderColor: palette[1] }]}><Text numberOfLines={4} adjustsFontSizeToFit style={[styles.coverTitle, compact && styles.compactTitle, { color: palette[1] }]}>{title}</Text><View style={[styles.divider, { backgroundColor: palette[1] }]} /><Text numberOfLines={2} style={[styles.coverAuthor, { color: palette[1] }]}>{author || 'Aldus Library'}</Text></View></View>;
}

export function Badge({ children }: PropsWithChildren) { return <View style={styles.badge}><Text style={styles.badgeText}>{children}</Text></View>; }

export function WorkCard({ title, author, badges = [], progress, onPress }: { title: string; author?: string; badges?: string[]; progress?: string; onPress: () => void }) {
  return <Pressable accessibilityRole="link" accessibilityLabel={`${title}${author ? ` by ${author}` : ''}`} style={({ pressed }) => [styles.card, pressed && styles.pressed]} onPress={onPress}><BookCover title={title} author={author} /><Text numberOfLines={2} style={styles.title}>{title}</Text><Text numberOfLines={1} style={styles.author}>{author || 'Unknown author'}</Text>{progress ? <Text numberOfLines={1} style={styles.progress}>{progress}</Text> : null}<View style={styles.badges}>{badges.map((badge) => <Badge key={badge}>{badge}</Badge>)}</View></Pressable>;
}

function hash(value: string) { let result = 0; for (const character of value) result = (result * 31 + character.charCodeAt(0)) >>> 0; return result; }

const styles = StyleSheet.create({
  cover: { width: '100%', aspectRatio: 0.68, padding: space.md, justifyContent: 'center', borderRadius: 3, shadowColor: '#2a1c15', shadowOpacity: .16, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } }, compact: { width: 172, height: 252 }, rule: { flex: 1, borderWidth: 1, paddingHorizontal: space.md, paddingVertical: space.xl, alignItems: 'center', justifyContent: 'space-between' }, coverTitle: { fontFamily: 'Georgia', fontSize: 20, lineHeight: 24, fontWeight: '700', textAlign: 'center' }, compactTitle: { fontSize: 22, lineHeight: 27 }, divider: { width: 28, height: 1 }, coverAuthor: { fontFamily: 'Georgia', fontSize: 11, lineHeight: 15, textAlign: 'center' },
  badge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel }, badgeText: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  card: { width: 184, gap: 7, borderRadius: 4 }, pressed: { opacity: .76 }, title: { color: colors.ink, fontFamily: 'Georgia', fontSize: 16, lineHeight: 20, fontWeight: '700', marginTop: space.xs }, author: { color: colors.muted, ...type.meta }, progress: { color: colors.accent, fontSize: 12, fontWeight: '700' }, badges: { minHeight: 24, flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
});
