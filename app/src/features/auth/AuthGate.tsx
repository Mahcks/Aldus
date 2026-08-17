import { Redirect } from 'expo-router';
import { AppBootState } from '../ui';
import { useAuth } from './AuthProvider';
import { AppShell } from '../shell/AppShell';

export function AuthGate() {
  const auth = useAuth();
  if (auth.loading) return <AppBootState />;
  if (!auth.user) return <Redirect href={auth.setupAvailable ? '/setup' : '/login'} />;
  return <AppShell />;
}
