export type DownloadItem = {
  id: string;
  workID?: string;
  storageBytes?: number;
  origin: string;
  scope: string;
  filename: string;
  label: string;
  expectedSize: number;
  sha256?: string;
  bytes: number;
  transferredBytes?: number;
  status: 'queued' | 'downloading' | 'paused' | 'failed' | 'complete';
  error?: string;
};

export async function listDownloads(): Promise<DownloadItem[]> {
  return [];
}
export function subscribeDownloads(_listener: () => void) {
  return () => {};
}
export async function pauseDownload(_id: string) {}
export async function cancelDownload(_id: string) {}
export async function retryDownload(_id: string): Promise<string> {
  throw new Error('Downloads are available in the native app.');
}
