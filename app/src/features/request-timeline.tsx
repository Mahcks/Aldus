import { useState } from 'react';
import type { TitleRequestEvent } from '@/generated/api';
import { notificationTime } from './notification-presentation';
import { groupRequestEvents, requestEventDetail } from './request-timeline-presentation';
import { titleRequestPresentation } from './title-search';
import { Text, View } from './tw';
import { Button, StatusBadge } from './ui';

export function RequestTimeline({
  events,
  format,
}: {
  events: TitleRequestEvent[];
  format?: string;
}) {
  const [visibleCount, setVisibleCount] = useState(5);
  const groupedEvents = groupRequestEvents(
    format ? events.filter((event) => event.format === format) : events,
  );
  const visibleEvents = groupedEvents.slice(0, visibleCount);
  if (visibleEvents.length === 0) return null;
  return (
    <View accessibilityRole="list" className="border-t border-line pt-2">
      {visibleEvents.map(({ event, checks }, index) => {
        const retrying = ['search_failed', 'submission_failed'].includes(event.event_type);
        const status = retrying
          ? { label: 'Retrying', tone: 'warning' as const }
          : (titleRequestPresentation(event.state) ?? {
              label: 'Updated',
              tone: 'neutral' as const,
            });
        return (
          <View key={`${event.created_at}-${event.format}-${index}`} className="gap-1 py-2">
            <View className="flex-row flex-wrap items-center gap-2">
              {!format && event.format ? (
                <Text className="text-sm font-sans-bold text-ink">{formatLabel(event.format)}</Text>
              ) : null}
              <StatusBadge label={status.label} tone={status.tone} />
              <Text className="text-xs text-muted">{notificationTime(event.created_at)}</Text>
            </View>
            <Text className="text-sm leading-5 text-muted">
              {requestEventDetail(event.state, event.event_type)}
            </Text>
            {checks > 1 ? (
              <Text className="text-xs text-muted">
                {checks} {retrying ? 'unsuccessful attempts' : 'checks for a matching release'}
              </Text>
            ) : null}
          </View>
        );
      })}
      {groupedEvents.length > 5 ? (
        <View className="flex-row flex-wrap gap-2">
          {visibleCount < groupedEvents.length ? (
            <Button
              label="Show older updates"
              kind="quiet"
              onPress={() => setVisibleCount((count) => count + 5)}
            />
          ) : null}
          {visibleCount > 5 ? (
            <Button label="Show fewer updates" kind="quiet" onPress={() => setVisibleCount(5)} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function formatLabel(format: string) {
  return format === 'audiobook' ? 'Audiobook' : 'Ebook';
}
