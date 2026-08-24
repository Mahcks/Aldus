import type { AcquisitionResult, WorkSummary } from '../generated/api';
import { useState } from 'react';
import { useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import {
  acquisitionCounterparts,
  acquisitionDate,
  acquisitionSize,
  type AcquisitionResultGroup,
} from './acquisition';
import { BookCover, coverPresentation, WorkCard } from './bookshelf';
import { AppIcon } from './icons';
import { listItemEnter } from './motion';
import { ScrollView, Text, View } from './tw';
import { Button, colors, Notice, Select, StatusBadge } from './ui';

export const browseSorts = [
  ['recent', 'Recently added'],
  ['updated', 'Recently updated'],
  ['title', 'Title A–Z'],
  ['author', 'Author A–Z'],
] as const;

export const browseFilters = [
  ['all', 'All'],
  ['readable', 'Readable'],
  ['listenable', 'Listenable'],
  ['synchronized', 'Synchronized'],
] as const;

/**
 * Single-row, horizontally scrollable stand-in for `Select` on narrow
 * screens, where `Select`'s wrapping button grid consumes too much vertical
 * space. Same radiogroup semantics and `Button` primitive underneath.
 */
export function BrowseFacet({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View className="gap-1">
      <Text className="text-xs font-sans-semibold uppercase tracking-wide text-subtle">
        {label}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        contentContainerClassName="flex-row items-center gap-2 pr-4"
      >
        {options.map((option) => (
          <Button
            key={option.value}
            label={option.label}
            kind="secondary"
            selected={option.value === value}
            accessibilityRole="radio"
            onPress={() => onChange(option.value)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * Sort and availability, kept deliberately secondary to the search field:
 * a single-row, horizontally scrollable chip strip rather than a full
 * multi-row `Select` grid, at every width — filters refine results, they
 * don't compete with the query for attention.
 */
export function BrowseControls({
  sort,
  availability,
  onSortChange,
  onAvailabilityChange,
}: {
  sort: string;
  availability: string;
  onSortChange: (value: string) => void;
  onAvailabilityChange: (value: string) => void;
}) {
  const sortOptions = browseSorts.map(([value, label]) => ({ value, label }));
  const availabilityOptions = browseFilters.map(([value, label]) => ({ value, label }));

  return (
    <View className="flex-row flex-wrap gap-x-6 gap-y-2.5">
      <BrowseFacet label="Sort by" options={sortOptions} value={sort} onChange={onSortChange} />
      <BrowseFacet
        label="Availability"
        options={availabilityOptions}
        value={availability}
        onChange={onAvailabilityChange}
      />
    </View>
  );
}

type AcquisitionRowState = 'idle' | 'sending' | 'queued' | 'error';

function releaseLabel(result: AcquisitionResult) {
  const details = [result.format, result.edition, result.narrator].filter(Boolean).join(' · ');
  return details || (result.kind === 'audiobook' ? 'Audiobook' : 'Ebook');
}

function counterpartLabel(result: AcquisitionResult) {
  return [result.canonical_title || result.title, releaseLabel(result), result.source]
    .filter(Boolean)
    .join(' · ');
}

/** One book-level discovery result with progressively disclosed release choices. */
export function AcquisitionGroupRow({
  group,
  statuses,
  errors,
  allResults,
  disabled,
  onAdd,
  onAddPair,
}: {
  group: AcquisitionResultGroup;
  statuses: Record<string, AcquisitionRowState>;
  errors: Record<string, string>;
  allResults: AcquisitionResult[];
  disabled: boolean;
  onAdd: (result: AcquisitionResult) => void;
  onAddPair: (first: AcquisitionResult, second: AcquisitionResult) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const formats = [...new Set(group.releases.map((release) => releaseLabel(release)))];
  const single = group.releases.length === 1 ? group.releases[0] : undefined;
  const representative =
    group.releases.find((release) => release.cover_url) ??
    group.releases.find((release) => release.author || release.year) ??
    group.releases[0];
  const singleCounterparts = single ? acquisitionCounterparts(single, allResults) : [];
  const bookMetadata = [representative?.year, representative?.language?.toUpperCase()]
    .filter(Boolean)
    .join(' · ');
  const hasBothKinds =
    group.releases.some((release) => release.kind === 'ebook') &&
    group.releases.some((release) => release.kind === 'audiobook');
  const editionKinds = (['ebook', 'audiobook'] as const).filter((kind) =>
    group.releases.some((release) => release.kind === kind),
  );

  return (
    <View className="border-b border-line py-5">
      <View className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <View className="min-w-0 flex-1 flex-row items-start gap-4">
          <BookCover
            title={group.title}
            author={group.author}
            coverURL={representative?.cover_url}
            size="mini"
          />
          <View className="min-w-0 flex-1 gap-1">
            <Text numberOfLines={2} className="font-editorial-bold text-lg leading-6 text-ink">
              {group.title}
            </Text>
            {group.author ? <Text className="text-sm text-muted">{group.author}</Text> : null}
            <Text className="text-xs text-subtle">
              {[formats.join(' · '), bookMetadata].filter(Boolean).join(' · ')}
            </Text>
            {singleCounterparts.length ? (
              <View className="mt-2 gap-1 border-t border-line pt-2">
                <View className="flex-row items-center gap-1.5">
                  <AppIcon name="synced" size={15} color={colors.info} />
                  <Text className="text-xs font-sans-bold text-info">Likely counterpart</Text>
                </View>
                <Text className="max-w-[560px] text-xs text-muted">
                  {counterpartLabel(singleCounterparts[0])}
                </Text>
                <Text className="max-w-[520px] text-xs text-muted">
                  Compatibility is verified only after both files import and alignment completes.
                </Text>
              </View>
            ) : null}
          </View>
        </View>
        <View className="items-start gap-1 pl-[72px] sm:items-end sm:pl-0">
          {single ? (
            statuses[single.id] === 'queued' ? (
              <StatusBadge tone="success" icon="check" label="Added" />
            ) : (
              <Button
                kind="quiet"
                icon="add"
                label={
                  statuses[single.id] === 'sending'
                    ? 'Adding…'
                    : `Add ${single.kind === 'audiobook' ? 'audiobook' : single.format || 'ebook'}`
                }
                loading={statuses[single.id] === 'sending'}
                disabled={disabled}
                onPress={() => onAdd(single)}
              />
            )
          ) : (
            <Button
              kind="quiet"
              label={expanded ? 'Hide editions' : `Choose edition (${group.releases.length})`}
              onPress={() => setExpanded((value) => !value)}
            />
          )}
          {single && singleCounterparts[0] && statuses[single.id] !== 'queued' ? (
            <Button
              kind="secondary"
              icon="synced"
              label="Add read + listen"
              disabled={disabled}
              onPress={() => onAddPair(single, singleCounterparts[0])}
            />
          ) : null}
        </View>
      </View>
      {single && statuses[single.id] === 'error' && errors[single.id] ? (
        <View className="mt-3">
          <Notice tone="danger">{errors[single.id]}</Notice>
        </View>
      ) : null}
      {expanded ? (
        <View className="mt-4 border-t border-line sm:ml-[72px]">
          {editionKinds.map((kind) => (
            <View key={kind}>
              {hasBothKinds ? (
                <Text className="pt-3 text-[11px] font-sans-bold uppercase tracking-wide text-subtle">
                  {kind === 'ebook' ? 'Ebooks' : 'Audiobooks'}
                </Text>
              ) : null}
              {group.releases
                .filter((release) => release.kind === kind)
                .map((release) => {
                  const counterpart = acquisitionCounterparts(release, allResults)[0];
                  const metadata = [
                    release.source,
                    acquisitionSize(release.size),
                    acquisitionDate(release.published),
                  ]
                    .filter(Boolean)
                    .join(' · ');
                  const state = statuses[release.id] ?? 'idle';
                  return (
                    <View
                      key={release.id}
                      className="gap-1 border-b border-line py-2.5 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <View className="min-w-0 flex-1">
                        <Text numberOfLines={1} className="text-sm text-ink">
                          <Text className="font-sans-semibold">{releaseLabel(release)}</Text>
                          {metadata ? (
                            <Text className="text-xs text-subtle"> · {metadata}</Text>
                          ) : null}
                        </Text>
                        {state === 'error' && errors[release.id] ? (
                          <Text className="text-xs text-danger">{errors[release.id]}</Text>
                        ) : null}
                      </View>
                      {state === 'queued' ? (
                        <StatusBadge tone="success" icon="check" label="Added" />
                      ) : (
                        <View className="flex-row flex-wrap gap-1">
                          <Button
                            kind="quiet"
                            icon="add"
                            label={state === 'sending' ? 'Adding…' : 'Add'}
                            loading={state === 'sending'}
                            disabled={disabled}
                            onPress={() => onAdd(release)}
                          />
                          {counterpart ? (
                            <Button
                              kind="secondary"
                              icon="synced"
                              label="Add read + listen"
                              disabled={disabled}
                              onPress={() => onAddPair(release, counterpart)}
                            />
                          ) : null}
                        </View>
                      )}
                    </View>
                  );
                })}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Compact "Add to: …" control shown beside the "Available to add" heading.
 * Renders as static text when there is only one eligible destination, and
 * hides the underlying Source entirely unless a real choice exists — the
 * Source is an implementation detail readers shouldn't need to think about.
 */
export function DestinationPicker({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  if (options.length === 0) return null;
  if (options.length === 1) {
    return (
      <View className="flex-row items-center gap-1.5">
        <AppIcon name="acquire" size={14} color={colors.subtle} />
        <Text className="text-xs font-sans-bold text-subtle">Add to: {options[0].label}</Text>
      </View>
    );
  }
  return <Select label="Add to" options={options} value={value} onChange={onChange} />;
}

export function WorkGrid({
  works,
  showLibrary,
  onOpen,
}: {
  works: WorkSummary[];
  showLibrary?: boolean;
  onOpen: (work: WorkSummary) => void;
}) {
  const narrow = useWindowDimensions().width < 600;

  return (
    <View className={`flex-row flex-wrap items-start ${narrow ? 'gap-x-4 gap-y-6' : 'gap-6'}`}>
      {works.map((work, index) => (
        <Animated.View key={work.id} entering={listItemEnter(index)}>
          <WorkCard
            title={work.title}
            author={work.author}
            coverURL={work.cover_url}
            coverPresentation={coverPresentation(work)}
            availability={work}
            progress={work.in_progress ? `${work.completion_percent}% complete` : undefined}
            context={showLibrary ? work.library_name : undefined}
            narrow={narrow}
            onPress={() => onOpen(work)}
          />
        </Animated.View>
      ))}
    </View>
  );
}
