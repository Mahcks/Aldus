import { Platform } from 'react-native';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import type { SetupStatus } from '@/generated/api';
import { preloadedAPIBaseURL, setAPIBaseURL } from '@/lib/api-base';
import { normalizeServerOrigin } from '@/lib/server-origin';
import {
  forgetServerProfile,
  loadServerProfiles,
  rememberServerProfile,
  type ServerProfile,
} from '@/lib/server-profiles';

type ServerContextValue = {
  loading: boolean;
  connected: boolean;
  origin: string;
  profiles: ServerProfile[];
  connect: (address: string) => Promise<SetupStatus>;
  forget: (origin: string) => Promise<void>;
};

const ServerContext = createContext<ServerContextValue | null>(null);

async function inspectServer(origin: string): Promise<SetupStatus> {
  let response: Response;
  try {
    response = await fetch(`${origin}/api/setup/status`, { signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new Error('Unable to connect. Check the address, network, and HTTPS certificate.');
  }
  if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json'))
    throw new Error('That address is not an Aldus server.');
  const status = (await response.json()) as Partial<SetupStatus>;
  if (typeof status.available !== 'boolean' || typeof status.demo_available !== 'boolean')
    throw new Error('That server returned an invalid response.');
  return status as SetupStatus;
}

export function ServerProvider({ children }: PropsWithChildren) {
  const web = Platform.OS === 'web';
  const [loading, setLoading] = useState(!web);
  const [origin, setOrigin] = useState(
    web
      ? process.env.EXPO_PUBLIC_WEB_CANONICAL_ORIGIN ||
          (typeof globalThis.location !== 'undefined' ? globalThis.location.origin : '')
      : '',
  );
  const [profiles, setProfiles] = useState<ServerProfile[]>([]);

  useEffect(() => {
    if (web) return;
    let active = true;
    loadServerProfiles()
      .then(async (stored) => {
        if (!active) return;
        let selected = stored.activeOrigin;
        let nextProfiles = stored.profiles;
        if (!selected && preloadedAPIBaseURL) {
          try {
            selected = normalizeServerOrigin(preloadedAPIBaseURL);
            nextProfiles = (await rememberServerProfile(selected)) ?? nextProfiles;
          } catch {
            selected = null;
          }
        }
        if (!active) return;
        setProfiles(nextProfiles);
        setOrigin(selected ?? '');
        setAPIBaseURL(selected ?? '');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [web]);

  const connect = useCallback(
    async (address: string) => {
      const nextOrigin = normalizeServerOrigin(address);
      const status = await inspectServer(nextOrigin);
      if (!web) {
        const next = await rememberServerProfile(nextOrigin);
        if (next) setProfiles(next);
      }
      setAPIBaseURL(nextOrigin);
      setOrigin(nextOrigin);
      return status;
    },
    [web],
  );

  const value = useMemo(
    () => ({
      loading,
      connected: web || Boolean(origin),
      origin,
      profiles,
      connect,
      forget: async (forgottenOrigin: string) => {
        const next = await forgetServerProfile(forgottenOrigin);
        if (next) setProfiles(next);
      },
    }),
    [loading, web, origin, profiles, connect],
  );
  return <ServerContext.Provider value={value}>{children}</ServerContext.Provider>;
}

export function useServer() {
  const value = useContext(ServerContext);
  if (!value) throw new Error('useServer must be used inside ServerProvider');
  return value;
}
