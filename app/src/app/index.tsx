import { Redirect, type Href } from 'expo-router';
import { AppBootState } from '@/components/auth/AppBootState';
import { useAuth } from '@/components/auth/AuthProvider';
import { useServer } from '@/components/auth/ServerProvider';

export default function Home() {
  const auth = useAuth();
  const server = useServer();
  if (server.loading || auth.loading) return <AppBootState />;
  if (!server.connected) return <Redirect href={'/connect' as Href} />;
  return (
    <Redirect
      href={
        (auth.user
          ? auth.user.must_change_credentials
            ? '/claim'
            : '/home'
          : auth.demoAvailable
            ? '/demo'
            : auth.setupAvailable
              ? '/setup'
              : '/login') as Href
      }
    />
  );
}
