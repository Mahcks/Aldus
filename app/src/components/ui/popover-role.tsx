import type { ReactNode } from 'react';
import { View } from './tw';

type PopoverRole = 'menu' | 'listbox' | 'dialog';

/**
 * React Native's `Role` type omits `listbox`, which RN Web still renders
 * as-is. Shared by `Popover.tsx` and `Popover.web.tsx`, which cannot import
 * each other (`./Popover` resolves to the web file on web).
 */
export function popoverRoleProps(role: PopoverRole): object {
  return { role };
}

/**
 * A popover's content presented in a bottom sheet. The sheet is already a
 * dialog, so only menus and listboxes need their own role around the items.
 */
export function SheetContent({
  role,
  label,
  children,
}: {
  role: PopoverRole;
  label: string;
  children: ReactNode;
}) {
  if (role === 'dialog') return <>{children}</>;
  return (
    <View {...popoverRoleProps(role)} aria-label={label}>
      {children}
    </View>
  );
}
