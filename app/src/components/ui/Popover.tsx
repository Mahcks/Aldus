import type { ReactNode, RefObject } from 'react';
import type { View as NativeView } from 'react-native';
import { Dialog } from './Dialog';
import { SheetContent } from './popover-role';

export type PopoverProps = {
  visible: boolean;
  onClose: () => void;
  /** The trigger the popover opens from; wrap it in a react-native `View` carrying this ref. */
  anchorRef: RefObject<NativeView | null>;
  /** Names the popover for assistive tech, and titles the sheet on phones. */
  label: string;
  role?: 'menu' | 'listbox' | 'dialog';
  /** Which edge of the anchor the popover lines up with. */
  align?: 'start' | 'end';
  /** Popovers are at least as wide as their anchor; this raises that floor. */
  minWidth?: number;
  children: ReactNode;
};

/**
 * A choice or action list opened from a trigger. Native apps always present
 * it as a bottom sheet; the web build anchors it to the trigger on wider
 * windows (`Popover.web.tsx`).
 */
export function Popover({ visible, onClose, label, role = 'menu', children }: PopoverProps) {
  return (
    <Dialog sheet visible={visible} title={label} onClose={onClose}>
      <SheetContent role={role} label={label}>
        {children}
      </SheetContent>
    </Dialog>
  );
}
