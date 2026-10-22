import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/services/api/client';
import {
  routingSessionsApi,
  type RoutingSession,
  type RoutingSnapshot,
} from '@/services/api/routingSessions';
import { useAuthStore, useNotificationStore } from '@/stores';
import { getErrorMessage } from '@/utils/helpers';

/** The Dashboard re-reads the routing snapshot this often while the tab is visible. */
export const ROUTING_POLL_INTERVAL_MS = 30 * 1000;

const EMPTY_IDS: ReadonlySet<string> = new Set();

export interface RoutingController {
  connected: boolean;
  data: RoutingSnapshot | null;
  /** Why the snapshot could not be read; stale data stays visible beside it. */
  error: string;
  /** True once the first read for this connection has finished, successfully or not. */
  loaded: boolean;
  refreshingAll: boolean;
  /** Accounts with a refresh or drain request in flight. */
  busyAccountIds: ReadonlySet<string>;
  /** Conversations with a move request in flight. */
  busySessionIds: ReadonlySet<string>;
  /** Re-reads the snapshot (cheap; does not call the providers). */
  load: () => Promise<void>;
  /** Polls the providers through the backend for every account, then re-reads. */
  refreshAll: () => Promise<void>;
  refreshAccount: (authId: string) => Promise<void>;
  setDraining: (authId: string, draining: boolean) => Promise<void>;
  moveSession: (session: RoutingSession, targetAuthId: string) => Promise<void>;
}

const withId = (set: ReadonlySet<string>, id: string): ReadonlySet<string> => new Set(set).add(id);
const withoutId = (set: ReadonlySet<string>, id: string): ReadonlySet<string> => {
  const next = new Set(set);
  next.delete(id);
  return next;
};

/**
 * Owns the routing snapshot for one page: connection-revision guards (a snapshot from a
 * previous server never lands on a new one), 30 s polling while the tab is visible, and
 * the account/conversation actions. Both pages use it so they cannot drift apart.
 */
export function useRoutingOverview(): RoutingController {
  const { t } = useTranslation();
  const apiBase = useAuthStore((s) => s.apiBase);
  const managementKey = useAuthStore((s) => s.managementKey);
  const connected = useAuthStore((s) => s.connectionStatus === 'connected');
  const showNotification = useNotificationStore((s) => s.showNotification);

  const [data, setData] = useState<RoutingSnapshot | null>(null);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [busyAccountIds, setBusyAccountIds] = useState(EMPTY_IDS);
  const [busySessionIds, setBusySessionIds] = useState(EMPTY_IDS);

  const request = useRef(0);
  const loadedRevision = useRef(-1);
  const lastFetchAt = useRef(0);
  // Messages are looked up at call time so a language switch does not reload the snapshot.
  const translate = useRef(t);
  useEffect(() => {
    translate.current = t;
  }, [t]);
  const enabledRef = useRef(false);
  useEffect(() => {
    enabledRef.current = data?.enabled === true;
  }, [data?.enabled]);

  const load = useCallback(async () => {
    const seq = ++request.current;
    const revision = apiClient.getConnectionRevision();
    if (!connected) {
      setData(null);
      return;
    }
    try {
      const next = await routingSessionsApi.list();
      if (seq !== request.current || revision !== apiClient.getConnectionRevision()) return;
      loadedRevision.current = revision;
      lastFetchAt.current = Date.now();
      setData(next);
      setError('');
    } catch (err: unknown) {
      if (seq !== request.current || revision !== apiClient.getConnectionRevision()) return;
      setError(getErrorMessage(err, translate.current('sessions.load_failed')));
      // Data from this same connection stays on screen next to the error.
      if (loadedRevision.current !== revision) setData(null);
    } finally {
      if (seq === request.current && revision === apiClient.getConnectionRevision()) {
        setLoaded(true);
      }
    }
  }, [connected]);

  // Anything still in flight belongs to the previous connection or page: drop its answer.
  const invalidateRequests = useCallback(() => {
    request.current++;
  }, []);

  useEffect(() => {
    setData(null);
    setError('');
    setLoaded(false);
    setBusyAccountIds(EMPTY_IDS);
    setBusySessionIds(EMPTY_IDS);
    loadedRevision.current = -1;
    void load();
    return invalidateRequests;
  }, [apiBase, managementKey, load, invalidateRequests]);

  useEffect(() => {
    if (!connected) return;
    const reloadIfVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const timer = window.setInterval(reloadIfVisible, ROUTING_POLL_INTERVAL_MS);
    // A hidden tab skips its ticks; catch up as soon as it is shown again.
    const onVisibility = () => {
      if (Date.now() - lastFetchAt.current >= ROUTING_POLL_INTERVAL_MS) reloadIfVisible();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [connected, load]);

  /** Actions only run against the connection whose snapshot is on screen. */
  const currentRevision = useCallback((): number | null => {
    const revision = apiClient.getConnectionRevision();
    if (loadedRevision.current === revision) return revision;
    showNotification(translate.current('sessions.refresh_first'), 'error');
    return null;
  }, [showNotification]);

  const refreshQuota = useCallback(
    async (authId?: string) => {
      const revision = currentRevision();
      if (revision === null) return;
      if (authId) setBusyAccountIds((ids) => withId(ids, authId));
      else setRefreshingAll(true);
      try {
        const result = await routingSessionsApi.refreshQuota(authId);
        if (revision !== apiClient.getConnectionRevision()) return;
        // Show the polled values at once; the re-read below brings pending moves along.
        const fresh = new Map(result.accounts.map((a) => [a.id, a]));
        setData((old) =>
          old ? { ...old, accounts: old.accounts.map((a) => fresh.get(a.id) ?? a) } : old
        );
        await load();
        const failed = result.accounts.filter((a) => a.lastPollError);
        if (failed.length === 1) {
          showNotification(
            translate.current('sessions.refresh_failed_one', {
              name: failed[0].label || failed[0].id,
              error: failed[0].lastPollError,
            }),
            'error'
          );
        } else if (failed.length > 1) {
          showNotification(
            translate.current('sessions.refresh_failed_many', { count: failed.length }),
            'error'
          );
        }
      } catch (err: unknown) {
        if (revision === apiClient.getConnectionRevision()) {
          showNotification(
            getErrorMessage(err, translate.current('sessions.refresh_failed')),
            'error'
          );
        }
      } finally {
        if (revision === apiClient.getConnectionRevision()) {
          if (authId) setBusyAccountIds((ids) => withoutId(ids, authId));
          else setRefreshingAll(false);
        }
      }
    },
    [currentRevision, load, showNotification]
  );

  // Polling providers makes no sense (the backend answers 409) while the strategy is off.
  const refreshAll = useCallback(
    () => (enabledRef.current ? refreshQuota() : load()),
    [refreshQuota, load]
  );
  const refreshAccount = useCallback((authId: string) => refreshQuota(authId), [refreshQuota]);

  const setDraining = useCallback(
    async (authId: string, draining: boolean) => {
      const revision = currentRevision();
      if (revision === null) return;
      setBusyAccountIds((ids) => withId(ids, authId));
      try {
        await routingSessionsApi.drain(authId, draining);
        if (revision === apiClient.getConnectionRevision()) await load();
      } catch (err: unknown) {
        if (revision === apiClient.getConnectionRevision()) {
          showNotification(
            getErrorMessage(err, translate.current('sessions.action_failed')),
            'error'
          );
        }
      } finally {
        if (revision === apiClient.getConnectionRevision()) {
          setBusyAccountIds((ids) => withoutId(ids, authId));
        }
      }
    },
    [currentRevision, load, showNotification]
  );

  const moveSession = useCallback(
    async (session: RoutingSession, targetAuthId: string) => {
      const revision = currentRevision();
      if (revision === null) return;
      setBusySessionIds((ids) => withId(ids, session.id));
      try {
        await routingSessionsApi.move(session.id, targetAuthId, session.generation);
        if (revision !== apiClient.getConnectionRevision()) return;
        showNotification(translate.current('sessions.move_requested'), 'success');
        await load();
      } catch (err: unknown) {
        if (revision === apiClient.getConnectionRevision()) {
          showNotification(
            getErrorMessage(err, translate.current('sessions.action_failed')),
            'error'
          );
          // A stale generation is the usual cause: show the conversation as it is now.
          await load();
        }
      } finally {
        if (revision === apiClient.getConnectionRevision()) {
          setBusySessionIds((ids) => withoutId(ids, session.id));
        }
      }
    },
    [currentRevision, load, showNotification]
  );

  return {
    connected,
    data,
    error,
    loaded,
    refreshingAll,
    busyAccountIds,
    busySessionIds,
    load,
    refreshAll,
    refreshAccount,
    setDraining,
    moveSession,
  };
}
