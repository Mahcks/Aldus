export type CanonicalPosition = {
  work_id?: string;
  alignment_id: string;
  segment_id: string;
  offset: number;
  revision?: number;
  updated_at?: string;
  source_device?: string;
  alignment_state?: string;
  resolvable?: boolean;
};

export type RepresentationState = {
  representation_id: string;
  epub_locator?: unknown;
  audio_timestamp_ms?: number;
  playback_speed?: number;
  reader_layout?: 'paginated' | 'scrolled';
  zoom?: number;
  revision: number;
  updated_at: string;
};

export type RepresentationStateUpdate = Omit<RepresentationState, 'representation_id' | 'revision' | 'updated_at'> & {
  expected_revision: number;
};

export type AlignmentSegment = {
  id: string;
  ordinal: number;
  text: string;
  epub_href: string;
  epub_locator: unknown;
  koreader_locator: string;
  audio_resource: string;
  audio_start_ms: number;
  audio_end_ms: number;
};

export type Alignment = {
  id: string;
  revision: number;
  state: string;
  epub_sha256: string;
  audio_sha256: string;
  segments: AlignmentSegment[];
};

export type AudioLocator = {
  resource: string;
  timestamp_ms: number;
};

export type EPUBLocator = {
  href: string;
  locator: unknown;
  offset: number;
};
