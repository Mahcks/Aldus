import { File, Paths } from 'expo-file-system';
import { getToken } from './auth-token';
import { productMediaURL } from './media';

export async function productEPUBSource(id: string) {
  const destination = new File(Paths.document, `aldus-${id}.epub`);
  if (destination.exists) return destination.uri;
  const token = await getToken();
  return (
    await File.downloadFileAsync(productMediaURL(id), destination, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      idempotent: true,
    })
  ).uri;
}
