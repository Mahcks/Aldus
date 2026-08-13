import { router } from 'expo-router';
import { Text } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { Button, Row } from '../ui';

export function AppActions() {
  const auth = useAuth();
  return <Row>{auth.user?.admin ? <Button label="Users" kind="quiet" onPress={() => router.push('/users')} /> : null}<Text>{auth.user?.display_name || auth.user?.username}</Text><Button label="Sign out" onPress={async () => { await auth.signOut(); router.replace('/login'); }} /></Row>;
}
