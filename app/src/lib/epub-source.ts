import { api } from './api';

export const productEPUBSource = (id: string, _expectedSize?: number) => api.mediaBlob(id);
