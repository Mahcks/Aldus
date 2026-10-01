import { useRef, useState } from 'react';
import { View as NativeView } from 'react-native';
import { Button, IconButton, Popover, usePointerLayout } from '@/components/ui';
import type { AppIconName } from '@/components/ui/icons';
import { useThemeColors } from '@/components/ui/theme';
import { Text, View } from '@/components/ui/tw';
import {
  setPlayerVolume,
  togglePlayerMute,
  usePlayerVolume,
} from '@/lib/consumption/player-volume';

/**
 * The player's volume on web: an icon in the player's control row that shows
 * the current level and opens a slider with a mute switch. Phone-width
 * browsers use the device's own volume instead.
 */
export function VolumeControl({ disabled = false }: { disabled?: boolean }) {
  const pointerLayout = usePointerLayout();
  const colors = useThemeColors();
  const volume = usePlayerVolume();
  const anchorRef = useRef<NativeView>(null);
  const [open, setOpen] = useState(false);
  const percent = Math.round(volume * 100);

  if (!pointerLayout) return null;

  return (
    <>
      <NativeView ref={anchorRef}>
        <IconButton
          icon={volumeIcon(volume)}
          label={volume > 0 ? `Volume, ${percent}%` : 'Volume, muted'}
          kind="quiet"
          disabled={disabled}
          menuExpanded={open}
          onPress={() => setOpen((value) => !value)}
        />
      </NativeView>
      <Popover
        visible={open}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        label="Volume"
        role="dialog"
        minWidth={240}
      >
        <View className="gap-2 px-2 pb-1 pt-2">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-sans-semibold text-ink">Volume</Text>
            <Text className="text-sm text-muted" style={{ fontVariant: ['tabular-nums'] }}>
              {volume > 0 ? `${percent}%` : 'Muted'}
            </Text>
          </View>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={percent}
            aria-label="Volume"
            aria-valuetext={volume > 0 ? `${percent}%` : 'Muted'}
            onChange={(event) => setPlayerVolume(Number(event.currentTarget.value) / 100)}
            style={{
              width: '100%',
              height: 32,
              margin: 0,
              accentColor: colors.accent,
              cursor: 'pointer',
            }}
          />
          <View className="self-start">
            <Button
              label={volume > 0 ? 'Mute' : 'Unmute'}
              icon={volume > 0 ? 'volumeOff' : 'volumeHigh'}
              kind="quiet"
              onPress={togglePlayerMute}
            />
          </View>
        </View>
      </Popover>
    </>
  );
}

function volumeIcon(volume: number): AppIconName {
  if (volume === 0) return 'volumeOff';
  if (volume < 0.5) return 'volumeLow';
  return 'volumeHigh';
}
