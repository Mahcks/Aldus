import { ActivityIndicator } from 'react-native';
import { AppIcon } from '@/components/ui/icons';
import { Button, Dialog, Notice } from '@/components/ui';
import { useThemeColors } from '@/components/ui/theme';
import { Text, View } from '@/components/ui/tw';
import {
  deviceName,
  takeoverCopy,
  type HandoffDevice,
  type TakeoverStep,
  type TakeoverView,
} from '@/lib/consumption/handoff-copy';

/**
 * The dialog for moving a session to this device: the question, the wait, and
 * the failures. It only renders the state it is given. Ownership, the request
 * itself, and restoring the saved place all belong to the logic that owns
 * `view`; this component never decides when a step has finished.
 */
export function TakeoverDialog({
  visible,
  view,
  bookTitle,
  onContinue,
  onNotNow,
  onRetry,
  onCancel,
  onBackToBook,
}: {
  visible: boolean;
  view: TakeoverView;
  bookTitle: string;
  onContinue: () => void;
  /** "Not now" returns the user to book details. */
  onNotNow: () => void;
  onRetry: () => void;
  onCancel: () => void;
  onBackToBook: () => void;
}) {
  const copy = takeoverCopy(view, bookTitle);
  const primaryAction = view.kind === 'prompt' ? onContinue : onRetry;
  const secondaryAction = resolveSecondaryAction(view, { onNotNow, onCancel, onBackToBook });

  return (
    <Dialog
      visible={visible}
      title={copy.title}
      sheet
      dismissible={view.kind !== 'pending'}
      onClose={secondaryAction}
      footer={
        copy.primary || copy.secondary ? (
          <View className="gap-2 sm:flex-row-reverse sm:justify-start">
            {copy.primary ? (
              <Button label={copy.primary} kind="primary" onPress={primaryAction} />
            ) : null}
            {copy.secondary ? (
              <Button label={copy.secondary} kind="quiet" onPress={secondaryAction} />
            ) : null}
          </View>
        ) : undefined
      }
    >
      <View className="gap-4">
        {view.kind === 'failed' ? (
          <Notice danger>{copy.body}</Notice>
        ) : (
          <Text className="text-base leading-6 text-text-secondary">{copy.body}</Text>
        )}

        {view.kind === 'prompt' ? (
          <View className="gap-3">
            <DeviceRow device={view.device} detail={copy.lastActive} />
            {copy.savedPlace ? (
              <Text className="text-sm text-muted">
                Saved place · <Text className="font-sans-semibold text-ink">{copy.savedPlace}</Text>
              </Text>
            ) : null}
            {copy.help ? <Text className="text-sm leading-5 text-muted">{copy.help}</Text> : null}
          </View>
        ) : null}

        {copy.steps ? (
          <View accessibilityLiveRegion="polite" aria-busy className="gap-1">
            {copy.steps.map((step) => (
              <StepRow key={step.label} step={step} />
            ))}
            {copy.footnote ? (
              <Text className="pt-2 text-sm text-muted">{copy.footnote}</Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </Dialog>
  );
}

function resolveSecondaryAction(
  view: TakeoverView,
  actions: { onNotNow: () => void; onCancel: () => void; onBackToBook: () => void },
) {
  if (view.kind === 'pending') return actions.onCancel;
  if (view.kind === 'failed' && (view.reason === 'restore' || view.reason === 'not-downloaded')) {
    return actions.onBackToBook;
  }
  return actions.onNotNow;
}

function DeviceRow({ device, detail }: { device: HandoffDevice; detail?: string }) {
  const colors = useThemeColors();

  return (
    <View className="flex-row items-center gap-3 rounded-card border border-line-subtle bg-canvas px-4 py-3">
      <View className="h-10 w-10 items-center justify-center rounded-full bg-accent-soft">
        <AppIcon
          name={device.platform === 'web' ? 'monitor' : 'phone'}
          size={20}
          color={colors.accent}
        />
      </View>
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-base font-sans-semibold text-ink">
          {capitalizeFirst(deviceName(device))}
        </Text>
        {detail ? <Text className="text-sm text-muted">{detail}</Text> : null}
      </View>
    </View>
  );
}

function StepRow({ step }: { step: TakeoverStep }) {
  const colors = useThemeColors();
  const waiting = step.state === 'wait';

  return (
    <View role="listitem" className="min-h-9 flex-row items-center gap-3">
      <View className="w-5 items-center">
        {step.state === 'done' ? <AppIcon name="enabled" size={20} color={colors.success} /> : null}
        {step.state === 'now' ? <ActivityIndicator size="small" color={colors.accent} /> : null}
        {waiting ? <View className="h-4 w-4 rounded-full border-2 border-line-strong" /> : null}
      </View>
      <Text
        className={`text-sm ${waiting ? 'text-subtle' : 'text-ink'} ${step.state === 'now' ? 'font-sans-semibold' : ''}`}
      >
        {step.label}
      </Text>
    </View>
  );
}

function capitalizeFirst(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
