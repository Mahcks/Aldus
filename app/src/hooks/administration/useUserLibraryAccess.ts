import { useCallback, useRef, useState } from 'react';
import type { Library, Membership } from '@/generated/api';
import { api, errorMessage } from '@/lib/api';
import { membershipForUser } from '@/lib/administration/user-library-access';

export function useUserLibraryAccess(userID: string | undefined) {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [membersByLibrary, setMembersByLibrary] = useState<Record<string, Membership[]>>({});
  const accessLock = useRef(false);
  const [accessLoading, setAccessLoading] = useState(true);
  const [accessBusy, setAccessBusy] = useState('');
  const [accessError, setAccessError] = useState('');
  const loadLibraryAccess = useCallback(async () => {
    setAccessLoading(true);
    setAccessError('');
    try {
      const items: Library[] = [];
      for (;;) {
        const page = await api.libraries(items.length);
        items.push(...page);
        if (page.length < 100) break;
      }
      const memberPages = await Promise.all(items.map((library) => api.members(library.id)));
      setLibraries(items);
      setMembersByLibrary(
        Object.fromEntries(items.map((library, index) => [library.id, memberPages[index]])),
      );
    } catch (value) {
      setAccessError(errorMessage(value));
    } finally {
      setAccessLoading(false);
    }
  }, []);

  function selectedMembership(libraryID: string) {
    return userID ? membershipForUser(membersByLibrary, libraryID, userID) : undefined;
  }

  async function changeLibraryRole(library: Library, role: string) {
    if (!userID || accessLock.current) return;
    const membership = selectedMembership(library.id);
    if (membership?.role === role || (!membership && !role)) return;
    accessLock.current = true;
    setAccessBusy(library.id);
    setAccessError('');
    try {
      if (!role) {
        await api.removeMember(library.id, userID);
      } else {
        await api.setMember(
          library.id,
          userID,
          role,
          membership?.can_request_acquisitions,
          membership?.can_bypass_acquisition_approval,
          membership?.can_advanced_acquisition_request,
          membership?.exclusive,
        );
      }
      const members = await api.members(library.id);
      setMembersByLibrary((current) => ({ ...current, [library.id]: members }));
    } catch (value) {
      setAccessError(errorMessage(value));
    } finally {
      accessLock.current = false;
      setAccessBusy('');
    }
  }

  async function toggleLibraryPermission(
    library: Library,
    permission: 'request' | 'bypass' | 'advanced' | 'exclusive',
  ) {
    const membership = selectedMembership(library.id);
    if (!userID || !membership || accessLock.current) return;
    accessLock.current = true;
    setAccessBusy(library.id);
    setAccessError('');
    try {
      await api.setMember(
        library.id,
        userID,
        membership.role,
        permission === 'request'
          ? !membership.can_request_acquisitions
          : membership.can_request_acquisitions,
        permission === 'bypass'
          ? !membership.can_bypass_acquisition_approval
          : membership.can_bypass_acquisition_approval,
        permission === 'advanced'
          ? !membership.can_advanced_acquisition_request
          : membership.can_advanced_acquisition_request,
        permission === 'exclusive' ? !membership.exclusive : membership.exclusive,
      );
      const members = await api.members(library.id);
      setMembersByLibrary((current) => ({ ...current, [library.id]: members }));
    } catch (value) {
      setAccessError(errorMessage(value));
    } finally {
      accessLock.current = false;
      setAccessBusy('');
    }
  }

  return {
    libraries,
    membersByLibrary,
    accessLoading,
    accessBusy,
    accessError,
    setAccessError,
    loadLibraryAccess,
    selectedMembership,
    changeLibraryRole,
    toggleLibraryPermission,
  };
}
