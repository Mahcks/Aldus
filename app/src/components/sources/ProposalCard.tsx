import type { ImportProposal } from '@/generated/api';
import { Button, Row, StatusBadge } from '@/components/ui';
import { Text, View } from '@/components/ui/tw';
import { proposalStatus } from '@/lib/sources/helpers';

export function ProposalCard({
  proposal,
  onReview,
  onIgnore,
}: {
  proposal: ImportProposal;
  onReview: () => void;
  onIgnore: () => void;
}) {
  const kinds = [
    ...new Set(proposal.items.map((item) => (item.kind === 'epub' ? 'Ebook' : 'Audiobook'))),
  ].join(' + ');
  const status = proposalStatus(
    proposal.review_reasons?.length ? 'review_required' : proposal.state,
  );

  return (
    <View className="gap-3 border-b border-line-subtle py-5">
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="text-lg font-editorial-bold leading-[23px] text-ink">
            {proposal.title || 'Untitled discovery'}
          </Text>
          <Text className="text-sm text-muted">{proposal.author || 'Unknown author'}</Text>
        </View>
        <StatusBadge {...status} />
      </View>
      <Text className="text-sm text-muted">
        Grouping confidence: {proposal.confidence} · {proposal.items.length}{' '}
        {proposal.items.length === 1 ? 'file' : 'files'} · {kinds || 'Unknown format'}
      </Text>
      {proposal.review_reasons?.map((reason) => (
        <Text className="text-sm font-sans-bold text-ink" key={reason}>
          Last acquisition review: {reason}
        </Text>
      ))}
      {proposal.reasons.slice(0, 2).map((reason) => (
        <Text className="text-sm text-muted" key={reason}>
          • {reason}
        </Text>
      ))}
      {proposal.existing_work_id ? (
        <Text className="text-sm font-sans-bold text-success">
          An existing book is suggested. Review it before importing.
        </Text>
      ) : null}
      <Row>
        <Button label="Review proposal" icon="import" kind="primary" onPress={onReview} />
        <Button label="Ignore" kind="quiet" onPress={onIgnore} />
      </Row>
    </View>
  );
}
