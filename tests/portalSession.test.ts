import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { apiClient } from '@/services/api/client';
import { useAuthStore } from '@/stores/useAuthStore';
import { useConfigStore } from '@/stores/useConfigStore';
import { useQuotaStore } from '@/stores/useQuotaStore';
import { useNotificationStore } from '@/stores/useNotificationStore';

const local = new Map<string, string>();
const session = new Map<string, string>();
const memoryStorage = (map: Map<string, string>) => ({
  getItem: (key: string) => map.get(key) ?? null,
  setItem: (key: string, value: string) => {
    map.set(key, value);
  },
  removeItem: (key: string) => {
    map.delete(key);
  },
});
const original = ['localStorage', 'sessionStorage', 'window'].map(
  (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
);
const events: string[] = [];
const calls: Array<{ path: string; authorization: string | null; viewer: string | null }> = [];
let valid = true;
let release: (() => void) | undefined;
const principal = {
  id: 'opaque-viewer',
  username: 'reader',
  role: 'viewer',
  capabilities: ['status:read'],
};
const server = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  async fetch(request) {
    const path = new URL(request.url).pathname;
    calls.push({
      path,
      authorization: request.headers.get('authorization'),
      viewer: request.headers.get('x-portal-session'),
    });
    if (path.endsWith('/login'))
      return Response.json({
        session_token: 'synthetic-token',
        expires_at: '2099-01-01T00:00:00Z',
        principal,
      });
    if (path.endsWith('/delay')) {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return new Response('{}', { status: 401, headers: { 'x-cpa-version': 'old' } });
    }
    if (path.endsWith('/session'))
      return valid
        ? Response.json({ principal, expires_at: '2099-01-01T00:00:00Z' })
        : new Response('{}', { status: 401 });
    if (path.endsWith('/logout')) return new Response(null, { status: 204 });
    return Response.json({
      available: true,
      truncated: false,
      server_time: '2099-01-01T00:00:00Z',
      accounts: [],
    });
  },
});
const base = `http://127.0.0.1:${server.port}`;
beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: memoryStorage(local),
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: memoryStorage(session),
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      dispatchEvent: (event: Event) => {
        events.push(event.type);
        return true;
      },
      location: { protocol: 'http:', hostname: '127.0.0.1', port: '' },
    },
  });
});
beforeEach(() => {
  local.clear();
  session.clear();
  calls.length = 0;
  events.length = 0;
  valid = true;
  apiClient.setConfig({ apiBase: '', managementKey: '' });
  useAuthStore.setState({
    isAuthenticated: false,
    principal: null,
    managementKey: '',
    rememberPassword: false,
    apiBase: '',
  });
});
afterAll(() => {
  server.stop(true);
  for (const [key, descriptor] of original) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
describe('portal session isolation', () => {
  test('malformed saved viewer data fails closed without requests or owner fallback', async () => {
    session.set('portal-viewer-mode', '1');
    session.set('portal-viewer-session', JSON.stringify({ apiBase: {}, token: 'synthetic-token' }));
    local.set('isLoggedIn', 'true');
    local.set('managementKey', 'synthetic-owner');
    expect(await useAuthStore.getState().restoreSession()).toBe(false);
    expect(calls).toEqual([]);
    expect(session.has('portal-viewer-session')).toBe(false);
    expect(local.has('managementKey')).toBe(false);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
  test('switching to viewer discards owner notifications and late owner callbacks', () => {
    const ownerNotifications = useNotificationStore.getState();
    ownerNotifications.showNotification('private owner account detail', 'error');
    ownerNotifications.showConfirmation({ message: 'private owner action', onConfirm: () => {} });
    useAuthStore.getState().selectViewer();
    expect(useNotificationStore.getState().notifications).toEqual([]);
    expect(useNotificationStore.getState().confirmation.options).toBeNull();
    ownerNotifications.showNotification('late private owner error', 'error');
    ownerNotifications.showConfirmation({ message: 'late private action', onConfirm: () => {} });
    expect(useNotificationStore.getState().notifications).toEqual([]);
    expect(useNotificationStore.getState().confirmation.options).toBeNull();
    useNotificationStore.getState().showNotification('current viewer message');
    expect(useNotificationStore.getState().notifications.map((item) => item.message)).toEqual([
      'current viewer message',
    ]);
  });
  test('viewer login and restore use only portal transport and remove owner data', async () => {
    local.set('managementKey', 'old-synthetic-key');
    local.set('isLoggedIn', 'true');
    useAuthStore.setState({ managementKey: 'old-synthetic-key', rememberPassword: true });
    useConfigStore.setState({ config: { debug: true } });
    useQuotaStore.setState({ codexQuota: { old: {} as never } });
    await useAuthStore.getState().loginViewer(base, 'Reader', 'synthetic-password');
    expect(calls.map((c) => c.path)).toEqual([
      '/v8/management/portal/login',
      '/v8/management/portal/session',
    ]);
    expect(calls[0].authorization).toBeNull();
    expect(calls[0].viewer).toBeNull();
    expect(calls[1].authorization).toBeNull();
    expect(calls[1].viewer).toBe('synthetic-token');
    expect(useConfigStore.getState().config).toBeNull();
    expect(useQuotaStore.getState().codexQuota).toEqual({});
    expect(local.get('managementKey')).toBeUndefined();
    expect(local.get('isLoggedIn')).toBeUndefined();
    expect([...local.values()].join(' ')).not.toContain('synthetic-token');
    expect([...session.values()].join(' ')).not.toContain('synthetic-password');
    useAuthStore.setState({ isAuthenticated: false, principal: null });
    apiClient.setConfig({ apiBase: '', managementKey: '' });
    expect(await useAuthStore.getState().restoreSession()).toBe(true);
    expect(calls.at(-1)?.path).toEndWith('/portal/session');
    expect(useAuthStore.getState().principal?.id).toBe('opaque-viewer');
  });
  test('expired restore cannot fall back to owner and viewer transport denies privileged paths', async () => {
    await useAuthStore.getState().loginViewer(base, 'reader', 'synthetic-password');
    await expect(apiClient.get('/config')).rejects.toThrow('Viewer request denied');
    useAuthStore.setState({ isAuthenticated: false, principal: null });
    local.set('isLoggedIn', 'true');
    local.set('managementKey', 'synthetic-owner');
    // Another tab can switch the shared localStorage mode to owner. This tab must not follow it.
    local.delete('portal-viewer-mode');
    valid = false;
    expect(await useAuthStore.getState().restoreSession()).toBe(false);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(local.has('managementKey')).toBe(false);
    expect(session.has('portal-viewer-session')).toBe(false);
    expect(calls.every((c) => !c.path.endsWith('/config'))).toBe(true);
  });
  test('delayed 401 from A cannot signal logout after A to B to A', async () => {
    apiClient.setConfig({ apiBase: base, managementKey: 'one' });
    const pending = apiClient.get('/delay').catch(() => undefined);
    while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
    apiClient.setConfig({ apiBase: base, managementKey: 'two' });
    apiClient.setConfig({ apiBase: base, managementKey: 'one' });
    release();
    release = undefined;
    await pending;
    expect(events).not.toContain('unauthorized');
    expect(events).not.toContain('server-version-update');
  });
  test('viewer logout calls server and immediately clears local state', async () => {
    await useAuthStore.getState().loginViewer(base, 'reader', 'synthetic-password');
    useAuthStore.getState().logout();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(session.has('portal-viewer-session')).toBe(false);
    for (let i = 0; i < 100 && !calls.some((c) => c.path.endsWith('/logout')); i++)
      await new Promise((resolve) => setTimeout(resolve, 1));
    const call = calls.find((c) => c.path.endsWith('/logout'));
    expect(call?.viewer).toBe('synthetic-token');
    expect(call?.authorization).toBeNull();
  });
});
