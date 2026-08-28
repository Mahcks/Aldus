import type { Membership } from '@/generated/api';

export function membershipForUser(
  membersByLibrary: Record<string, Membership[]>,
  libraryID: string,
  userID: string,
) {
  return membersByLibrary[libraryID]?.find((member) => member.user_id === userID);
}

export function libraryAccessSummary(
  membersByLibrary: Record<string, Membership[]>,
  userID: string,
) {
  const memberships = Object.values(membersByLibrary)
    .flat()
    .filter((member) => member.user_id === userID);
  const hasExclusiveAccess = memberships.some((membership) => membership.exclusive);
  const count = hasExclusiveAccess
    ? memberships.filter((membership) => membership.exclusive).length
    : memberships.length;
  return { count, hasExclusiveAccess };
}

export function libraryAccessCountLabel(
  membersByLibrary: Record<string, Membership[]>,
  userID: string,
) {
  const { count } = libraryAccessSummary(membersByLibrary, userID);
  return `${count} ${count === 1 ? 'library' : 'libraries'}`;
}

export function membershipAccessLabel(
  membership: Membership | undefined,
  hasExclusiveAccess: boolean,
) {
  if (!membership) return 'Not available';
  if (hasExclusiveAccess && !membership.exclusive) return 'Excluded by access limit';
  return `${membership.role} access`;
}
