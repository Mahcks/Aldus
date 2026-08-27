import { Redirect } from 'expo-router';
import { AppBootState } from '../ui';
import { useAuth } from './AuthProvider';
import { useServer } from './ServerProvider';
import { AppShell } from '../shell/AppShell';

export function AuthGate() {
  const auth = useAuth();
  const server = useServer();
  if (auth.loading) return <AppBootState />;
  if (!server.connected) return <Redirect href="/connect" />;
  if (!auth.user)
    return (
      <Redirect href={auth.demoAvailable ? '/demo' : auth.setupAvailable ? '/setup' : '/login'} />
    );
  if (auth.user.must_change_credentials) return <Redirect href="/claim" />;
  return <AppShell />;
}
