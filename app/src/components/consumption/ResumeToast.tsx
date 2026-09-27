import { useEffect, useState } from 'react';
import { AppIcon } from '@/components/ui/icons';
import { fadeIn, fadeOut } from '@/components/ui/motion';
import { useThemeColors } from '@/components/ui/theme';
import { AnimatedView, Text } from '@/components/ui/tw';

const VISIBLE_MS = 5000;

/**
 * "Resumed from Aldus on iOS", shown briefly under the header and then gone.
 * It confirms where the place came from without leaving a permanent strip on the page.
 */
export function ResumeToast({ message }: { message: string }) {
  const colors = useThemeColors();
  const [dismissedMessage, setDismissedMessage] = useState('');

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setDismissedMessage(message), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  if (!message || dismissedMessage === message) return null;

  return (
    <AnimatedView
      key={message}
      entering={fadeIn}
      exiting={fadeOut}
      style={{ pointerEvents: 'none' }}
      accessibilityLiveRegion="polite"
      className="absolute inset-x-0 top-2 z-10 items-center"
    >
      <AnimatedView className="h-8 flex-row items-center gap-2 rounded-pill bg-paper px-4 shadow-sm">
        <AppIcon name="synced" size={14} color={colors.muted} />
        <Text className="text-xs font-sans-medium text-muted">{message}</Text>
      </AnimatedView>
    </AnimatedView>
  );
}
