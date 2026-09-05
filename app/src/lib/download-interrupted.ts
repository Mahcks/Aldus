/** An intentional pause, cancellation, or account switch is not a failed download. */
export class DownloadInterrupted extends Error {
  name = 'DownloadInterrupted';
}
