import { Redirect, Slot } from 'expo-router';
import { Loading } from '../ui';
import { useAuth } from './AuthProvider';

export function AuthGate() {
  const auth = useAuth();
  if (auth.loading) return <Loading />;
  if (!auth.user) return <Redirect href={auth.setupAvailable ? '/setup' : '/login'} />;
  return <Slot />;
}
