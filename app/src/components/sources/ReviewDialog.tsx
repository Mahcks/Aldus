import type { ImportProposal, Representation } from '@/generated/api';
import { representationKinds, type ReviewDraft } from '@/lib/sources/source-administration';
import {
  Button,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Notice,
  Radio,
  Row,
  SearchField,
  Select,
} from '@/components/ui';
import type { useImportDestination } from '@/hooks/sources/useImportDestination';
import { Text, View } from '@/components/ui/tw';
import { humanState } from '@/lib/sources/helpers';
import { TechnicalDetails } from './TechnicalDetails';

export function ReviewDialog({
  proposal,
  draft,
  destination,
  conflict,
  busy,
  onDraftChange,
  onChooseWork,
  onItemChange,
  onAccept,
  onIgnore,
  onClose,
}: {
  proposal?: ImportProposal;
  draft?: ReviewDraft;
  destination: ReturnType<typeof useImportDestination>;
  conflict: string;
  busy: boolean;
  onDraftChange: (draft: ReviewDraft) => void;
  onChooseWork: (workID: string) => void;
  onItemChange: (
    entryID: string,
    key: 'kind' | 'label' | 'representationID' | 'narrators',
    value: string,
  ) => void;
  onAccept: () => void;
  onIgnore: () => void;
  onClose: () => void;
}) {
  if (!proposal || !draft) return null;

  return (
    <Dialog
      visible
      title="Review import proposal"
      onClose={onClose}
      wide
      sheet
      footer={
        <View className="gap-3">
          {conflict ? <Notice danger>{conflict}</Notice> : null}
          {!destination.ready ? (
            <Text className="text-sm text-muted">
              {destination.selectionLoading
                ? 'Checking the selected book before importing…'
                : 'Choose an available book, retry the selected book, or create a new book.'}
            </Text>
          ) : null}

          <Row>
            <Button
              label={busy ? 'Importing…' : 'Import book'}
              kind="primary"
              disabled={busy || !destination.ready || (!draft.workID && !draft.title.trim())}
              onPress={onAccept}
            />
            <Button label="Ignore proposal" kind="quiet" disabled={busy} onPress={onIgnore} />
          </Row>
        </View>
      }
    >
      <View className="gap-6 pb-1.5">
        <View>
          <Text className="text-2xl font-sans-bold text-ink">
            {proposal.title || 'Untitled discovery'}
          </Text>
          <Text className="text-sm text-muted">
            {proposal.confidence} grouping confidence · {humanState(proposal.state)}
          </Text>
        </View>

        {proposal.review_reasons?.map((reason) => (
          <Notice key={reason}>Last acquisition review: {reason}</Notice>
        ))}

        <View className="gap-1.5 rounded-control bg-canvas p-3">
          <Text className="text-sm font-sans-bold text-ink">Why Aldus grouped these files</Text>
          {proposal.reasons.map((reason) => (
            <Text className="text-sm text-muted" key={reason}>
              • {reason}
            </Text>
          ))}
        </View>

        <View className="gap-2.5">
          <Text className="text-sm font-sans-bold text-ink">Add these files to</Text>
          <WorkChoice
            title="Create a new book"
            description="Use the reviewed title and author below."
            selected={!draft.workID}
            onPress={() => onChooseWork('')}
          />
          {destination.selectionLoading ? <LoadingState label="Loading selected book…" /> : null}
          {destination.selectionError ? (
            <ErrorState
              title="Selected book unavailable"
              action={<Button label="Retry selected book" onPress={destination.retrySelection} />}
            >
              {destination.selectionError}
            </ErrorState>
          ) : null}
          {destination.selectedWork && draft.workID ? (
            <WorkChoice
              title={destination.selectedWork.title}
              description={
                (destination.selectedWork.author || 'Unknown author') +
                (draft.workID === proposal.existing_work_id
                  ? ' · Suggested match'
                  : ' · Selected book')
              }
              selected
              onPress={() => onChooseWork(draft.workID)}
            />
          ) : null}
          <SearchField
            label="Find an existing book"
            placeholder="Search this library by title or author"
            value={destination.query}
            onChangeText={destination.search}
          />
          {destination.searchLoading ? <LoadingState label="Finding books…" /> : null}
          {destination.searchError ? (
            <ErrorState
              title="Could not load books"
              action={<Button label="Retry book search" onPress={destination.retrySearch} />}
            >
              {destination.searchError}
            </ErrorState>
          ) : null}
          {!destination.searchLoading &&
          !destination.searchError &&
          destination.works.length === 0 ? (
            <EmptyState title="No books found">Try another search or create a new book.</EmptyState>
          ) : null}
          {destination.works
            .filter((work) => work.id !== draft.workID)
            .map((work) => (
              <WorkChoice
                key={work.id}
                title={work.title}
                description={work.author || 'Unknown author'}
                selected={false}
                onPress={() => onChooseWork(work.id)}
              />
            ))}
          {destination.hasMore ? (
            <Button label="Load more books" kind="secondary" onPress={destination.loadMore} />
          ) : null}
        </View>

        <View className="flex-row flex-wrap gap-3">
          <View className="grow basis-[240px]">
            <Field
              label="Book title"
              value={draft.title}
              onChangeText={(title) => onDraftChange({ ...draft, title })}
            />
          </View>
          <View className="grow basis-[240px]">
            <Field
              label="Author"
              value={draft.author}
              onChangeText={(author) => onDraftChange({ ...draft, author })}
            />
          </View>
        </View>

        {!draft.workID ? (
          <View className="gap-3">
            <Field
              label="Series override"
              value={draft.series ?? ''}
              onChangeText={(series) => onDraftChange({ ...draft, series })}
              help="Leave untouched to use agreeing embedded tags. Edit to choose a series; clear it to omit series metadata."
            />
            <Field
              label="Position override"
              value={draft.seriesPosition ?? ''}
              onChangeText={(seriesPosition) => onDraftChange({ ...draft, seriesPosition })}
              help="Optional, for example 0 or 1.5."
            />
          </View>
        ) : (
          <Text className="text-sm text-muted">
            The existing book’s series metadata will be kept.
          </Text>
        )}
        <View className="gap-2.5">
          <Text className="text-sm font-sans-bold text-ink">Files to import</Text>
          {proposal.items.map((item) => (
            <ReviewItemRow
              draft={draft}
              item={item}
              key={item.source_entry_id}
              representations={destination.representations}
              onItemChange={onItemChange}
            />
          ))}
        </View>

        {proposal.acquisition_request_id ? (
          <View className="gap-2">
            <Checkbox
              label={`Fulfill request for “${proposal.acquisition_title}” with this book`}
              checked={draft.fulfillRequest ?? false}
              onPress={() => onDraftChange({ ...draft, fulfillRequest: !draft.fulfillRequest })}
            />
            <Text className="text-sm text-muted">
              Choose this only if these files are the requested book. Other books can be imported
              separately.
            </Text>
          </View>
        ) : null}
      </View>
    </Dialog>
  );
}

function WorkChoice({
  title,
  description,
  selected,
  onPress,
}: {
  title: string;
  description: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <View className="gap-0.5 border-b border-line-subtle pb-3">
      <Radio label={title} selected={selected} onPress={onPress} />
      <Text className="pl-8 text-sm text-muted">{description}</Text>
    </View>
  );
}

function ReviewItemRow({
  item,
  draft,
  representations,
  onItemChange,
}: {
  item: ImportProposal['items'][number];
  draft: ReviewDraft;
  representations: Representation[];
  onItemChange: (
    entryID: string,
    key: 'kind' | 'label' | 'representationID' | 'narrators',
    value: string,
  ) => void;
}) {
  const edit = draft.items[item.source_entry_id];
  const compatible = representations.filter((representation) => representation.kind === edit?.kind);

  if (!edit) return null;

  return (
    <View className="gap-3 border-t border-line-subtle py-4">
      <Text selectable className="text-xs leading-[18px] text-ink">
        {item.relative_path}
      </Text>
      {item.duplicate ? <Text className="text-sm text-muted">Exact duplicate</Text> : null}
      {typeof item.evidence.series === 'string' && item.evidence.series ? (
        <Text className="text-sm text-muted">
          Embedded series: {item.evidence.series}
          {typeof item.evidence.series_position === 'string' && item.evidence.series_position
            ? ` · ${item.evidence.series_position}`
            : ''}
        </Text>
      ) : null}
      {Array.isArray(item.evidence.narrators) && item.evidence.narrators.length ? (
        <Text className="text-sm text-muted">
          Embedded narrators: {item.evidence.narrators.join(', ')}
        </Text>
      ) : null}
      {edit.kind !== 'epub' && !edit.representationID ? (
        <Field
          label="Narrators"
          value={
            edit.narrators ??
            (Array.isArray(item.evidence.narrators) ? item.evidence.narrators.join('\n') : '')
          }
          multiline
          help="One narrator per line, in credit order."
          onChangeText={(value) => onItemChange(item.source_entry_id, 'narrators', value)}
        />
      ) : null}
      <TechnicalDetails rows={[{ label: 'SHA-256', value: item.sha256, copyable: true }]} />
      <View className="flex-row flex-wrap gap-3">
        <View className="grow basis-[240px]">
          <Select
            label="Kind"
            options={representationKinds}
            value={edit.kind}
            onChange={(value) => onItemChange(item.source_entry_id, 'kind', value)}
          />
        </View>
        <View className="grow basis-[240px]">
          <Field
            label="Label"
            value={edit.label}
            onChangeText={(value) => onItemChange(item.source_entry_id, 'label', value)}
          />
        </View>
      </View>
      {draft.workID && compatible.length > 0 ? (
        <View className="gap-1.5">
          <Text className="text-sm text-muted">
            Use an existing edition or narration (optional)
          </Text>
          <Row>
            <Button
              label="Create new"
              kind={!edit.representationID ? 'primary' : 'secondary'}
              onPress={() => onItemChange(item.source_entry_id, 'representationID', '')}
            />
            {compatible.map((representation) => (
              <Button
                key={representation.id}
                label={representation.label}
                kind={edit.representationID === representation.id ? 'primary' : 'secondary'}
                onPress={() =>
                  onItemChange(item.source_entry_id, 'representationID', representation.id)
                }
              />
            ))}
          </Row>
        </View>
      ) : null}
    </View>
  );
}
