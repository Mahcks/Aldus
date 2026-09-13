import { type PropsWithChildren } from 'react';
import { Text } from './tw';

type NoticeTone = 'info' | 'warning' | 'success' | 'danger';

const NOTICE_TONE_TEXT_CLASS: Record<NoticeTone, string> = {
  info: 'text-info',
  warning: 'text-warning',
  success: 'text-success',
  danger: 'text-danger',
};

export function Notice({
  children,
  danger,
  tone,
}: PropsWithChildren<{ danger?: boolean; tone?: NoticeTone }>) {
  const resolvedTone: NoticeTone | undefined = danger ? 'danger' : tone;
  const textClass = resolvedTone ? NOTICE_TONE_TEXT_CLASS[resolvedTone] : 'text-muted';

  return (
    <Text
      accessibilityRole={resolvedTone === 'danger' ? 'alert' : undefined}
      accessibilityLiveRegion={resolvedTone === 'success' ? 'polite' : undefined}
      className={`text-base leading-5 ${textClass}`}
    >
      {children}
    </Text>
  );
}
