import { useRef, useState } from 'react';
import { View as NativeView } from 'react-native';
import { IconButton, MenuItem, MenuSeparator, Popover } from '@/components/ui';

export type LibraryManageAction =
  'work' | 'metadata' | 'members' | 'sources' | 'policy' | 'settings';

/**
 * The cog that opens a library's management actions: a menu anchored to the
 * cog on web, a bottom sheet on phones. Editors see the catalog actions;
 * owners and administrators also see members and settings.
 */
export function LibraryManageMenu({
  label,
  canEdit,
  canManage,
  onSelect,
}: {
  label: string;
  canEdit: boolean;
  canManage: boolean;
  onSelect: (action: LibraryManageAction) => void;
}) {
  const anchorRef = useRef<NativeView>(null);
  const [open, setOpen] = useState(false);

  function choose(action: LibraryManageAction) {
    setOpen(false);
    onSelect(action);
  }

  return (
    <>
      <NativeView ref={anchorRef}>
        <IconButton
          icon="settings"
          label={label}
          kind="quiet"
          menuExpanded={open}
          onPress={() => setOpen((value) => !value)}
        />
      </NativeView>
      <Popover
        visible={open}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        label={label}
        align="end"
        minWidth={240}
      >
        {canEdit ? <MenuItem icon="add" label="Add work" onPress={() => choose('work')} /> : null}
        {canEdit ? (
          <MenuItem icon="search" label="Metadata" onPress={() => choose('metadata')} />
        ) : null}
        {canManage ? (
          <MenuItem icon="users" label="Members" onPress={() => choose('members')} />
        ) : null}
        {canEdit ? (
          <MenuItem icon="folder" label="Sources" onPress={() => choose('sources')} />
        ) : null}
        {canEdit ? (
          <MenuItem icon="acquire" label="Acquisition policy" onPress={() => choose('policy')} />
        ) : null}
        {canManage ? (
          <>
            <MenuSeparator />
            <MenuItem icon="settings" label="Library settings" onPress={() => choose('settings')} />
          </>
        ) : null}
      </Popover>
    </>
  );
}
