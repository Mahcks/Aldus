import { useState } from 'react';
import type { Library, Membership } from '@/generated/api';
import { membershipAccessLabel } from './user-library-access';
import { Text, View } from './tw';
import { Button, Checkbox, Radio } from './ui';

const roles = [
  { value: '', label: 'No access', description: 'This library is hidden from this person.' },
  { value: 'reader', label: 'Reader', description: 'Read and listen to books.' },
  { value: 'editor', label: 'Editor', description: 'Also manage books and acquisition requests.' },
  { value: 'owner', label: 'Owner', description: 'Also manage library settings and members.' },
] as const;

export function LibraryAccessEditor({
  library,
  title,
  accessLabel,
  membership,
  administrator,
  exclusive,
  lastOwner,
  disabled,
  saving,
  multipleLibraries,
  onRoleChange,
  onPermissionChange,
}: {
  library: Library;
  title?: string;
  accessLabel?: string;
  membership?: Membership;
  administrator: boolean;
  exclusive: boolean;
  lastOwner: boolean;
  disabled: boolean;
  saving: boolean;
  multipleLibraries: boolean;
  onRoleChange: (role: '' | 'reader' | 'editor' | 'owner') => void;
  onPermissionChange: (permission: 'request' | 'bypass' | 'advanced' | 'exclusive') => void;
}) {
  const [editingRole, setEditingRole] = useState(false);
  const inheritedAccess = administrator && !exclusive;

  return (
    <View className="gap-4 border-t border-line-subtle py-5">
      <View className="flex-row items-center justify-between gap-4">
        <View className="min-w-0 flex-1 gap-1">
          <Text className="text-base font-sans-semibold text-ink">{title || library.name}</Text>
          <Text className="text-sm text-muted">
            {accessLabel || membershipAccessLabel(membership, exclusive, administrator)}
          </Text>
        </View>
        <Button
          label={editingRole ? 'Done' : 'Change role'}
          kind="quiet"
          onPress={() => setEditingRole((current) => !current)}
        />
      </View>
      {editingRole ? (
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={`${title || library.name} access`}
          className="gap-2"
        >
          {inheritedAccess ? (
            <Text className="text-sm text-muted">
              Administrator access still applies, regardless of the direct role below.
            </Text>
          ) : null}
          {roles.map((role) => (
            <View key={role.value} className="gap-0.5">
              <Radio
                label={inheritedAccess && !role.value ? 'No direct role' : role.label}
                selected={(membership?.role ?? '') === role.value}
                disabled={disabled || (lastOwner && role.value !== 'owner')}
                onPress={() => onRoleChange(role.value)}
              />
              <Text className="pl-8 text-sm text-muted">
                {inheritedAccess && !role.value
                  ? 'Access comes from the administrator account.'
                  : role.description}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {lastOwner ? (
        <Text className="text-sm text-muted">Assign another owner before changing this role.</Text>
      ) : null}
      {saving ? (
        <Text accessibilityLiveRegion="polite" className="text-sm text-muted">
          Saving access…
        </Text>
      ) : null}
      {membership?.role === 'reader' ? (
        <View className="gap-3">
          <View>
            <Checkbox
              label="Request books"
              checked={membership.can_request_acquisitions}
              disabled={disabled}
              onPress={() => onPermissionChange('request')}
            />
            <Text className="pl-8 text-sm text-muted">
              Ask for ebooks and audiobooks from Discover.
            </Text>
          </View>
          {membership.can_request_acquisitions ? (
            <>
              <View>
                <Checkbox
                  label="Download without approval"
                  checked={membership.can_bypass_acquisition_approval}
                  disabled={disabled}
                  onPress={() => onPermissionChange('bypass')}
                />
                <Text className="pl-8 text-sm text-muted">
                  Start requests automatically, without an administrator reviewing them.
                </Text>
              </View>
              <View>
                <Checkbox
                  label="Advanced release choice"
                  checked={membership.can_advanced_acquisition_request}
                  disabled={disabled}
                  onPress={() => onPermissionChange('advanced')}
                />
                <Text className="pl-8 text-sm text-muted">
                  Choose a specific release instead of the suggested match.
                </Text>
              </View>
            </>
          ) : null}
        </View>
      ) : null}
      {membership && multipleLibraries ? (
        <View className="border-t border-line-subtle pt-3">
          <Checkbox
            label="Include in exclusive access"
            checked={membership.exclusive}
            disabled={disabled}
            onPress={() => onPermissionChange('exclusive')}
          />
          <Text className="pl-8 text-sm text-muted">
            When any library is marked, only marked libraries remain available.
          </Text>
        </View>
      ) : null}
    </View>
  );
}
