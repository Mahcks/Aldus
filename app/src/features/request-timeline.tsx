import type { TitleRequestEvent } from '../generated/api';
import { notificationTime } from './notification-presentation';
import { requestEventDetail } from './request-timeline-presentation';
import { titleRequestPresentation } from './title-search';
import { Text, View } from './tw';
import { StatusBadge } from './ui';

export function RequestTimeline({ events }: { events: TitleRequestEvent[] }) {
  if (events.length === 0) return null;
  return (
    <View accessibilityRole="list" className="border-l border-line pl-4">
      {events.map((event, index) => {
        const status = titleRequestPresentation(event.state) ?? {
          label: 'Updated',
          tone: 'neutral' as const,
        };
        return (
          <View key={`${event.created_at}-${event.format}-${index}`} className="gap-1 py-2">
            <View className="flex-row flex-wrap items-center gap-2">
              {event.format ? (
                <Text className="text-sm font-bold text-ink">{formatLabel(event.format)}</Text>
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
