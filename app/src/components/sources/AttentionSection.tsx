import type { ImportProposal, LibrarySource, SourceScan } from '@/generated/api';
import { AppIcon } from '@/components/ui/icons';
import { Button, Section } from '@/components/ui';
import { Text, View } from '@/components/ui/tw';
import { useThemeColors } from '@/components/ui/theme';
import { formatDate, sourceStatus } from '@/lib/sources/helpers';
import { ProposalCard } from './ProposalCard';

export type SourceProblem = { source: LibrarySource; latest?: SourceScan };

/**
 * Triage surface: new import proposals and sources with a failed or
 * problem-flagged scan, together, above the source list — so what needs a
 * decision is the first thing on the page instead of being buried in a
 * six-number grid on one card among several identical-looking others.
 * Renders nothing when there's nothing to triage; a permanent "all clear"
 * panel would just be more chrome to scan past on every calm visit.
 */
export function AttentionSection({
  problems,
  proposals,
  onViewProblem,
  onReviewProposal,
  onIgnoreProposal,
}: {
  problems: SourceProblem[];
  proposals: ImportProposal[];
  onViewProblem: (source: LibrarySource) => void;
  onReviewProposal: (proposal: ImportProposal) => void;
  onIgnoreProposal: (proposal: ImportProposal) => void;
}) {
  const total = problems.length + proposals.length;
  if (total === 0) return null;

  return (
    <Section title={`Needs your attention · ${total}`}>
      <View className="gap-3">
        {problems.map(({ source, latest }) => (
          <ProblemRow
            key={source.id}
            source={source}
            latest={latest}
            onView={() => onViewProblem(source)}
          />
        ))}
        {proposals.map((proposal) => (
          <View key={proposal.id} className="rounded-card border border-warning/25 bg-paper px-4">
            <ProposalCard
              proposal={proposal}
              onReview={() => onReviewProposal(proposal)}
              onIgnore={() => onIgnoreProposal(proposal)}
            />
          </View>
        ))}
      </View>
    </Section>
  );
}

function ProblemRow({
  source,
  latest,
  onView,
}: {
  source: LibrarySource;
  latest?: SourceScan;
  onView: () => void;
}) {
  const colors = useThemeColors();
  const status = sourceStatus(source, latest);
  const failed = latest?.state === 'failed';
  const issues: string[] = [];
  if (latest?.missing) {
    issues.push(`${latest.missing} ${latest.missing === 1 ? 'file is' : 'files are'} missing`);
  }
  if (latest?.problems) {
    issues.push(`${latest.problems} ${latest.problems === 1 ? 'file' : 'files'} couldn't be read`);
  }
  const message = `${source.name}: ${failed ? 'the last scan failed' : issues.join('; ')}`;
  const date = latest?.finished_at ?? latest?.started_at ?? latest?.created_at;

  return (
    <View className="flex-row items-center gap-3.5 rounded-card bg-danger-soft px-4 py-3.5">
      <View className="h-9 w-9 flex-none items-center justify-center rounded-pill bg-paper">
        <AppIcon name="warning" size={16} color={colors.danger} />
      </View>
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="text-sm font-sans-bold text-ink">{message}</Text>
        <Text className="text-xs text-muted">
          {status.label} · scanned {formatDate(date)}
        </Text>
      </View>
      <Button label="View source" kind="secondary" onPress={onView} />
    </View>
  );
}
