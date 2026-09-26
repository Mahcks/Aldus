import { Redirect } from 'expo-router';
import { useState } from 'react';
import { PausedElsewhereNotice } from '@/components/consumption/handoff/PausedElsewhereNotice';
import { PlaceChoiceDialog } from '@/components/consumption/handoff/PlaceChoiceDialog';
import { ProgressStatus, SyncReadiness } from '@/components/consumption/handoff/HandoffStatus';
import { TakeoverDialog } from '@/components/consumption/handoff/TakeoverDialog';
import {
  fixtureConflictOptions,
  fixtureIPhone,
  fixtureViews,
} from '@/components/consumption/handoff/__fixtures__/handoff-fixtures';
import { Page } from '@/components/shell/Page';
import { Button } from '@/components/ui';
import { Text, View } from '@/components/ui/tw';
import type { SavedPlaceOption } from '@/lib/consumption/handoff-copy';

/**
 * Development-only gallery of the handoff screens, fed by fixtures. Production
 * builds redirect away, so none of this sample data can reach a real flow.
 */
export default function DevHandoffScreen() {
  if (!__DEV__) return <Redirect href="/home" />;

  return <HandoffGallery />;
}

function HandoffGallery() {
  const [openView, setOpenView] = useState<keyof typeof fixtureViews>();
  const [conflictOpen, setConflictOpen] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<SavedPlaceOption['id']>();

  return (
    <Page title="Handoff preview">
      <Text className="text-base text-muted">
        Sample data only. Nothing here talks to your server or changes any saved place.
      </Text>

      <View className="gap-2">
        <Text className="text-lg font-sans-semibold text-ink">Takeover dialog</Text>
        <View className="flex-row flex-wrap gap-2">
          {Object.keys(fixtureViews).map((name) => (
            <Button
              key={name}
              label={name}
              kind="secondary"
              onPress={() => setOpenView(name as keyof typeof fixtureViews)}
            />
          ))}
        </View>
      </View>

      <View className="gap-2">
        <Text className="text-lg font-sans-semibold text-ink">Conflict dialog</Text>
        <View className="items-start">
          <Button label="Two saved places" kind="secondary" onPress={() => setConflictOpen(true)} />
        </View>
      </View>

      <View className="gap-3">
        <Text className="text-lg font-sans-semibold text-ink">Paused elsewhere</Text>
        <PausedElsewhereNotice surface="player" device={fixtureIPhone} onResume={() => {}} />
        <PausedElsewhereNotice surface="reader" device={fixtureIPhone} onResume={() => {}} />
      </View>

      <View className="gap-3">
        <Text className="text-lg font-sans-semibold text-ink">Status</Text>
        <View className="items-start gap-2">
          <ProgressStatus state="saving" mode="read" />
          <ProgressStatus state="saved" mode="read" />
          <ProgressStatus state="saved" mode="listen" />
          <ProgressStatus state="on-device" mode="read" />
          <ProgressStatus state="error" mode="read" />
          <ProgressStatus state="paused" mode="read" />
          <SyncReadiness state="preparing" />
          <SyncReadiness state="ready" />
          <SyncReadiness state="separate" />
        </View>
      </View>

      {openView ? (
        <TakeoverDialog
          visible
          view={fixtureViews[openView]}
          bookTitle="Treasure Island"
          onContinue={() => setOpenView(undefined)}
          onNotNow={() => setOpenView(undefined)}
          onRetry={() => setOpenView(undefined)}
          onCancel={() => setOpenView(undefined)}
          onBackToBook={() => setOpenView(undefined)}
        />
      ) : null}
      <PlaceChoiceDialog
        visible={conflictOpen}
        otherDevice={fixtureIPhone}
        options={fixtureConflictOptions}
        selectedId={selectedPlace}
        onSelect={setSelectedPlace}
        onConfirm={() => setConflictOpen(false)}
        onDecideLater={() => setConflictOpen(false)}
      />
    </Page>
  );
}
