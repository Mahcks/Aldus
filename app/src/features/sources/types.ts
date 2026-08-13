import type { SourceEntry, SourceScan } from '../../generated/api';

/** Scan history and file inventory for one `LibrarySource`, keyed by source ID on the page. */
export type SourceDetails = {
  scans: SourceScan[];
  entries: SourceEntry[];
};
