import type {
  AcquisitionRequest,
  AcquisitionResult,
  AcquisitionSettings,
  AcquisitionConnectionStatus,
  AcquisitionCapabilities,
  AcquisitionPolicy,
  AcquisitionDiscovery,
  AcquisitionPair,
  AcquisitionTracker,
  Alignment,
  ActivitySession,
  AcceptImportProposalRequest,
  AcceptImportProposalResponse,
  AlignmentJob,
  AudioChapter,
  BackupArchive,
  AudioLocator,
  CanonicalPosition,
  Collection,
  CollectionInput,
  CoverCandidate,
  CoverAsset,
  CreateAlignmentJobRequest,
  CreateAcquisitionRequest,
  CreateLibraryRequest,
  CreateGenreTagRequest,
  CreateLibrarySourceRequest,
  CreateRepresentationRequest,
  CreatedUser,
  CreateUserRequest,
  CreateWorkRequest,
  DemoPairing,
  ClaimAccountRequest,
  ChangePasswordRequest,
  DeleteAccountRequest,
  EPUBLocator,
  Library,
  GenreTag,
  UnmatchedGenreSubjectPage,
  LibrarySource,
  ImportProposal,
  LoginRequest,
  Media,
  Membership,
  NotificationList,
  NotificationUnreadCount,
  Representation,
  RepresentationState,
  RepresentationStateUpdate,
  Session,
  SelectAcquisitionRequest,
  SelectAcquisitionPairRequest,
  SetWorkStatusRequest,
  SetWorkPreferenceRequest,
  UpdateAcquisitionSettingsRequest,
  UpdateAcquisitionPolicyRequest,
  SourceEntry,
  SourceDirectoryListing,
  SourceRoot,
  SourceScan,
  SetupStatus,
  SetupRequest,
  SystemDiagnostics,
  ResetPasswordResponse,
  TitleRequest,
  TitleRequestEvent,
  TitleSearchResult,
  CreateTitleRequest,
  StartActivityRequest,
  UpdateLibraryRequest,
  UpdateGenreTagRequest,
  UpdateActivityRequest,
  UpdateLibrarySourceRequest,
  UpdateRepresentationRequest,
  UpdateProfileRequest,
  UpdateUserRequest,
  UpdateWorkRequest,
  UpdateCoverSettingsRequest,
  ReaderCredential,
  ReaderPreferences,
  ReaderPreferencesUpdate,
  CreateReaderCredentialRequest,
  User,
  Work,
  WorkDetail,
  WorkBrowsePage,
  WorkProgressUpdate,
  WorkPreference,
} from '@/generated/api';
import { clearToken, getToken, setToken } from './auth-token';
import { getAPIBaseURL } from './api-base';

let unauthorized: (() => void) | undefined;
export function onUnauthorized(handler?: () => void) {
  unauthorized = handler;
}

export class APIError extends Error {
  constructor(
    public status: number,
    message: string,
    public reference?: string,
  ) {
    super(reference ? `${message} (reference ${reference})` : message);
  }
}

async function responseErrorMessage(response: Response) {
  const message = (await response.text()).trim();
  if (
    response.headers.get('Content-Type')?.includes('text/html') ||
    /^<!doctype html/i.test(message)
  )
    return 'Aldus received a web page instead of an API response. Check the server URL.';
  return message || `Request failed (${response.status}).`;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const origin = getAPIBaseURL();
  const token = await getToken(origin);
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(`${origin}/api${path}`, {
      ...init,
      headers,
      credentials: 'include',
    });
  } catch {
    throw new APIError(0, 'Unable to reach Aldus.');
  }
  if (!response.ok) {
    const message = await responseErrorMessage(response);
    if (response.status === 401) {
      await clearToken(origin);
      if (origin === getAPIBaseURL()) unauthorized?.();
    }
    throw new APIError(
      response.status,
      message,
      response.status >= 500 ? response.headers.get('X-Request-ID') || undefined : undefined,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function download(path: string) {
  const origin = getAPIBaseURL();
  const token = await getToken(origin);
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${origin}/api${path}`, { headers, credentials: 'include' });
  if (!response.ok)
    throw new APIError(
      response.status,
      await responseErrorMessage(response),
      response.status >= 500 ? response.headers.get('X-Request-ID') || undefined : undefined,
    );
  return response.blob();
}

async function acceptSession(session: Session, origin: string) {
  if (session.token) await setToken(session.token, origin);
  return session.user;
}

export const api = {
  setupStatus: () => request<SetupStatus>('/setup/status'),
  setup: (body: SetupRequest) => {
    const origin = getAPIBaseURL();
    return request<Session>('/setup', { method: 'POST', body: JSON.stringify(body) }).then(
      (session) => acceptSession(session, origin),
    );
  },
  login: (body: LoginRequest) => {
    const origin = getAPIBaseURL();
    return request<Session>('/auth/login', { method: 'POST', body: JSON.stringify(body) }).then(
      (session) => acceptSession(session, origin),
    );
  },
  demoLogin: () => {
    const origin = getAPIBaseURL();
    return request<Session>('/auth/demo', { method: 'POST' }).then(async (session) => {
      if (!session.demo_pairing) throw new APIError(500, 'Demo pairing code is missing.');
      return {
        user: await acceptSession(session, origin),
        pairing: session.demo_pairing as DemoPairing,
      };
    });
  },
  pairDemo: (code: string) => {
    const origin = getAPIBaseURL();
    return request<Session>('/auth/demo/pair', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }).then((session) => acceptSession(session, origin));
  },
  me: () => request<User>('/auth/me'),
  claimAccount: (body: ClaimAccountRequest) => {
    const origin = getAPIBaseURL();
    return request<Session>('/auth/claim', { method: 'POST', body: JSON.stringify(body) }).then(
      (session) => acceptSession(session, origin),
    );
  },
  updateProfile: (body: UpdateProfileRequest) =>
    request<User>('/auth/me', { method: 'PATCH', body: JSON.stringify(body) }),
  changePassword: (body: ChangePasswordRequest) => {
    const origin = getAPIBaseURL();
    return request<Session>('/auth/me/password', {
      method: 'PUT',
      body: JSON.stringify(body),
    }).then((session) => acceptSession(session, origin));
  },
  deleteAccount: (body: DeleteAccountRequest = {}) =>
    request<void>('/auth/me', { method: 'DELETE', body: JSON.stringify(body) }),
  systemDiagnostics: () => request<SystemDiagnostics>('/system/diagnostics'),
  backups: () => request<BackupArchive[]>('/system/backups'),
  createBackup: () => request<BackupArchive>('/system/backups', { method: 'POST' }),
  downloadBackup: (name: string) => download(`/system/backups/${encodeURIComponent(name)}`),
  deleteBackup: (name: string) =>
    request<void>(`/system/backups/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  logout: async () => {
    const origin = getAPIBaseURL();
    try {
      await request<void>('/auth/logout', { method: 'POST' });
    } finally {
      await clearToken(origin);
    }
  },
  logoutAll: async () => {
    const origin = getAPIBaseURL();
    await request<void>('/auth/logout-all', { method: 'POST' });
    await clearToken(origin);
  },
  readerCredentials: () => request<ReaderCredential[]>('/me/reader-credentials'),
  createReaderCredential: (body: CreateReaderCredentialRequest) =>
    request<ReaderCredential>('/me/reader-credentials', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteReaderCredential: (id: string) =>
    request<void>(`/me/reader-credentials/${id}`, { method: 'DELETE' }),
  collections: () => request<Collection[]>('/me/collections'),
  collection: (id: string) => request<Collection>(`/me/collections/${id}`),
  createCollection: (body: CollectionInput) =>
    request<Collection>('/me/collections', { method: 'POST', body: JSON.stringify(body) }),
  updateCollection: (id: string, body: CollectionInput) =>
    request<Collection>(`/me/collections/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteCollection: (id: string) => request<void>(`/me/collections/${id}`, { method: 'DELETE' }),
  addCollectionWork: (id: string, workID: string) =>
    request<void>(`/me/collections/${id}/works`, {
      method: 'POST',
      body: JSON.stringify({ work_id: workID }),
    }),
  removeCollectionWork: (id: string, workID: string) =>
    request<void>(`/me/collections/${id}/works/${workID}`, { method: 'DELETE' }),
  reorderCollectionWorks: (id: string, workIDs: string[]) =>
    request<void>(`/me/collections/${id}/works/order`, {
      method: 'PUT',
      body: JSON.stringify({ work_ids: workIDs }),
    }),
  notifications: (offset = 0) =>
    request<NotificationList>(`/me/notifications?limit=50&offset=${offset}`),
  notificationUnreadCount: () => request<NotificationUnreadCount>('/me/notifications/unread-count'),
  markNotificationRead: (id: string) =>
    request<void>(`/me/notifications/${id}/read`, { method: 'POST' }),
  markAllNotificationsRead: () => request<void>('/me/notifications/read-all', { method: 'POST' }),
  searchTitles: (query: string, libraryID = '') => {
    const params = new URLSearchParams({ q: query });
    if (libraryID) params.set('library_id', libraryID);
    return request<TitleSearchResult[]>(`/search/titles?${params}`);
  },
  createTitleRequest: (libraryID: string, body: CreateTitleRequest) =>
    request<TitleRequest>(`/libraries/${libraryID}/title-requests`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  titleRequests: (libraryID: string) =>
    request<TitleRequest[]>(`/libraries/${libraryID}/title-requests`),
  titleRequestEvents: (libraryID: string, requestID: string) =>
    request<TitleRequestEvent[]>(`/libraries/${libraryID}/title-requests/${requestID}/events`),
  approveTitleRequest: (libraryID: string, requestID: string, format: string) =>
    request<TitleRequest>(
      `/libraries/${libraryID}/title-requests/${requestID}/formats/${format}/approve`,
      { method: 'POST' },
    ),
  denyTitleRequest: (libraryID: string, requestID: string, format: string) =>
    request<TitleRequest>(
      `/libraries/${libraryID}/title-requests/${requestID}/formats/${format}/deny`,
      { method: 'POST' },
    ),
  cancelTitleRequest: (libraryID: string, requestID: string, format: string) =>
    request<TitleRequest>(
      `/libraries/${libraryID}/title-requests/${requestID}/formats/${format}/cancel`,
      { method: 'POST' },
    ),

  users: (offset = 0) => request<User[]>(`/users?limit=100&offset=${offset}`),
  createUser: (body: CreateUserRequest) =>
    request<CreatedUser>('/users', { method: 'POST', body: JSON.stringify(body) }),
  updateUser: (id: string, body: UpdateUserRequest) =>
    request<void>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  resetUserPassword: (id: string) =>
    request<ResetPasswordResponse>(`/users/${id}/reset-password`, { method: 'POST' }),

  genreTags: () => request<GenreTag[]>('/genre-tags'),
  unmatchedGenreSubjects: (offset = 0) =>
    request<UnmatchedGenreSubjectPage>(`/genre-tags/unmatched-subjects?limit=50&offset=${offset}`),
  createGenreTag: (body: CreateGenreTagRequest) =>
    request<GenreTag>('/genre-tags', { method: 'POST', body: JSON.stringify(body) }),
  updateGenreTag: (id: string, body: UpdateGenreTagRequest) =>
    request<GenreTag>(`/genre-tags/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteGenreTag: (id: string) => request<void>(`/genre-tags/${id}`, { method: 'DELETE' }),
  setWorkGenreTags: (workID: string, genreTagIDs: string[]) =>
    request<void>(`/works/${workID}/genre-tags`, {
      method: 'PUT',
      body: JSON.stringify({ genre_tag_ids: genreTagIDs }),
    }),
  resetWorkGenreTags: (workID: string) =>
    request<void>(`/works/${workID}/genre-tags`, { method: 'DELETE' }),

  libraries: () => request<Library[]>('/libraries'),
  library: (id: string) => request<Library>(`/libraries/${id}`),
  createLibrary: (body: CreateLibraryRequest) =>
    request<Library>('/libraries', { method: 'POST', body: JSON.stringify(body) }),
  updateLibrary: (id: string, body: UpdateLibraryRequest) =>
    request<void>(`/libraries/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteLibrary: (id: string) => request<void>(`/libraries/${id}`, { method: 'DELETE' }),
  members: (id: string) => request<Membership[]>(`/libraries/${id}/members`),
  setMember: (
    libraryID: string,
    userID: string,
    role: string,
    canRequestAcquisitions = false,
    canBypassAcquisitionApproval = false,
    canAdvancedAcquisitionRequest = false,
    exclusive = false,
  ) =>
    request<void>(`/libraries/${libraryID}/members/${userID}`, {
      method: 'PUT',
      body: JSON.stringify({
        role,
        can_request_acquisitions: canRequestAcquisitions,
        can_bypass_acquisition_approval: canBypassAcquisitionApproval,
        can_advanced_acquisition_request: canAdvancedAcquisitionRequest,
        exclusive,
      }),
    }),
  removeMember: (libraryID: string, userID: string) =>
    request<void>(`/libraries/${libraryID}/members/${userID}`, { method: 'DELETE' }),
  sources: (libraryID: string) => request<LibrarySource[]>(`/libraries/${libraryID}/sources`),
  sourceRoots: () => request<SourceRoot[]>('/source-roots'),
  sourceDirectories: (rootID: string, path = '') =>
    request<SourceDirectoryListing>(
      `/source-roots/${rootID}/directories${path ? `?path=${encodeURIComponent(path)}` : ''}`,
    ),
  createSource: (libraryID: string, body: CreateLibrarySourceRequest) =>
    request<LibrarySource>(`/libraries/${libraryID}/sources`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateSource: (libraryID: string, sourceID: string, body: UpdateLibrarySourceRequest) =>
    request<void>(`/libraries/${libraryID}/sources/${sourceID}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteSource: (libraryID: string, sourceID: string) =>
    request<void>(`/libraries/${libraryID}/sources/${sourceID}`, { method: 'DELETE' }),
  sourceScans: (libraryID: string, sourceID: string) =>
    request<SourceScan[]>(`/libraries/${libraryID}/sources/${sourceID}/scans`),
  startSourceScan: (libraryID: string, sourceID: string) =>
    request<SourceScan>(`/libraries/${libraryID}/sources/${sourceID}/scans`, {
      method: 'POST',
    }),
  sourceEntries: (libraryID: string, sourceID: string) =>
    request<SourceEntry[]>(`/libraries/${libraryID}/sources/${sourceID}/entries`),
  importProposals: (libraryID: string) =>
    request<ImportProposal[]>(`/libraries/${libraryID}/import-proposals`),
  importProposal: (libraryID: string, proposalID: string) =>
    request<ImportProposal>(`/libraries/${libraryID}/import-proposals/${proposalID}`),
  acceptImportProposal: (
    libraryID: string,
    proposalID: string,
    body: AcceptImportProposalRequest,
  ) =>
    request<AcceptImportProposalResponse>(
      `/libraries/${libraryID}/import-proposals/${proposalID}/accept`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  ignoreImportProposal: (libraryID: string, proposalID: string, expectedRevision: number) =>
    request<void>(`/libraries/${libraryID}/import-proposals/${proposalID}/ignore`, {
      method: 'POST',
      body: JSON.stringify({ expected_revision: expectedRevision }),
    }),

  works: (libraryID: string) => request<Work[]>(`/libraries/${libraryID}/works`),
  browseWorks: (
    options: {
      libraryID?: string;
      q?: string;
      sort?: string;
      availability?: string;
      status?: string;
      limit?: number;
      offset?: number;
    } = {},
  ) => {
    const query = new URLSearchParams();
    if (options.libraryID) query.set('library_id', options.libraryID);
    if (options.q) query.set('q', options.q);
    if (options.sort) query.set('sort', options.sort);
    if (options.availability) query.set('availability', options.availability);
    if (options.status) query.set('status', options.status);
    if (options.limit) query.set('limit', String(options.limit));
    if (options.offset) query.set('offset', String(options.offset));
    return request<WorkBrowsePage>(`/works?${query}`);
  },
  work: (id: string) => request<WorkDetail>(`/works/${id}`),
  refreshWorkMetadata: (id: string) =>
    request<WorkDetail>(`/works/${id}/metadata/refresh`, { method: 'POST' }),
  setWorkStatus: (id: string, body: SetWorkStatusRequest) =>
    request<void>(`/works/${id}/status`, { method: 'PUT', body: JSON.stringify(body) }),
  createWork: (libraryID: string, body: CreateWorkRequest) =>
    request<Work>(`/libraries/${libraryID}/works`, { method: 'POST', body: JSON.stringify(body) }),
  updateWork: (id: string, body: UpdateWorkRequest) =>
    request<void>(`/works/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteWork: (id: string) => request<void>(`/works/${id}`, { method: 'DELETE' }),
  searchCovers: (id: string, query: string) =>
    request<CoverCandidate[]>(`/works/${id}/covers/search?q=${encodeURIComponent(query)}`),
  embeddedCovers: (id: string) => request<CoverCandidate[]>(`/works/${id}/covers/search`),
  covers: (id: string) => request<CoverAsset[]>(`/works/${id}/covers`),
  selectCover: (id: string, source: string, sourceID: string) =>
    request<void>(`/works/${id}/cover`, {
      method: 'PUT',
      body: JSON.stringify({ source, source_id: sourceID }),
    }),
  restoreCover: (id: string) => request<void>(`/works/${id}/cover`, { method: 'DELETE' }),
  uploadCover: (id: string, file: Blob, filename: string) => {
    const body = new FormData();
    body.append('file', file, filename);
    return request<void>(`/works/${id}/cover`, { method: 'POST', body });
  },
  updateCoverSettings: (id: string, body: UpdateCoverSettingsRequest) =>
    request<void>(`/works/${id}/cover/settings`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteCover: (workID: string, coverID: string) =>
    request<void>(`/works/${workID}/covers/${coverID}`, { method: 'DELETE' }),

  representations: (workID: string) =>
    request<Representation[]>(`/works/${workID}/representations`),
  representation: (id: string) => request<Representation>(`/representations/${id}`),
  createRepresentation: (workID: string, body: CreateRepresentationRequest) =>
    request<Representation>(`/works/${workID}/representations`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateRepresentation: (id: string, body: UpdateRepresentationRequest) =>
    request<void>(`/representations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteRepresentation: (id: string) =>
    request<void>(`/representations/${id}`, { method: 'DELETE' }),
  media: (libraryID: string, representationID: string) =>
    request<Media[]>(`/libraries/${libraryID}/representations/${representationID}/media`),
  audioChapters: (mediaID: string) => request<AudioChapter[]>(`/media/${mediaID}/chapters`),
  uploadMedia: (libraryID: string, representationID: string, file: Blob, filename: string) => {
    const body = new FormData();
    body.append('file', file, filename);
    return request<Media>(`/libraries/${libraryID}/representations/${representationID}/media`, {
      method: 'POST',
      body,
    });
  },
  mediaBlob: (id: string) => download(`/media/${id}`),

  acquisitionSettings: () => request<AcquisitionSettings>('/acquisition-settings'),
  updateAcquisitionSettings: (body: UpdateAcquisitionSettingsRequest) =>
    request<AcquisitionSettings>('/acquisition-settings', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  testAcquisitionSettings: () =>
    request<AcquisitionConnectionStatus>('/acquisition-settings/test', { method: 'POST' }),
  acquisitionCapabilities: () => request<AcquisitionCapabilities>('/acquisition-capabilities'),
  acquisitionPolicy: (libraryID: string) =>
    request<AcquisitionPolicy>(`/libraries/${libraryID}/acquisition-policy`),
  updateAcquisitionPolicy: (libraryID: string, body: UpdateAcquisitionPolicyRequest) =>
    request<AcquisitionPolicy>(`/libraries/${libraryID}/acquisition-policy`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  acquisitionTracker: () => request<AcquisitionTracker>('/me/acquisition-tracker'),
  markAcquisitionTrackerSeen: () =>
    request<void>('/me/acquisition-tracker/seen', { method: 'POST' }),
  acquisitionRequests: (libraryID: string) =>
    request<AcquisitionRequest[]>(`/libraries/${libraryID}/acquisition-requests`),
  retryAcquisition: (libraryID: string, requestID: string) =>
    request<void>(`/libraries/${libraryID}/acquisition-requests/${requestID}/retry`, {
      method: 'POST',
    }),
  cancelAcquisition: (libraryID: string, requestID: string) =>
    request<void>(`/libraries/${libraryID}/acquisition-requests/${requestID}/cancel`, {
      method: 'POST',
    }),
  dismissAcquisition: (libraryID: string, requestID: string) =>
    request<void>(`/libraries/${libraryID}/acquisition-requests/${requestID}/dismiss`, {
      method: 'POST',
    }),
  discoverAcquisitions: (libraryID: string, body: CreateAcquisitionRequest) =>
    request<AcquisitionDiscovery>(`/libraries/${libraryID}/acquisition-discoveries`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  selectAcquisitionDiscovery: (
    libraryID: string,
    discoveryID: string,
    body: SelectAcquisitionRequest,
  ) =>
    request<AcquisitionRequest>(
      `/libraries/${libraryID}/acquisition-discoveries/${discoveryID}/select`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  selectAcquisitionPair: (
    libraryID: string,
    discoveryID: string,
    body: SelectAcquisitionPairRequest,
  ) =>
    request<AcquisitionPair>(
      `/libraries/${libraryID}/acquisition-discoveries/${discoveryID}/select-pair`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  createAcquisitionRequest: (libraryID: string, body: CreateAcquisitionRequest) =>
    request<AcquisitionRequest>(`/libraries/${libraryID}/acquisition-requests`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  searchAcquisitionRequest: (libraryID: string, requestID: string) =>
    request<AcquisitionResult[]>(
      `/libraries/${libraryID}/acquisition-requests/${requestID}/search`,
    ),
  selectAcquisitionResult: (libraryID: string, requestID: string, body: SelectAcquisitionRequest) =>
    request<AcquisitionRequest>(
      `/libraries/${libraryID}/acquisition-requests/${requestID}/select`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  enqueueAlignment: (body: CreateAlignmentJobRequest) =>
    request<AlignmentJob>('/alignment-jobs', { method: 'POST', body: JSON.stringify(body) }),
  alignmentJobs: (workID: string) => request<AlignmentJob[]>(`/works/${workID}/alignment-jobs`),
  alignmentJob: (id: string) => request<AlignmentJob>(`/alignment-jobs/${id}`),
  cancelAlignment: (id: string) =>
    request<void>(`/alignment-jobs/${id}/cancel`, { method: 'POST' }),

  alignment: (id: string) => request<Alignment>(`/alignments/${id}`),
  workProgress: async (id: string) => {
    try {
      return await request<CanonicalPosition>(`/works/${id}/progress`);
    } catch (error) {
      if (error instanceof APIError && error.status === 404) return null;
      throw error;
    }
  },
  workPreference: (id: string) => request<WorkPreference | null>(`/works/${id}/preference`),
  setWorkPreference: (id: string, body: SetWorkPreferenceRequest) =>
    request<WorkPreference>(`/works/${id}/preference`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  epubToCanonical: (id: string, locator: EPUBLocator) =>
    request<CanonicalPosition>(`/alignments/${id}/resolve/epub`, {
      method: 'POST',
      body: JSON.stringify(locator),
    }),
  audioToCanonical: (id: string, locator: AudioLocator) =>
    request<CanonicalPosition>(`/alignments/${id}/resolve/audio`, {
      method: 'POST',
      body: JSON.stringify(locator),
    }),
  canonicalToEPUB: (id: string, position: CanonicalPosition) =>
    request<EPUBLocator>(`/alignments/${id}/locators/epub`, {
      method: 'POST',
      body: JSON.stringify(position),
    }),
  canonicalToAudio: (id: string, position: CanonicalPosition) =>
    request<AudioLocator>(`/alignments/${id}/locators/audio`, {
      method: 'POST',
      body: JSON.stringify(position),
    }),
  updateWorkProgress: (id: string, body: WorkProgressUpdate) =>
    request<CanonicalPosition>(`/works/${id}/progress`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  startActivity: (id: string, body: StartActivityRequest) =>
    request<ActivitySession>(`/works/${id}/activity`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateActivity: (id: string, body: UpdateActivityRequest) =>
    request<ActivitySession>(`/activity/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  representationState: async (id: string) => {
    try {
      return await request<RepresentationState>(`/representations/${id}/state`);
    } catch (error) {
      if (error instanceof APIError && error.status === 404) return null;
      throw error;
    }
  },
  updateRepresentationState: (id: string, body: RepresentationStateUpdate) =>
    request<RepresentationState>(`/representations/${id}/state`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  readerPreferences: () => request<ReaderPreferences>('/reader-preferences'),
  updateReaderPreferences: (body: ReaderPreferencesUpdate) =>
    request<ReaderPreferences>('/reader-preferences', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
};

export function errorMessage(error: unknown) {
  if (!(error instanceof APIError)) return 'Something went wrong.';
  if (error.status === 401) {
    if (error.message === 'invalid credentials') return 'Username or password is incorrect.';
    if (error.message === 'current password is incorrect') return 'Current password is incorrect.';
    return 'Your session has expired. Sign in again.';
  }
  if (error.status === 404) return 'This item was not found or is not available to your account.';
  if (error.status === 409) return error.message || 'The item changed. Refresh and try again.';
  return error.message || 'Something went wrong.';
}
