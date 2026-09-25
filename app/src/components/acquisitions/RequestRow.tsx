import type { TitleRequest } from '@/generated/api';
import { acquisitionDate } from '@/lib/acquisitions/acquisition';
import { BookCover } from '@/components/catalog/bookshelf';
import { titleRequestDetail, titleRequestPresentation } from '@/lib/acquisitions/title-search';
import { Button, StatusBadge } from '@/components/ui';
import { fadeOut, layoutShift, listItemEnter } from '@/components/ui/motion';
import { AnimatedView, Text, View } from '@/components/ui/tw';

export function RequestRow({
  index = 0,
  request,
  requester,
  library,
  busy,
  onApprove,
  onDeny,
}: {
  index?: number;
  request: TitleRequest;
  requester: string;
  library?: string;
  busy: string;
  onApprove: (format: string) => void;
  onDeny: (format: string) => void;
}) {
  return (
    <AnimatedView
      role="listitem"
      className="gap-5 border-b border-line-subtle py-6 sm:flex-row sm:gap-8"
      entering={listItemEnter(index)}
      exiting={fadeOut}
      layout={layoutShift}
    >
      <View className="min-w-0 flex-row items-start gap-4 sm:flex-1">
        <BookCover
          size="mini"
          title={request.title}
          author={request.author}
          coverURL={request.cover_url}
        />
        <View className="min-w-0 flex-1 gap-1">
          <Text className="font-editorial-bold text-lg text-ink">{request.title}</Text>
          {request.author ? <Text className="text-sm text-muted">{request.author}</Text> : null}
          <Text className="mt-1 text-xs leading-5 text-muted">
            Requested by {requester} · {acquisitionDate(request.created_at)}
          </Text>
          {library ? <Text className="text-xs text-muted">{library}</Text> : null}
        </View>
      </View>
      <View className="min-w-0 gap-4 sm:flex-1">
        {request.formats.map((format) => {
          const status = titleRequestPresentation(format.state);
          const key = `${request.id}:${format.format}`;
          const formatLabel = format.format === 'audiobook' ? 'Audiobook' : 'Ebook';
          return (
            <View key={format.format} className="gap-2">
              <View className="flex-row flex-wrap items-center justify-between gap-2">
                <Text className="text-sm font-sans-semibold text-ink">{formatLabel}</Text>
                <StatusBadge tone={status?.tone ?? 'info'} label={status?.label ?? 'Requested'} />
              </View>
              <Text className="text-sm leading-5 text-muted">{titleRequestDetail(format)}</Text>
              {format.state === 'pending_approval' ? (
                <View className="flex-row flex-wrap gap-2 sm:justify-end">
                  <Button
                    label="Approve"
                    accessibilityLabel={`Approve ${formatLabel.toLowerCase()} request for ${request.title}`}
                    kind="primary"
                    loading={busy === key}
                    disabled={Boolean(busy)}
                    onPress={() => onApprove(format.format)}
                  />
                  <Button
                    label="Deny"
                    accessibilityLabel={`Deny ${formatLabel.toLowerCase()} request for ${request.title}`}
                    kind="quiet"
                    disabled={Boolean(busy)}
                    onPress={() => onDeny(format.format)}
                  />
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </AnimatedView>
  );
}
