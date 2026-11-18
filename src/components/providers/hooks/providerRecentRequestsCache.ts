import type { ProviderRecentRequests } from './useProviderRecentRequests';
export type ProviderRecentRequestsCache = {
  cachedUsageByProvider: ProviderRecentRequests;
  cachedAt: number;
  inFlightRequest: Promise<ProviderRecentRequests> | null;
};
const empty = (): ProviderRecentRequestsCache => ({
  cachedUsageByProvider: new Map(),
  cachedAt: 0,
  inFlightRequest: null,
});
export const createProviderRecentRequestsCacheController = () => {
  let scope = '';
  let current = empty();
  return {
    forScope(apiBase: string, managementKey: string, revision = 0): ProviderRecentRequestsCache {
      const next = JSON.stringify([apiBase, managementKey, revision]);
      if (next !== scope) {
        scope = next;
        current = empty();
      }
      return current;
    },
    clear() {
      scope = '';
      current = empty();
    },
  };
};
export const providerRecentRequestsCacheController = createProviderRecentRequestsCacheController();
