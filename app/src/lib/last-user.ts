import type { User } from '@/generated/api';

export async function lastUser(_origin?: string): Promise<User | null> {
  return null;
}
export async function rememberUser(_user: User | null, _origin?: string) {}
