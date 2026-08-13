import { Redirect } from 'expo-router';
import { Loading, Notice } from '../features/ui';
import { useAuth } from '../features/auth/AuthProvider';

export default function Home() {
  const auth = useAuth();
  if (auth.loading) return <Loading />;
  if (auth.error) return <Notice danger>{auth.error}</Notice>;
  return <Redirect href={auth.user ? '/libraries' : auth.setupAvailable ? '/setup' : '/login'} />;
}
