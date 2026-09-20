import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactNode,
} from 'react';
import { KeyboardAvoidingView, Modal, Platform, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';
import { AppIcon } from './icons';
import { fadeIn } from './motion';
import { useThemeColors } from './theme';
import { Pressable, ScrollView, Text, View } from './tw';
import { Button, IconButton } from './Button';
import { Row } from './layout';

/**
 * Shared modal primitive. Replaces one-off `Modal` wrappers throughout the
 * app. Dismisses on backdrop press; on web, Escape closes it and focus moves
 * into the dialog on open and is restored to the previously focused element
 * on close.
 */
export function Dialog({
  visible,
  onClose,
  title,
  children,
  wide,
  fullScreen,
  sheet = false,
  footer,
  scrollHint,
}: PropsWithChildren<{
  visible: boolean;
  onClose: () => void;
  title: string;
  wide?: boolean;
  fullScreen?: boolean;
  sheet?: boolean;
  footer?: ReactNode;
  scrollHint?: string;
}>) {
  const colors = useThemeColors();
  const closeButtonId = useId();
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  const previouslyFocusedRef = useRef<{ focus: () => void } | null>(null);
  const scrollMetricsRef = useRef({ content: 0, viewport: 0, offset: 0 });
  const [showScrollHint, setShowScrollHint] = useState(false);
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const bottomSheet = sheet && windowWidth < 600;
  const insets = useSafeAreaInsets();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const updateScrollHint = useCallback(
    (next: Partial<(typeof scrollMetricsRef)['current']>) => {
      Object.assign(scrollMetricsRef.current, next);
      const { content, viewport, offset } = scrollMetricsRef.current;
      setShowScrollHint(Boolean(scrollHint && content > viewport + offset + 12));
    },
    [scrollHint],
  );

  useEffect(() => {
    if (!visible) return;
    scrollMetricsRef.current.offset = 0;
    updateScrollHint({});
  }, [updateScrollHint, visible]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !visible) return;

    previouslyFocusedRef.current = document.activeElement as { focus: () => void } | null;
    const focusTimer = setTimeout(() => {
      document.getElementById(closeButtonId)?.focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
      previouslyFocusedRef.current?.focus();
    };
  }, [visible, closeButtonId]);

  if (!visible) return null;

  const maxWidthClass = wide ? 'max-w-[720px]' : 'max-w-[480px]';
  const dialogMaxHeight = Math.max(0, windowHeight - (bottomSheet ? insets.top + 32 : 32));
  const dialog = (
    <View
      accessibilityViewIsModal
      aria-labelledby={titleId}
      role="dialog"
      style={fullScreen ? { flex: 1 } : { maxHeight: dialogMaxHeight }}
      className={
        fullScreen
          ? 'w-full bg-raised'
          : `w-full overflow-hidden bg-raised ${bottomSheet ? 'rounded-t-dialog' : `rounded-dialog border border-line shadow-popover ${maxWidthClass}`} `
      }
    >
      <View
        className="flex-row items-center justify-between gap-4 border-b border-line px-6 py-3"
        style={fullScreen ? { paddingTop: insets.top + 8, paddingBottom: 8 } : undefined}
      >
        <Text
          nativeID={titleId}
          accessibilityRole="header"
          className="flex-shrink text-lg font-sans-bold text-ink"
        >
          {title}
        </Text>
        <IconButton
          icon="close"
          label="Close dialog"
          kind="quiet"
          onPress={onClose}
          nativeID={closeButtonId}
        />
      </View>
      <ScrollView
        className={fullScreen ? 'min-h-0 flex-1 px-5 py-4' : 'min-h-0 flex-shrink px-6 py-4'}
        contentContainerClassName={fullScreen && scrollHint ? 'pb-20' : 'pb-4'}
        contentInset={{ bottom: fullScreen ? insets.bottom : 0 }}
        scrollIndicatorInsets={{ bottom: fullScreen ? insets.bottom : 0 }}
        onContentSizeChange={(_width, content) => updateScrollHint({ content })}
        onLayout={(event) => updateScrollHint({ viewport: event.nativeEvent.layout.height })}
        onScroll={(event) => updateScrollHint({ offset: event.nativeEvent.contentOffset.y })}
        scrollEventThrottle={32}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
      >
        {children}
      </ScrollView>
      {footer ? (
        <View
          className="flex-none border-t border-line-subtle bg-raised px-6 pt-3"
          style={{ paddingBottom: bottomSheet ? Math.max(insets.bottom, 16) : 16 }}
        >
          {footer}
        </View>
      ) : null}
      {fullScreen && showScrollHint ? (
        <View
          pointerEvents="none"
          className="absolute inset-x-0 bottom-0 flex-row items-center justify-center gap-1 border-t border-line bg-raised px-4 pt-2"
          style={{ paddingBottom: Math.max(insets.bottom, 8) }}
        >
          <Text className="text-xs font-sans-semibold text-muted">{scrollHint}</Text>
          <AppIcon name="moveDown" size={16} color={colors.muted} />
        </View>
      ) : null}
    </View>
  );

  return (
    <Modal
      transparent={!fullScreen}
      visible={visible}
      animationType={fullScreen ? 'slide' : 'fade'}
      presentationStyle={fullScreen ? 'fullScreen' : undefined}
      onRequestClose={onClose}
    >
      {/*
       * Modal renders in its own native window on Android, so the activity's
       * automatic keyboard resize never reaches content inside it — without
       * this, the keyboard simply covers whatever field is focused. `padding`
       * on iOS avoids the double-adjustment that `height` causes there.
       */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <View
          className={
            fullScreen
              ? 'flex-1 bg-raised'
              : bottomSheet
                ? 'flex-1 items-center justify-end'
                : 'flex-1 items-center justify-center p-4'
          }
        >
          {/*
           * The backdrop is a plain (non-button) Pressable positioned behind the
           * dialog content, not a wrapping ancestor of it — an ancestor with
           * accessibilityRole="button" renders as an actual <button> on web,
           * which would illegally nest the dialog's own interactive controls
           * (e.g. the Close IconButton) inside it. Escape and the visible Close
           * button remain the accessible dismiss paths; this is a supplementary
           * pointer convenience only, so it intentionally carries no button role.
           */}
          {fullScreen ? null : (
            <Pressable
              accessibilityLabel="Dismiss dialog"
              onPress={onClose}
              className="absolute inset-0 bg-ink/40"
            />
          )}
          <Animated.View
            entering={fullScreen ? undefined : fadeIn}
            style={{ width: '100%', flex: fullScreen ? 1 : undefined, alignItems: 'center' }}
          >
            {dialog}
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * Shared confirmation dialog. Replaces raw `Alert.alert` confirms used for
 * destructive actions (remove member, delete library, delete source, …).
 */
export function ConfirmDialog({
  visible,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  danger,
  busy,
}: {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
}) {
  return (
    <Dialog visible={visible} onClose={onClose} title={title}>
      <View className="gap-6">
        <Text className="text-base leading-6 text-muted">{description}</Text>
        <Row>
          <Button label="Cancel" kind="secondary" onPress={onClose} disabled={busy} />
          <Button
            label={confirmLabel}
            kind={danger ? 'danger' : 'primary'}
            onPress={onConfirm}
            loading={busy}
          />
        </Row>
      </View>
    </Dialog>
  );
}
