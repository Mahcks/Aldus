import { Platform } from 'react-native';
import { router, type Href } from 'expo-router';
import type { WorkSummary } from '@/generated/api';

export type WorkQuickAction = { label: string; onPress: () => void };

export function workHref(work: { id: string }): Href {
  return `/work/${work.id}` as Href;
}

/**
 * Standard quick-action set for a Work, shared by every card that shows a
 * long-press/overflow menu (Home's shelves, the Library grid): open its
 * detail page, jump straight into reading or listening, manage downloads
 * (native only), add it to a collection, or change its reading status. Each
 * entry just navigates — the destination screen owns the actual behavior via
 * its `?action=` query param, so this stays a thin, reusable menu builder
 * rather than a place where consumption or download logic lives.
 */
export function workQuickActions(work: WorkSummary): WorkQuickAction[] {
  return [
    { label: 'Book details', onPress: () => router.push(workHref(work)) },
    ...(work.readable
      ? [{ label: 'Read', onPress: () => router.push(`/consume/${work.id}?mode=read` as Href) }]
      : []),
    ...(work.listenable
      ? [
          {
            label: 'Listen',
            onPress: () => router.push(`/consume/${work.id}?mode=listen` as Href),
          },
        ]
      : []),
    ...(Platform.OS !== 'web'
      ? [
          {
            label: 'Downloads',
            onPress: () => router.push(`/work/${work.id}?action=downloads` as Href),
          },
        ]
      : []),
    {
      label: 'Add to collection',
      onPress: () => router.push(`/work/${work.id}?action=collection` as Href),
    },
    {
      label: 'Reading status',
      onPress: () => router.push(`/work/${work.id}?action=status` as Href),
    },
  ];
}
