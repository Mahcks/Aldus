import type { TitleRequest } from '@/generated/api';
import { acquisitionDate } from '@/features/acquisition';
import { BookCover } from '@/features/bookshelf';
import { titleRequestDetail, titleRequestPresentation } from '@/features/title-search';
import { Button, StatusBadge } from '@/features/ui';
import { Text, View } from '@/features/tw';

export function RequestRow({
  request,
  requester,
  library,
  busy,
  onApprove,
  onDeny,
}: {
  request: TitleRequest;
  requester: string;
  library?: string;
  busy: string;
  onApprove: (format: string) => void;
  onDeny: (format: string) => void;
}) {
  return (
    <View role="listitem" className="gap-5 border-b border-line-subtle py-6 sm:flex-row sm:gap-8">
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
          return (
            <View key={format.format} className="gap-2">
              <View className="flex-row flex-wrap items-center justify-between gap-2">
                <Text className="text-sm font-sans-semibold text-ink">
                  {format.format === 'audiobook' ? 'Audiobook' : 'Ebook'}
                </Text>
                <StatusBadge tone={status?.tone ?? 'info'} label={status?.label ?? 'Requested'} />
              </View>
              <Text className="text-sm leading-5 text-muted">{titleRequestDetail(format)}</Text>
              {format.state === 'pending_approval' ? (
                <View className="flex-row flex-wrap gap-2 sm:justify-end">
                  <Button
                    label="Approve"
                    kind="primary"
                    loading={busy === key}
                    disabled={Boolean(busy)}
                    onPress={() => onApprove(format.format)}
                  />
                  <Button
                    label="Deny"
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
    </View>
  );
}
