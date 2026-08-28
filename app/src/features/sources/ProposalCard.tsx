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
  const kinds = [...new Set(proposal.items.map((item) => item.kind))].join(' + ');
  const status = proposalStatus(proposal.state);

  return (
    <View
      className={`gap-2.5 rounded-card border p-[18px] ${
        proposal.state === 'review_required'
          ? 'border-warning bg-warning-soft'
          : 'border-line bg-paper'
      }`}
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="text-lg font-sans-bold leading-[23px] text-ink">
            {proposal.title || 'Untitled discovery'}
          </Text>
          <Text className="text-sm text-muted">{proposal.author || 'Unknown author'}</Text>
        </View>
        <StatusBadge {...status} />
      </View>
      <Text className="text-sm font-sans-bold capitalize text-ink">
        {proposal.confidence} confidence · {proposal.items.length}{' '}
        {proposal.items.length === 1 ? 'file' : 'files'} · {kinds || 'Unknown format'}
      </Text>
      {proposal.reasons.slice(0, 2).map((reason) => (
        <Text className="text-sm text-muted" key={reason}>
          • {reason}
        </Text>
      ))}
      {suggestedWork ? (
        <Text className="text-sm font-sans-bold text-success">
          Suggested existing Work: {suggestedWork.title}
        </Text>
      ) : null}
      <Row>
        <Button label="Review proposal" icon="import" kind="primary" onPress={onReview} />
        <Button label="Ignore" kind="quiet" onPress={onIgnore} />
      </Row>
    </View>
  );
}
