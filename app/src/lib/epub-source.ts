import { api } from './api';

export const productEPUBSource = (id: string) => api.mediaBlob(id);
