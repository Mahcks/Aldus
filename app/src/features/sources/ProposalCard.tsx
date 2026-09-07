import type { ImportProposal, Work } from '@/generated/api';
import { Button, Row, StatusBadge } from '@/features/ui';
import { Text, View } from '@/features/tw';
import { proposalStatus } from './helpers';

export function ProposalCard({
  proposal,
  suggestedWork,
  onReview,
  onIgnore,
}: {
  proposal: ImportProposal;
  suggestedWork?: Work;
  onReview: () => void;
  onIgnore: () => void;
}) {
  const kinds = [
    ...new Set(proposal.items.map((item) => (item.kind === 'epub' ? 'Ebook' : 'Audiobook'))),
  ].join(' + ');
  const status = proposalStatus(proposal.state);

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
        Confidence: {proposal.confidence} · {proposal.items.length}{' '}
        {proposal.items.length === 1 ? 'file' : 'files'} · {kinds || 'Unknown format'}
      </Text>
      {proposal.reasons.slice(0, 2).map((reason) => (
        <Text className="text-sm text-muted" key={reason}>
          • {reason}
        </Text>
      ))}
      {suggestedWork ? (
        <Text className="text-sm font-sans-bold text-success">
          Suggested book: {suggestedWork.title}
        </Text>
      ) : null}
      <Row>
        <Button label="Review proposal" icon="import" kind="primary" onPress={onReview} />
        <Button label="Ignore" kind="quiet" onPress={onIgnore} />
      </Row>
    </View>
  );
}
