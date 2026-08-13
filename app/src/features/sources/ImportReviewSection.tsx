import type { ImportProposal, Work } from '../../generated/api';
import { EmptyState, Section } from '../ui';
import { View } from '../tw';
import { ProposalCard } from './ProposalCard';

/**
 * Library-wide import review inbox: new and ambiguous file discoveries from
 * every source in the library, grouped below the sources list per the
 * backend's library-scoped proposal model.
 */
export function ImportReviewSection({
  proposals,
  works,
  onIgnore,
  onReview,
}: {
  proposals: ImportProposal[];
  works: Work[];
  onIgnore: (proposal: ImportProposal) => void;
  onReview: (proposal: ImportProposal) => void;
}) {
  return (
    <Section title={`Import review · ${proposals.length}`}>
      {proposals.length === 0 ? (
        <EmptyState icon="check" title="Inbox clear">
          New and ambiguous discoveries will appear here after a scan.
        </EmptyState>
      ) : (
        <View className="gap-3">
          {proposals.map((proposal) => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              suggestedWork={works.find((work) => work.id === proposal.existing_work_id)}
              onIgnore={() => onIgnore(proposal)}
              onReview={() => onReview(proposal)}
            />
          ))}
        </View>
      )}
    </Section>
  );
}
