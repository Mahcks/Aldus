import type { User } from '@/generated/api';
import { APIError, api, onUnauthorized } from '@/lib/api';
import { getAPIBaseURL } from '@/lib/api-base';
import { clearToken } from '@/lib/auth-token';
import {
  finishAccountCleanup,
  rememberAccountCleanup,
  retryAccountCleanups,
} from '@/lib/account-cleanup';
import { lastUser, rememberUser } from '@/lib/last-user';
import { reconcileOfflineRepresentationStates } from '@/lib/offline-library';
import { reconcileAllPendingProgress } from '@/lib/progress-outbox';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState, Platform } from 'react-native';
import { clearStorageScope, prepareStorageScope, setStorageUserID } from '@/lib/storage-scope';
import { deleteAccountAndClearState } from './account-deletion';
import { useServer } from './ServerProvider';

type AuthState = {
  loading: boolean;
  setupAvailable: boolean;
  demoAvailable: boolean;
  user: User | null;
  error: string | null;
};
type AuthContextValue = AuthState & {
  refresh: () => Promise<void>;
  signedIn: (user: User) => Promise<void>;
  signOut: () => Promise<void>;
  signOutEverywhere: () => Promise<void>;
  deleteAccount: (password?: string) => Promise<void>;
};
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const server = useServer();
  const [state, setState] = useState<AuthState>({
    loading: true,
    setupAvailable: false,
    demoAvailable: false,
    user: null,
    error: null,
  });
  const refresh = useCallback(async () => {
    const origin = getAPIBaseURL();
    const serverOrigin = server.origin;
    if (server.loading) return;
    if (!server.connected || (Platform.OS !== 'web' && !serverOrigin)) {
      setStorageUserID('');
      setState({
        loading: false,
        setupAvailable: false,
        demoAvailable: false,
        user: null,
        error: null,
      });
      return;
    }
    setStorageUserID('');
    setState((value) => ({ ...value, loading: true, user: null, error: null }));
    try {
      const user = await api.me();
      const setup = await api.setupStatus();
      if (origin !== getAPIBaseURL()) return;
      await prepareStorageScope(user.id);
      await rememberUser(user, origin);
      if (origin !== getAPIBaseURL()) return;
      setState({
        loading: false,
        setupAvailable: false,
        demoAvailable: setup.demo_available,
        user,
        error: null,
      });
    } catch (error) {
      if (origin !== getAPIBaseURL()) return;
      if (error instanceof APIError && error.status === 0) {
        const user = await lastUser(origin);
        if (origin !== getAPIBaseURL()) return;
        if (user) {
          if (user.demo_expires_at && new Date(user.demo_expires_at).getTime() <= Date.now()) {
            await Promise.all([
              clearToken(origin),
              rememberUser(null, origin),
              clearStorageScope(origin, user.id),
            ]);
            setStorageUserID('');
            setState({
              loading: false,
              setupAvailable: false,
              demoAvailable: true,
              user: null,
              error: 'This demo visit expired. Connect to start a new one.',
            });
            return;
          }
          await prepareStorageScope(user.id);
          setState({
            loading: false,
            setupAvailable: false,
            demoAvailable: Boolean(user.demo_expires_at),
            user,
            error: null,
          });
          return;
        }
      }
      if (!(error instanceof APIError) || error.status !== 401) {
        setState({
          loading: false,
          setupAvailable: false,
          demoAvailable: false,
          user: null,
          error: error instanceof Error ? error.message : 'Unable to load Aldus.',
        });
        return;
      }
      try {
        const setup = await api.setupStatus();
        if (origin !== getAPIBaseURL()) return;
        setStorageUserID('');
        setState({
          loading: false,
          setupAvailable: setup.available,
          demoAvailable: setup.demo_available,
          user: null,
          error: null,
        });
      } catch (setupError) {
        if (origin !== getAPIBaseURL()) return;
        setState({
          loading: false,
          setupAvailable: false,
          demoAvailable: false,
          user: null,
          error: setupError instanceof Error ? setupError.message : 'Unable to load Aldus.',
        });
      }
    }
  }, [server.connected, server.loading, server.origin]);
  useEffect(() => {
    setStorageUserID('');
    void retryAccountCleanups()
      .catch(() => {})
      .then(refresh);
  }, [refresh]);
  useEffect(() => {
    onUnauthorized(() => {
      void rememberUser(null);
      setStorageUserID('');
      setState((value) => ({
        ...value,
        demoAvailable: value.demoAvailable || Boolean(value.user?.demo_expires_at),
        user: null,
      }));
      if (state.user?.demo_expires_at) void clearStorageScope(server.origin, state.user.id);
    });
    return () => onUnauthorized();
  }, [server.origin, state.user]);
  useEffect(() => {
    if (!state.user || Platform.OS === 'web') return;
    void Promise.all([reconcileAllPendingProgress(), reconcileOfflineRepresentationStates()]);
    const subscription = AppState.addEventListener('change', (value) => {
      if (value === 'active')
        void Promise.all([reconcileAllPendingProgress(), reconcileOfflineRepresentationStates()]);
    });
    return () => subscription.remove();
  }, [state.user]);
  const value = useMemo(
    () => ({
      ...state,
      refresh,
      signedIn: async (user: User) => {
        const origin = getAPIBaseURL();
        await prepareStorageScope(user.id);
        await rememberUser(user, origin);
        if (origin !== getAPIBaseURL()) return;
        setState({
          loading: false,
          setupAvailable: false,
          demoAvailable: state.demoAvailable || Boolean(user.demo_expires_at),
          user,
          error: null,
        });
      },
      signOut: async () => {
        const origin = getAPIBaseURL();
        try {
          await api.logout();
        } finally {
          await rememberUser(null, origin);
          if (origin === getAPIBaseURL()) {
            setStorageUserID('');
            setState({
              loading: false,
              setupAvailable: false,
              demoAvailable: state.demoAvailable || Boolean(state.user?.demo_expires_at),
              user: null,
              error: null,
            });
          }
        }
      },
      signOutEverywhere: async () => {
        const origin = getAPIBaseURL();
        await api.logoutAll();
        await rememberUser(null, origin);
        if (origin === getAPIBaseURL()) {
          setStorageUserID('');
          setState({
            loading: false,
            setupAvailable: false,
            demoAvailable: state.demoAvailable || Boolean(state.user?.demo_expires_at),
            user: null,
            error: null,
          });
        }
      },
      deleteAccount: async (password?: string) => {
        const origin = getAPIBaseURL();
        const user = state.user;
        if (!user) return;
        await api.deleteAccount({ password });
        await rememberAccountCleanup(origin, user.id).catch(() => {});
        const cleaned = await deleteAccountAndClearState(
          async () => {},
          [
            () => clearToken(origin),
            () => rememberUser(null, origin),
            () => clearStorageScope(origin, user.id),
          ],
          () => {
            setStorageUserID('');
            setState({
              loading: false,
              setupAvailable: false,
              demoAvailable: state.demoAvailable || Boolean(user.demo_expires_at),
              user: null,
              error: null,
            });
          },
        );
        if (cleaned) await finishAccountCleanup(origin, user.id).catch(() => {});
      },
    }),
    [state, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
