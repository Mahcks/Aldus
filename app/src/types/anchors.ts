export type SeekDiagnostic = {
  requested_ms: number;
  reported_ms: number;
  difference_ms: number;
};

export type Anchor = {
  id: string;
  text: string;
  normalized_text: string;
  epub: {
    href: string;
    cfi: string;
    start: { dom_path: string; node_offset: number };
    end: { dom_path: string; node_offset: number };
  };
  audio: { resource: string; timestamp_ms: number; seek: SeekDiagnostic };
  canonical: { segment_id: string; offset: number };
  koreader_xpointer: string;
};

export type AnchorFixture = {
  version: 1;
  epub_sha256: string;
  audio_sha256: string;
  koreader_document_hash: string;
  anchors: Anchor[];
};

export type OnsetAnchor = {
  anchor_id: string;
  manual_seek_timestamp_ms: number;
  audible_onset_timestamp_ms: number;
  opening_word: string;
  annotation_notes: string;
  manual_minus_onset_ms: number;
};

export type OnsetFixture = {
  version: 1;
  semantics: 'earliest point at which the opening spoken word audibly begins';
  epub_sha256: string;
  audio_sha256: string;
  anchors: OnsetAnchor[];
};
