import { Redirect } from 'expo-router';
import { Loading } from '../ui';
import { useAuth } from './AuthProvider';
import { AppShell } from '../shell/AppShell';

export function AuthGate() {
  const auth = useAuth();
  if (auth.loading) return <Loading />;
  if (!auth.user) return <Redirect href={auth.setupAvailable ? '/setup' : '/login'} />;
  return <AppShell />;
}
