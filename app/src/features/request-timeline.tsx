import type { TitleRequestEvent } from '@/generated/api';
import { notificationTime } from './notification-presentation';
import { requestEventDetail } from './request-timeline-presentation';
import { titleRequestPresentation } from './title-search';
import { Text, View } from './tw';
import { StatusBadge } from './ui';

export function RequestTimeline({
  events,
  format,
}: {
  events: TitleRequestEvent[];
  format?: string;
}) {
  const visibleEvents = format ? events.filter((event) => event.format === format) : events;
  if (visibleEvents.length === 0) return null;
  return (
    <View accessibilityRole="list" className="border-t border-line pt-2">
      {visibleEvents.map((event, index) => {
        const status = titleRequestPresentation(event.state) ?? {
          label: 'Updated',
          tone: 'neutral' as const,
        };
        return (
          <View key={`${event.created_at}-${event.format}-${index}`} className="gap-1 py-2">
            <View className="flex-row flex-wrap items-center gap-2">
              {!format && event.format ? (
                <Text className="text-sm font-sans-bold text-ink">{formatLabel(event.format)}</Text>
              ) : null}
              <StatusBadge label={status.label} tone={status.tone} />
              <Text className="text-xs text-muted">{notificationTime(event.created_at)}</Text>
            </View>
            <Text className="text-sm leading-5 text-muted">{requestEventDetail(event.state)}</Text>
          </View>
        );
      })}
    </View>
  );
}

function formatLabel(format: string) {
  return format === 'audiobook' ? 'Audiobook' : 'Ebook';
}
