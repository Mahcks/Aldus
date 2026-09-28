import type { RefObject } from 'react';
import { Platform, type View as NativeView } from 'react-native';
import { MenuItem, Popover } from '@/components/ui';
import type { WorkQuickAction } from '@/lib/catalog/work-actions';

/** A book's quick actions: anchored to its card on web, a bottom sheet on phones. */
export function WorkActionsMenu({
  title,
  actions,
  visible,
  onClose,
  anchorRef,
}: {
  title: string;
  actions: WorkQuickAction[];
  visible: boolean;
  onClose: () => void;
  anchorRef: RefObject<NativeView | null>;
}) {
  return (
    <Popover
      visible={visible}
      onClose={onClose}
      anchorRef={anchorRef}
      label={`Actions for ${title}`}
      // Opens leftward under the ⋯ button, over its own cover rather than the next book.
      align="end"
      minWidth={220}
    >
      {actions.map((action) => (
        <MenuItem
          key={action.label}
          label={action.label}
          onPress={() => {
            onClose();
            action.onPress();
          }}
        />
      ))}
    </Popover>
  );
}

/**
 * Right-click (or the keyboard's context-menu key) opens the book's actions
 * on web. React Native's View types omit `onContextMenu`, which RN Web forwards.
 */
export function contextMenuProps(onOpen: (() => void) | undefined): object {
  if (Platform.OS !== 'web' || !onOpen) return {};
  return {
    onContextMenu: (event: { preventDefault: () => void }) => {
      event.preventDefault();
      onOpen();
    },
  };
}
