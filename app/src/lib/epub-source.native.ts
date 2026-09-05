import { getAPIBaseURL } from './api-base';
import { activeStorageScope, scopedMediaFileName } from './storage-scope';
import { downloadNativeMedia } from './native-download.native';

export async function productEPUBSource(
  id: string,
  expectedSize?: number,
  sha256?: string,
  label = 'Ebook',
  workID?: string,
) {
  const scope = activeStorageScope();
  return downloadNativeMedia({
    id,
    scope,
    sha256,
    origin: getAPIBaseURL(),
    expectedSize: expectedSize ?? 0,
    filename: scopedMediaFileName(id, 'epub', scope),
    label,
    workID,
  });
}
