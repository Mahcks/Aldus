import { describe, expect, it } from 'bun:test';
import type { Membership } from '@/generated/api';
import {
  libraryAccessCountLabel,
  libraryAccessSummary,
  membershipAccessLabel,
} from './user-library-access';

const membership = (libraryRole: string, exclusive = false): Membership => ({
  user_id: 'reader',
  username: 'reader',
  display_name: 'Reader',
  role: libraryRole,
  exclusive,
  can_request_acquisitions: false,
  can_bypass_acquisition_approval: false,
  can_advanced_acquisition_request: false,
});

describe('user library access presentation', () => {
  it('counts only exclusive grants when an access limit exists', () => {
    const standard = membership('reader');
    const exclusive = membership('reader', true);
    const summary = libraryAccessSummary({ first: [standard], second: [exclusive] }, 'reader');

    expect(summary).toEqual({ count: 1, hasExclusiveAccess: true });
    expect(libraryAccessCountLabel({ first: [standard], second: [exclusive] }, 'reader')).toBe(
      '1 library',
    );
    expect(membershipAccessLabel(standard, summary.hasExclusiveAccess)).toBe(
      'Excluded by access limit',
    );
    expect(membershipAccessLabel(exclusive, summary.hasExclusiveAccess)).toBe('reader access');
  });
});
