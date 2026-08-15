import type {
  Alignment,
  ActivitySession,
  AcceptImportProposalRequest,
  AcceptImportProposalResponse,
  AlignmentJob,
  AudioLocator,
  BootstrapRequest,
  CanonicalPosition,
  CreateAlignmentJobRequest,
  CreateLibraryRequest,
  CreateLibrarySourceRequest,
  CreateRepresentationRequest,
  CreateUserRequest,
  CreateWorkRequest,
  EPUBLocator,
  Library,
  LibrarySource,
  ImportProposal,
  LoginRequest,
  Media,
  Membership,
  Representation,
  RepresentationState,
  RepresentationStateUpdate,
  Session,
  SourceEntry,
  SourceDirectoryListing,
  SourceRoot,
  SourceScan,
  SetupStatus,
  StartActivityRequest,
  UpdateLibraryRequest,
  UpdateActivityRequest,
  UpdateLibrarySourceRequest,
  UpdateRepresentationRequest,
  UpdateUserRequest,
  UpdateWorkRequest,
  User,
  Work,
  WorkDetail,
  WorkBrowsePage,
  WorkProgressUpdate,
} from '../generated/api';
import { clearToken, getToken, setToken } from './auth-token';
import { apiBaseURL } from './api-base';

let unauthorized: (() => void) | undefined;
export function onUnauthorized(handler?: () => void) {
  unauthorized = handler;
}

export class APIError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(`${apiBaseURL}/api${path}`, {
      ...init,
      headers,
      credentials: 'include',
    });
  } catch {
    throw new APIError(0, 'Unable to reach Aldus.');
  }
  if (!response.ok) {
    const message = (await response.text()).trim();
    if (response.status === 401) {
      await clearToken();
      unauthorized?.();
    }
    throw new APIError(response.status, message || `Request failed (${response.status}).`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function download(path: string) {
  const token = await getToken();
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${apiBaseURL}/api${path}`, { headers, credentials: 'include' });
  if (!response.ok)
    throw new APIError(
      response.status,
      (await response.text()).trim() || `Request failed (${response.status}).`,
    );
  return response.blob();
}

async function acceptSession(session: Session) {
  if (session.token) await setToken(session.token);
  return session.user;
}

export const api = {
  setupStatus: () => request<SetupStatus>('/setup/status'),
  bootstrap: (body: BootstrapRequest) =>
    request<Session>('/setup', { method: 'POST', body: JSON.stringify(body) }).then(acceptSession),
  login: (body: LoginRequest) =>
    request<Session>('/auth/login', { method: 'POST', body: JSON.stringify(body) }).then(
      acceptSession,
    ),
  me: () => request<User>('/auth/me'),
  logout: async () => {
    try {
      await request<void>('/auth/logout', { method: 'POST' });
    } finally {
      await clearToken();
    }
  },

  users: (offset = 0) => request<User[]>(`/users?limit=100&offset=${offset}`),
  createUser: (body: CreateUserRequest) =>
    request<User>('/users', { method: 'POST', body: JSON.stringify(body) }),
  updateUser: (id: string, body: UpdateUserRequest) =>
    request<void>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  libraries: () => request<Library[]>('/libraries'),
  library: (id: string) => request<Library>(`/libraries/${id}`),
  createLibrary: (body: CreateLibraryRequest) =>
    request<Library>('/libraries', { method: 'POST', body: JSON.stringify(body) }),
  updateLibrary: (id: string, body: UpdateLibraryRequest) =>
    request<void>(`/libraries/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteLibrary: (id: string) => request<void>(`/libraries/${id}`, { method: 'DELETE' }),
  members: (id: string) => request<Membership[]>(`/libraries/${id}/members`),
  setMember: (libraryID: string, userID: string, role: string) =>
    request<void>(`/libraries/${libraryID}/members/${userID}`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
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
      limit?: number;
      offset?: number;
    } = {},
  ) => {
    const query = new URLSearchParams();
    if (options.libraryID) query.set('library_id', options.libraryID);
    if (options.q) query.set('q', options.q);
    if (options.sort) query.set('sort', options.sort);
    if (options.availability) query.set('availability', options.availability);
    if (options.limit) query.set('limit', String(options.limit));
    if (options.offset) query.set('offset', String(options.offset));
    return request<WorkBrowsePage>(`/works?${query}`);
  },
  work: (id: string) => request<WorkDetail>(`/works/${id}`),
  createWork: (libraryID: string, body: CreateWorkRequest) =>
    request<Work>(`/libraries/${libraryID}/works`, { method: 'POST', body: JSON.stringify(body) }),
  updateWork: (id: string, body: UpdateWorkRequest) =>
    request<void>(`/works/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteWork: (id: string) => request<void>(`/works/${id}`, { method: 'DELETE' }),

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
  uploadMedia: (libraryID: string, representationID: string, file: Blob, filename: string) => {
    const body = new FormData();
    body.append('file', file, filename);
    return request<Media>(`/libraries/${libraryID}/representations/${representationID}/media`, {
      method: 'POST',
      body,
    });
  },
  mediaBlob: (id: string) => download(`/media/${id}`),

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
};

export function errorMessage(error: unknown) {
  if (!(error instanceof APIError)) return 'Something went wrong.';
  if (error.status === 401) return 'Your session has expired. Sign in again.';
  if (error.status === 404) return 'This item was not found or is not available to your account.';
  if (error.status === 409) return error.message || 'The item changed. Refresh and try again.';
  return error.message || 'Something went wrong.';
}
