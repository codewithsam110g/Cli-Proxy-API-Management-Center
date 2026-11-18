import { create } from 'zustand';
import i18n from '@/i18n';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AuthState, LoginCredentials, ConnectionStatus } from '@/types';
import { STORAGE_KEY_AUTH } from '@/utils/constants';
import { obfuscatedStorage } from '@/services/storage/secureStorage';
import { apiClient } from '@/services/api/client';
import { portalApi, type Principal } from '@/services/api/portal';
import { LegacyBackendError, probeLegacyBackend } from '@/services/api/legacyBackendProbe';
import { useConfigStore } from './useConfigStore';
import { useModelsStore } from './useModelsStore';
import { useQuotaStore } from './useQuotaStore';
import { useNotificationStore } from './useNotificationStore';
import { providerRecentRequestsCacheController } from '@/components/providers/hooks/providerRecentRequestsCache';
import { resetPluginQuotaRouteCache } from '@/features/quota/providers/plugin/data';
import { detectApiBaseFromLocation, normalizeApiBase } from '@/utils/connection';

const VIEWER_SESSION = 'portal-viewer-session';
const VIEWER_MODE = 'portal-viewer-mode';
interface AuthStoreState extends AuthState {
  principal: Principal | null;
  connectionStatus: ConnectionStatus;
  login: (credentials: LoginCredentials) => Promise<void>;
  selectViewer: () => void;
  loginViewer: (base: string, username: string, password: string) => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<boolean>;
  restoreSession: () => Promise<boolean>;
  updateServerVersion: (version: string | null, buildDate?: string | null) => void;
  updateServerPluginSupport: (supportsPlugin: boolean) => void;
}
let restoreSessionPromise: Promise<boolean> | null = null;
const clearCaches = () => {
  useConfigStore.getState().clearCache();
  useModelsStore.getState().clearCache();
  useQuotaStore.getState().clearQuotaCache();
  useNotificationStore.getState().resetForConnection();
  providerRecentRequestsCacheController.clear();
  resetPluginQuotaRouteCache();
};
const forgetOwner = () => {
  localStorage.removeItem('isLoggedIn');
  obfuscatedStorage.removeItem('managementKey');
  obfuscatedStorage.removeItem('apiBase');
  obfuscatedStorage.removeItem('apiUrl');
};
const validViewer = (p: Principal) =>
  p?.role === 'viewer' && p.capabilities?.includes('status:read');
const oldOwner: Principal = { id: 'owner', username: 'Owner', role: 'admin', capabilities: [] };
const ensureCurrent = (revision: number) => {
  if (apiClient.getConnectionRevision() !== revision) throw new Error('Session changed');
};

export const useAuthStore = create<AuthStoreState>()(
  persist(
    (set, get) => ({
      isAuthenticated: false,
      apiBase: '',
      managementKey: '',
      rememberPassword: false,
      principal: null,
      serverVersion: null,
      serverBuildDate: null,
      supportsPlugin: false,
      connectionStatus: 'disconnected',
      selectViewer: () => {
        restoreSessionPromise = null;
        apiClient.setConfig({ apiBase: '', managementKey: '' });
        clearCaches();
        forgetOwner();
        sessionStorage.removeItem(VIEWER_SESSION);
        localStorage.setItem(VIEWER_MODE, '1');
        sessionStorage.setItem(VIEWER_MODE, '1');
        set({
          isAuthenticated: false,
          principal: null,
          managementKey: '',
          rememberPassword: false,
          supportsPlugin: false,
          serverVersion: null,
          serverBuildDate: null,
          connectionStatus: 'disconnected',
        });
      },
      loginViewer: async (base, username, password) => {
        get().selectViewer();
        const apiBase = normalizeApiBase(base);
        apiClient.setConfig({ apiBase, managementKey: '' });
        let revision = apiClient.getConnectionRevision();
        set({ apiBase, connectionStatus: 'connecting' });
        try {
          const result = await portalApi.login(username.trim().toLowerCase(), password);
          ensureCurrent(revision);
          if (!result.session_token || !validViewer(result.principal))
            throw new Error('Invalid portal session');
          apiClient.setConfig({ apiBase, managementKey: '', portalToken: result.session_token });
          revision = apiClient.getConnectionRevision();
          const session = await portalApi.session();
          ensureCurrent(revision);
          if (!validViewer(session.principal)) throw new Error('Invalid portal principal');
          sessionStorage.setItem(
            VIEWER_SESSION,
            JSON.stringify({ apiBase, token: result.session_token })
          );
          set({
            isAuthenticated: true,
            principal: session.principal,
            connectionStatus: 'connected',
          });
        } catch (error) {
          if (apiClient.getConnectionRevision() === revision) {
            apiClient.setConfig({ apiBase: '', managementKey: '' });
            sessionStorage.removeItem(VIEWER_SESSION);
            set({ isAuthenticated: false, principal: null, connectionStatus: 'error' });
          }
          throw error;
        }
      },
      restoreSession: () => {
        if (restoreSessionPromise) return restoreSessionPromise;
        const promise = (async () => {
          if (
            sessionStorage.getItem(VIEWER_MODE) === '1' ||
            sessionStorage.getItem(VIEWER_SESSION) ||
            localStorage.getItem(VIEWER_MODE) === '1'
          ) {
            forgetOwner();
            clearCaches();
            apiClient.setConfig({ apiBase: '', managementKey: '' });
            set({
              managementKey: '',
              rememberPassword: false,
              isAuthenticated: false,
              principal: null,
              connectionStatus: 'disconnected',
            });
            let saved: unknown = null;
            try {
              saved = JSON.parse(sessionStorage.getItem(VIEWER_SESSION) || 'null');
            } catch {
              /* invalid storage */
            }
            if (
              typeof saved !== 'object' ||
              saved === null ||
              !('apiBase' in saved) ||
              typeof saved.apiBase !== 'string' ||
              !saved.apiBase.trim() ||
              !('token' in saved) ||
              typeof saved.token !== 'string' ||
              !saved.token
            ) {
              sessionStorage.removeItem(VIEWER_SESSION);
              return false;
            }
            const apiBase = normalizeApiBase(saved.apiBase);
            apiClient.setConfig({ apiBase, managementKey: '', portalToken: saved.token });
            const revision = apiClient.getConnectionRevision();
            try {
              const session = await portalApi.session();
              ensureCurrent(revision);
              if (!validViewer(session.principal)) throw new Error('Invalid portal principal');
              set({
                apiBase,
                isAuthenticated: true,
                principal: session.principal,
                connectionStatus: 'connected',
              });
              return true;
            } catch {
              if (apiClient.getConnectionRevision() === revision) {
                sessionStorage.removeItem(VIEWER_SESSION);
                apiClient.setConfig({ apiBase: '', managementKey: '' });
                set({ isAuthenticated: false, principal: null, connectionStatus: 'disconnected' });
              }
              return false;
            }
          }
          obfuscatedStorage.migratePlaintextKeys(['apiBase', 'apiUrl', 'managementKey']);
          const { apiBase, managementKey, rememberPassword } = get();
          const base = normalizeApiBase(
            apiBase ||
              obfuscatedStorage.getItem<string>('apiBase') ||
              obfuscatedStorage.getItem<string>('apiUrl', { encrypt: true }) ||
              detectApiBaseFromLocation()
          );
          const key = managementKey || obfuscatedStorage.getItem<string>('managementKey') || '';
          if (localStorage.getItem('isLoggedIn') === 'true' && base && key) {
            try {
              await get().login({
                apiBase: base,
                managementKey: key,
                rememberPassword: rememberPassword || Boolean(key),
              });
              return true;
            } catch {
              return false;
            }
          }
          return false;
        })();
        restoreSessionPromise = promise;
        const clearRestore = () => {
          if (restoreSessionPromise === promise) restoreSessionPromise = null;
        };
        void promise.then(clearRestore, clearRestore);
        return promise;
      },
      login: async (credentials) => {
        restoreSessionPromise = null;
        localStorage.removeItem(VIEWER_MODE);
        sessionStorage.removeItem(VIEWER_MODE);
        sessionStorage.removeItem(VIEWER_SESSION);
        const apiBase = normalizeApiBase(credentials.apiBase);
        const managementKey = credentials.managementKey.trim();
        const rememberPassword = credentials.rememberPassword ?? false;
        clearCaches();
        apiClient.setConfig({ apiBase, managementKey });
        const revision = apiClient.getConnectionRevision();
        set({
          isAuthenticated: false,
          principal: null,
          connectionStatus: 'connecting',
          serverVersion: null,
          serverBuildDate: null,
          supportsPlugin: false,
        });
        try {
          try {
            await useConfigStore.getState().fetchConfig(true);
          } catch (error) {
            if (
              (error as { status?: number }).status === 404 &&
              revision === apiClient.getConnectionRevision() &&
              (await probeLegacyBackend(apiBase, managementKey)) &&
              revision === apiClient.getConnectionRevision()
            )
              throw new LegacyBackendError();
            throw error;
          }
          ensureCurrent(revision);
          let principal = oldOwner;
          try {
            principal = (await portalApi.session()).principal;
          } catch (error) {
            if ((error as { status?: number }).status !== 404) throw error;
          }
          ensureCurrent(revision);
          if (principal.role !== 'admin') throw new Error('Invalid owner principal');
          set({
            isAuthenticated: true,
            apiBase,
            managementKey,
            rememberPassword,
            principal,
            connectionStatus: 'connected',
          });
          if (rememberPassword) localStorage.setItem('isLoggedIn', 'true');
          else localStorage.removeItem('isLoggedIn');
        } catch (error) {
          if (revision === apiClient.getConnectionRevision()) set({ connectionStatus: 'error' });
          throw error;
        }
      },
      logout: () => {
        const viewer = get().principal?.role === 'viewer';
        const client = apiClient.captureConnection();
        const revocation = viewer ? client.post('/portal/logout') : null;
        restoreSessionPromise = null;
        apiClient.setConfig({ apiBase: '', managementKey: '' });
        const logoutRevision = apiClient.getConnectionRevision();
        clearCaches();
        sessionStorage.removeItem(VIEWER_SESSION);
        localStorage.removeItem('isLoggedIn');
        if (revocation)
          void revocation.catch((error: { status?: number }) => {
            if (error.status !== 401 && logoutRevision === apiClient.getConnectionRevision()) {
              useNotificationStore
                .getState()
                .showNotification(i18n.t('portal.logout_failed'), 'error');
            }
          });
        set({
          isAuthenticated: false,
          apiBase: '',
          managementKey: '',
          principal: null,
          serverVersion: null,
          serverBuildDate: null,
          supportsPlugin: false,
          connectionStatus: 'disconnected',
        });
      },
      checkAuth: () => get().restoreSession(),
      updateServerVersion: (version, buildDate) =>
        set({ serverVersion: version || null, serverBuildDate: buildDate || null }),
      updateServerPluginSupport: (supportsPlugin) => set({ supportsPlugin }),
    }),
    {
      name: STORAGE_KEY_AUTH,
      storage: createJSONStorage(() => ({
        getItem: (name) => {
          const data = obfuscatedStorage.getItem<AuthStoreState>(name);
          return data ? JSON.stringify(data) : null;
        },
        setItem: (name, value) => obfuscatedStorage.setItem(name, JSON.parse(value)),
        removeItem: (name) => obfuscatedStorage.removeItem(name),
      })),
      partialize: (state) => ({
        apiBase: state.apiBase,
        ...(state.rememberPassword ? { managementKey: state.managementKey } : {}),
        rememberPassword: state.rememberPassword,
        serverVersion: state.serverVersion,
        serverBuildDate: state.serverBuildDate,
      }),
    }
  )
);
if (typeof window !== 'undefined') {
  window.addEventListener('unauthorized', () => useAuthStore.getState().logout());
  window.addEventListener('server-version-update', ((e: CustomEvent) => {
    useAuthStore
      .getState()
      .updateServerVersion(e.detail?.version || null, e.detail?.buildDate || null);
  }) as EventListener);
  window.addEventListener('server-plugin-support-update', ((e: CustomEvent) => {
    useAuthStore.getState().updateServerPluginSupport(e.detail?.supportsPlugin === true);
  }) as EventListener);
}
