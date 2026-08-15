import { File, Paths } from 'expo-file-system';
import { getToken } from './auth-token';
import { productMediaURL } from './media';

export async function productEPUBSource(id: string) {
  const token = await getToken();
  return (
    await File.downloadFileAsync(productMediaURL(id), new File(Paths.cache, `aldus-${id}.epub`), {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      idempotent: true,
    })
  ).uri;
}
