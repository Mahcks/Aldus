import { useEffect, useRef, useState } from 'react';
import { Platform, type GestureResponderEvent } from 'react-native';
import { clampAudioPosition, formatAudioTime, scrubberPosition } from './consumption';
import { Text, View } from './tw';

// Move incrementally so changing precision never jumps to a different point in the book.
function scrubberDrag(position: number, dx: number, rise: number, width: number, duration: number) {
  const precision = rise >= 120 ? 20 : rise >= 60 ? 5 : 1;
  if (width <= 0) return position;
  return clampAudioPosition(position + ((dx / width) * duration) / precision, duration);
}

export function AudioScrubber({
  position,
  duration,
  enabled,
  onSeek,
  onScrubbingChange,
}: {
  position: number;
  duration: number;
  enabled: boolean;
  onSeek: (seconds: number) => Promise<void>;
  onScrubbingChange: (scrubbing: boolean) => void;
}) {
  const [width, setWidth] = useState(0);
  const [preview, setPreview] = useState<number>();
  const [rise, setRise] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const drag = useRef<{ x: number; y: number; position: number } | undefined>(undefined);
  const busy = useRef(false);
  const active = enabled && duration > 0 && !seeking;
  const acknowledged = preview != null && !dragging && !seeking && Math.abs(position - preview) < 2;
  const displayed = acknowledged ? position : (preview ?? position);
  const fraction = duration > 0 ? clampAudioPosition(displayed, duration) / duration : 0;

  // Hold the preview until the player acknowledges the seek, with a bounded fallback.
  useEffect(() => {
    if (preview == null || dragging || seeking) return;
    const timer = setTimeout(() => setPreview(undefined), 2000);
    return () => clearTimeout(timer);
  }, [preview, seeking, dragging]);

  useEffect(() => {
    if (!acknowledged) return;
    const timer = setTimeout(() => setPreview(undefined), 0);
    return () => clearTimeout(timer);
  }, [acknowledged]);

  useEffect(() => () => onScrubbingChange(false), [onScrubbingChange]);

  async function commit(target: number) {
    if (!enabled || busy.current) return;
    busy.current = true;
    setSeeking(true);
    setPreview(target);
    try {
      await onSeek(target);
    } finally {
      busy.current = false;
      setSeeking(false);
    }
  }

  function start(event: GestureResponderEvent) {
    if (Platform.OS === 'web') event.preventDefault();
    const { pageX, pageY, locationX } = event.nativeEvent;
    const target = scrubberPosition(locationX, width, duration);
    if (!active || target == null) return;
    drag.current = { x: pageX, y: pageY, position: target };
    setDragging(true);
    onScrubbingChange(true);
    setRise(0);
    setPreview(target);
  }

  function move(event: GestureResponderEvent) {
    if (Platform.OS === 'web') event.preventDefault();
    const current = drag.current;
    if (!current) return;
    const { pageX, pageY } = event.nativeEvent;
    const nextRise = Math.max(0, current.y - pageY);
    current.position = scrubberDrag(current.position, pageX - current.x, nextRise, width, duration);
    current.x = pageX;
    setRise(nextRise);
    setPreview(current.position);
  }

  function release() {
    const current = drag.current;
    drag.current = undefined;
    setDragging(false);
    onScrubbingChange(false);
    setRise(0);
    if (current) void commit(current.position);
  }

  function cancel() {
    drag.current = undefined;
    setDragging(false);
    onScrubbingChange(false);
    setRise(0);
    setPreview(undefined);
  }

  function step(delta: number) {
    if (active) void commit(clampAudioPosition(displayed + delta, duration));
  }

  const keyboardProps =
    Platform.OS === 'web'
      ? {
          'aria-valuemin': 0,
          'aria-valuemax': Math.round(duration),
          'aria-valuenow': Math.round(displayed),
          'aria-valuetext': `${formatAudioTime(displayed)} of ${formatAudioTime(duration)}`,
          'aria-disabled': !active,
          onKeyDown(event: { key: string; preventDefault: () => void }) {
            if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
              event.preventDefault();
              step(event.key === 'ArrowRight' ? 5 : -5);
            }
          },
        }
      : {};

  return (
    <View className="w-full gap-1">
      {dragging || seeking ? (
        <View
          pointerEvents="none"
          className="absolute bottom-full left-0 right-0 items-center pb-1"
        >
          <Text className="text-xs font-sans-semibold text-accent">
            {seeking
              ? 'Seeking…'
              : rise >= 120
                ? 'Fine scrubbing · 1/20 speed'
                : rise >= 60
                  ? 'Fine scrubbing · 1/5 speed'
                  : 'Slide up for finer control'}
          </Text>
        </View>
      ) : null}
      <View
        accessibilityRole="adjustable"
        accessibilityLabel="Audiobook position"
        accessibilityHint="Drag to seek. Slide upward while dragging for finer control."
        accessibilityValue={{
          min: 0,
          max: Math.round(duration),
          now: Math.round(displayed),
          text: `${formatAudioTime(displayed)} of ${formatAudioTime(duration)}`,
        }}
        accessibilityState={{ disabled: !active }}
        accessibilityActions={[
          { name: 'increment', label: 'Skip ahead 5 seconds' },
          { name: 'decrement', label: 'Skip back 5 seconds' },
        ]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'increment') step(5);
          if (event.nativeEvent.actionName === 'decrement') step(-5);
        }}
        focusable
        className={`h-11 w-full touch-none justify-center rounded-control focus-visible:border focus-visible:border-focus ${enabled ? '' : 'opacity-50'}`}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => active}
        onResponderGrant={start}
        onResponderMove={move}
        onResponderRelease={release}
        onResponderTerminate={cancel}
        onResponderTerminationRequest={() => false}
        {...keyboardProps}
      >
        <View
          pointerEvents="none"
          className="absolute left-0 right-0 h-1.5 rounded-pill bg-panel-strong"
        />
        <View
          pointerEvents="none"
          className="absolute left-0 h-1.5 rounded-pill bg-accent"
          style={{ width: `${fraction * 100}%` }}
        />
        {enabled ? (
          <View
            pointerEvents="none"
            className="absolute h-4 w-4 rounded-pill bg-accent shadow-xs"
            style={{
              left: Math.max(8, Math.min(width - 8, fraction * width)),
              transform: [{ translateX: -8 }, { scale: dragging ? 1.35 : 1 }],
            }}
          />
        ) : null}
      </View>
      <View className="flex-row justify-between">
        <Text
          className="text-[13px] font-sans-semibold text-ink"
          style={{ fontVariant: ['tabular-nums'] }}
        >
          {formatAudioTime(displayed)}
        </Text>
        <Text className="text-[13px] text-subtle" style={{ fontVariant: ['tabular-nums'] }}>
          {formatAudioTime(duration)}
        </Text>
      </View>
    </View>
  );
}
