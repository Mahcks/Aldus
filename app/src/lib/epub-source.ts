import { api } from './api';

export const productEPUBSource = (
  id: string,
  _expectedSize?: number,
  _sha256?: string,
  label = 'Ebook',
  workID?: string,
) => api.mediaBlob(id);
