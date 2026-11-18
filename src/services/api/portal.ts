import { apiClient } from './client';

export interface Principal {
  id: string;
  username: string;
  role: 'admin' | 'viewer';
  capabilities: string[];
}
export interface PortalSession {
  principal: Principal;
  expires_at: string | null;
}
export interface PortalLogin extends PortalSession {
  session_token: string;
}
export interface PortalWindow {
  kind: 'session' | 'weekly';
  remaining_percent: number | null;
  resets_at: string | null;
  observed_at: string | null;
  freshness: 'fresh' | 'stale' | 'unknown';
}
export interface PortalStatus {
  server_time: string;
  available: boolean;
  truncated: boolean;
  accounts: Array<{
    id: string;
    label: string;
    provider: string;
    availability: string;
    model_count: number | null;
    windows: PortalWindow[];
  }>;
}
export interface ViewerUser {
  id: string;
  username: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  active_sessions: number;
}
export interface AccountLabel {
  id: string;
  auth_id: string;
  admin_label: string;
  provider: string;
  label: string;
}
const id = encodeURIComponent;
export const portalApi = {
  login: (username: string, password: string) =>
    apiClient.post<PortalLogin>('/portal/login', { username, password }),
  session: () => apiClient.get<PortalSession>('/portal/session'),
  logout: () => apiClient.post<void>('/portal/logout'),
  status: () => apiClient.get<PortalStatus>('/portal/status'),
  users: () => apiClient.get<{ users: ViewerUser[] }>('/portal/users'),
  create: (username: string, password: string) =>
    apiClient.post<{ user: ViewerUser }>('/portal/users', { username, password }),
  enable: (userId: string, enabled: boolean) =>
    apiClient.patch<{ user: ViewerUser }>(`/portal/users/${id(userId)}`, { enabled }),
  password: (userId: string, password: string) =>
    apiClient.put<void>(`/portal/users/${id(userId)}/password`, { password }),
  remove: (userId: string) => apiClient.delete<void>(`/portal/users/${id(userId)}`),
  labels: () => apiClient.get<{ accounts: AccountLabel[] }>('/portal/account-labels'),
  label: (accountId: string, label: string) =>
    apiClient.put<void>(`/portal/account-labels/${id(accountId)}`, { label }),
};
