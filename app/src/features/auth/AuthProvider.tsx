import type { User } from '../../generated/api';
import { APIError, api, onUnauthorized } from '../../lib/api';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

type AuthState = {
  loading: boolean;
  setupAvailable: boolean;
  user: User | null;
  error: string | null;
};
type AuthContextValue = AuthState & {
  refresh: () => Promise<void>;
  signedIn: (user: User) => void;
  signOut: () => Promise<void>;
};
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AuthState>({
    loading: true,
    setupAvailable: false,
    user: null,
    error: null,
  });
  const refresh = useCallback(async () => {
    try {
      const user = await api.me();
      setState({ loading: false, setupAvailable: false, user, error: null });
    } catch (error) {
      if (!(error instanceof APIError) || error.status !== 401) {
        setState({
          loading: false,
          setupAvailable: false,
          user: null,
          error: error instanceof Error ? error.message : 'Unable to load Aldus.',
        });
        return;
      }
      try {
        const setup = await api.setupStatus();
        setState({ loading: false, setupAvailable: setup.available, user: null, error: null });
      } catch (setupError) {
        setState({
          loading: false,
          setupAvailable: false,
          user: null,
          error: setupError instanceof Error ? setupError.message : 'Unable to load Aldus.',
        });
      }
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);
  useEffect(() => {
    onUnauthorized(() => setState((value) => ({ ...value, user: null })));
    return () => onUnauthorized();
  }, []);
  const value = useMemo(
    () => ({
      ...state,
      refresh,
      signedIn: (user: User) =>
        setState({ loading: false, setupAvailable: false, user, error: null }),
      signOut: async () => {
        await api.logout();
        setState({ loading: false, setupAvailable: false, user: null, error: null });
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
