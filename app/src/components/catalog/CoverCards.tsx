import { useState } from 'react';
import type { CoverAsset, CoverCandidate, Work } from '@/generated/api';
import { BookCover, coverPresentation } from './bookshelf';
import { Pressable, Text, View } from '@/components/ui/tw';
import { Button, resolvePressStateClass } from '@/components/ui';

export function CoverAssetCard({
  asset,
  audioArtwork,
  work,
  disabled,
  selecting,
  onSelect,
  onDelete,
}: {
  asset: CoverAsset;
  audioArtwork: boolean;
  work: Work;
  disabled: boolean;
  selecting: boolean;
  onSelect: () => void;
  onDelete?: () => void;
}) {
  return (
    <View className={`w-[148px] gap-2 ${disabled && !selecting ? 'opacity-50' : ''}`}>
      <BookCover
        title={work.title}
        author={work.author}
        coverURL={asset.image_url}
        size={audioArtwork ? 'audio' : 'small'}
        {...coverPresentation(work)}
        coverFit="cover"
      />
      <Text numberOfLines={1} className="text-sm font-sans-bold text-ink">
        {asset.source === 'embedded'
          ? `Embedded — ${asset.format === 'audiobook' ? 'Audiobook' : 'Ebook'}`
          : asset.source === 'upload'
            ? 'Uploaded image'
            : 'Open Library'}
      </Text>
      <Text numberOfLines={1} className="text-xs text-muted">
        {asset.source === 'embedded'
          ? asset.original_filename || 'From the source file'
          : asset.source === 'upload'
            ? 'Added to Aldus'
            : 'Open Library'}
      </Text>
      <Button
        label={asset.selected ? 'Selected' : selecting ? 'Selecting…' : 'Use cover'}
        kind="secondary"
        selected={asset.selected}
        disabled={disabled || asset.selected}
        onPress={onSelect}
      />
      {onDelete ? (
        <Button label="Delete upload" kind="danger" disabled={disabled} onPress={onDelete} />
      ) : null}
    </View>
  );
}

export function CoverCandidateCard({
  candidate,
  fallbackTitle,
  fallbackAuthor,
  selecting,
  disabled,
  onPress,
}: {
  candidate: CoverCandidate;
  fallbackTitle: string;
  fallbackAuthor?: string;
  selecting: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const stateClass = resolvePressStateClass({ focused, pressed });
  const title = candidate.title || fallbackTitle;
  const meta =
    [candidate.publisher, candidate.first_publish_year || undefined].filter(Boolean).join(' · ') ||
    (candidate.source === 'embedded' ? 'Embedded artwork' : 'Open Library');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Use this cover: ${title}, ${meta}`}
      accessibilityState={{ disabled, busy: selecting }}
      disabled={disabled}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={onPress}
      className={`w-[148px] gap-2 rounded-control ${stateClass} ${disabled && !selecting ? 'opacity-50' : ''}`}
    >
      <BookCover
        title={title}
        author={candidate.author || fallbackAuthor}
        coverURL={candidate.image_url}
        size="small"
        coverFit="cover"
        square={candidate.format === 'audiobook'}
      />
      <Text numberOfLines={2} className="font-editorial-bold text-sm text-ink">
        {title}
      </Text>
      <Text numberOfLines={1} className="text-xs text-muted">
        {meta}
      </Text>
      <Text className="text-xs font-sans-bold text-accent">
        {selecting ? 'Selecting…' : 'Use this cover'}
      </Text>
    </Pressable>
  );
}
