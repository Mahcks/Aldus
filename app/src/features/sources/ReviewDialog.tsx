import type { ImportProposal, Representation, Work } from '@/generated/api';
import { representationKinds, type ReviewDraft } from '@/features/source-administration';
import { Button, Dialog, Field, Notice, Row, Select } from '@/features/ui';
import { Pressable, Text, View } from '@/features/tw';
import { humanState } from './helpers';
import { TechnicalDetails } from './TechnicalDetails';

export function ReviewDialog({
  proposal,
  draft,
  works,
  representations,
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
  works: Work[];
  representations: Representation[];
  conflict: string;
  busy: boolean;
  onDraftChange: (draft: ReviewDraft) => void;
  onChooseWork: (workID: string) => void;
  onItemChange: (
    entryID: string,
    key: 'kind' | 'label' | 'representationID',
    value: string,
  ) => void;
  onAccept: () => void;
  onIgnore: () => void;
  onClose: () => void;
}) {
  if (!proposal || !draft) return null;

  return (
    <Dialog visible title="Review import proposal" onClose={onClose} wide>
      <View className="gap-6 pb-1.5">
        {conflict ? <Notice danger>{conflict}</Notice> : null}
        <View>
          <Text className="text-2xl font-sans-bold text-ink">
            {proposal.title || 'Untitled discovery'}
          </Text>
          <Text className="text-sm text-muted">
            {proposal.confidence} confidence · {humanState(proposal.state)}
          </Text>
        </View>

        <View className="gap-1.5 rounded-control bg-canvas p-3">
          <Text className="text-sm font-sans-bold text-ink">Why Aldus grouped these files</Text>
          {proposal.reasons.map((reason) => (
            <Text className="text-sm text-muted" key={reason}>
              • {reason}
            </Text>
          ))}
        </View>

        <View className="gap-2.5">
          <Text className="text-sm font-sans-bold text-ink">Destination Work</Text>
          <WorkChoice
            title="Create a new Work"
            description="Use the reviewed title and author below."
            selected={!draft.workID}
            onPress={() => onChooseWork('')}
          />
          {works.map((work) => (
            <WorkChoice
              key={work.id}
              title={work.title}
              description={
                (work.author || 'Unknown author') +
                (work.id === proposal.existing_work_id ? ' · Suggested match' : '')
              }
              selected={draft.workID === work.id}
              onPress={() => onChooseWork(work.id)}
            />
          ))}
        </View>

        <View className="flex-row flex-wrap gap-3">
          <View className="grow basis-[240px]">
            <Field
              label="Work title"
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

        <View className="gap-2.5">
          <Text className="text-sm font-sans-bold text-ink">Representations</Text>
          {proposal.items.map((item) => (
            <ReviewItemRow
              draft={draft}
              item={item}
              key={item.source_entry_id}
              representations={representations}
              onItemChange={onItemChange}
            />
          ))}
        </View>

        <Row>
          <Button
            label={
              busy ? 'Importing…' : draft.workID ? 'Import into Work' : 'Create Work and import'
            }
            kind="primary"
            disabled={busy || (!draft.workID && !draft.title.trim())}
            onPress={onAccept}
          />
          <Button label="Ignore proposal" kind="danger" disabled={busy} onPress={onIgnore} />
          <Button label="Cancel" kind="quiet" onPress={onClose} />
        </Row>
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
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      className={`min-h-[54px] justify-center gap-0.5 rounded-control border p-2.5 ${
        selected ? 'border-accent bg-accent-soft' : 'border-line'
      }`}
    >
      <Text className="text-sm font-sans-bold text-ink">{title}</Text>
      <Text className="text-sm text-muted">{description}</Text>
    </Pressable>
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
    key: 'kind' | 'label' | 'representationID',
    value: string,
  ) => void;
}) {
  const edit = draft.items[item.source_entry_id];
  const compatible = representations.filter((representation) => representation.kind === edit?.kind);

  if (!edit) return null;

  return (
    <View className="gap-2.5 rounded-control border border-line p-3.5">
      <Text selectable className="text-xs leading-[18px] text-ink">
        {item.relative_path}
      </Text>
      {item.duplicate ? <Text className="text-sm text-muted">Exact duplicate</Text> : null}
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
            Attach to an existing Representation (optional)
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
