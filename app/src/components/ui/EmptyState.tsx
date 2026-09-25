import { type PropsWithChildren, type ReactNode } from 'react';
import { AppIcon, type AppIconName } from './icons';
import { useThemeColors } from './theme';
import { fadeIn, popIn } from './motion';
import { AnimatedView, Text } from './tw';

export function Empty({ children }: PropsWithChildren) {
  return <Text className="py-4 text-muted">{children}</Text>;
}

/** Shared body for `EmptyState`/`ErrorState` — same layout, only icon/tone/default-title differ. */
function StateBlock({
  icon,
  iconBackgroundClass,
  iconColor,
  title,
  children,
  action,
  titleIsHeader = true,
}: PropsWithChildren<{
  icon: AppIconName;
  iconBackgroundClass: string;
  iconColor: string;
  title: string;
  action?: ReactNode;
  titleIsHeader?: boolean;
}>) {
  return (
    <AnimatedView
      entering={fadeIn}
      accessibilityLiveRegion="polite"
      className="min-h-[180px] max-w-[420px] items-center justify-center gap-3 self-center py-4"
    >
      <AnimatedView
        entering={popIn}
        className={`h-14 w-14 items-center justify-center rounded-full shadow-xs ${iconBackgroundClass}`}
      >
        <AppIcon name={icon} size={28} color={iconColor} />
      </AnimatedView>
      <Text
        accessibilityRole={titleIsHeader ? 'header' : undefined}
        className="text-center text-base font-sans-semibold text-ink"
      >
        {title}
      </Text>
      <Text className="text-center text-base leading-6 text-muted">{children}</Text>
      {action}
    </AnimatedView>
  );
}

export function EmptyState({
  icon = 'read',
  title,
  children,
  action,
}: PropsWithChildren<{
  icon?: AppIconName;
  title: string;
  action?: ReactNode;
}>) {
  const colors = useThemeColors();
  return (
    <StateBlock
      icon={icon}
      iconBackgroundClass="bg-neutral-soft"
      iconColor={colors.neutral}
      title={title}
      action={action}
      titleIsHeader={false}
    >
      {children}
    </StateBlock>
  );
}

/** Same shape as `EmptyState` but for genuine error conditions, not "nothing here yet". */
export function ErrorState({
  title = 'Something went wrong',
  children,
  action,
}: PropsWithChildren<{
  title?: string;
  action?: ReactNode;
}>) {
  const colors = useThemeColors();
  return (
    <StateBlock
      icon="error"
      iconBackgroundClass="bg-danger-soft"
      iconColor={colors.danger}
      title={title}
      action={action}
    >
      {children}
    </StateBlock>
  );
}
