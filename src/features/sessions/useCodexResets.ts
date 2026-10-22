import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CODEX_CONFIG, fetchCodexResetCreditsForFile } from '@/features/quota/providers/codex/data';
import { authFilesApi } from '@/services/api';
import { apiClient } from '@/services/api/client';
import type { RoutingAccount } from '@/services/api/routingSessions';
import { useAuthStore, useNotificationStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { getErrorMessage } from '@/utils/helpers';
import { windowLabelText } from './logic';
import type { RoutingController } from './useRoutingOverview';

export interface CodexResets {
  /** Manual resets left on a Codex account; 0 when none or not known yet. */
  creditsFor: (authId: string) => number;
  /** The account whose reset is being consumed right now. */
  resettingId: string | null;
  /** Asks for confirmation, then consumes one reset credit and re-checks the account. */
  requestReset: (account: RoutingAccount) => void;
  /** Re-reads the credits of the given accounts (all Codex accounts when omitted). */
  reload: (authIds?: string[]) => Promise<void>;
}

const fileOf = (files: AuthFileItem[], authId: string): AuthFileItem | undefined =>
  files.find((file) => String(file.id ?? '') === authId) ??
  files.find((file) => file.name === authId);

const creditCount = (data: Awaited<ReturnType<typeof fetchCodexResetCreditsForFile>>): number =>
  Math.max(0, data.availableCount ?? data.credits.length);

/**
 * Codex manual rate-limit resets for the routing accounts. Credits are read once per
 * account (and again on a manual refresh), not on every 30 s snapshot poll, because each read
 * is an upstream call. Consuming goes through the quota page's own reset flow.
 */
export function useCodexResets(routing: RoutingController): CodexResets {
  const { t } = useTranslation();
  const apiBase = useAuthStore((s) => s.apiBase);
  const managementKey = useAuthStore((s) => s.managementKey);
  const showNotification = useNotificationStore((s) => s.showNotification);
  const showConfirmation = useNotificationStore((s) => s.showConfirmation);
  const [credits, setCredits] = useState<Record<string, number>>({});
  const [resettingId, setResettingId] = useState<string | null>(null);
  const requested = useRef(new Set<string>());
  const translate = useRef(t);
  useEffect(() => {
    translate.current = t;
  }, [t]);

  const { connected, data, refreshAccount } = routing;
  // A stable key so credits are not re-read every time the snapshot object changes.
  const codexKey = useMemo(
    () =>
      (data?.accounts ?? [])
        .filter((a) => a.provider === 'codex' && !a.disabled)
        .map((a) => a.id)
        .sort()
        .join('\n'),
    [data?.accounts]
  );

  const load = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    const revision = apiClient.getConnectionRevision();
    try {
      const { files } = await authFilesApi.list();
      for (const id of ids) {
        const file = fileOf(files, id);
        if (!file) continue;
        const result = await fetchCodexResetCreditsForFile(file, translate.current);
        if (revision !== apiClient.getConnectionRevision()) return;
        // A failed read keeps the last known count instead of hiding a usable reset.
        if (result.error) continue;
        setCredits((old) => ({ ...old, [id]: creditCount(result) }));
      }
    } catch {
      // Reset credits are a convenience; the accounts table works without them.
    }
  }, []);

  useEffect(() => {
    requested.current.clear();
    setCredits({});
    setResettingId(null);
  }, [apiBase, managementKey]);

  useEffect(() => {
    if (!connected || !codexKey) return;
    const missing = codexKey.split('\n').filter((id) => !requested.current.has(id));
    if (!missing.length) return;
    missing.forEach((id) => requested.current.add(id));
    void load(missing);
  }, [connected, codexKey, load]);

  const reload = useCallback(
    (authIds?: string[]) => load(authIds ?? (codexKey ? codexKey.split('\n') : [])),
    [load, codexKey]
  );

  const requestReset = useCallback(
    (account: RoutingAccount) => {
      const resetQuota = CODEX_CONFIG.resetQuota;
      const count = credits[account.id] ?? 0;
      if (!resetQuota || resettingId || count <= 0) return;
      const name = account.label || account.id;
      const windows = account.windows.map((w) => windowLabelText(t, w.label)).join(', ');
      showConfirmation({
        title: t('sessions.reset_confirm_title'),
        message: t('sessions.reset_confirm_message', {
          name,
          count,
          windows: windows || t('sessions.reset_all_limits'),
        }),
        confirmText: t('sessions.reset_confirm_button'),
        variant: 'primary',
        onConfirm: async () => {
          const revision = apiClient.getConnectionRevision();
          setResettingId(account.id);
          try {
            const { files } = await authFilesApi.list();
            const file = fileOf(files, account.id);
            if (!file) throw new Error(t('sessions.reset_no_credential', { name }));
            const quota = await resetQuota(file, t);
            if (revision !== apiClient.getConnectionRevision()) return;
            const left = quota.rateLimitResetCreditsAvailableCount;
            if (left === null) void load([account.id]);
            else setCredits((old) => ({ ...old, [account.id]: Math.max(0, left) }));
            showNotification(t('codex_quota.reset_success', { name }), 'success');
            // The provider's windows just changed: ask the backend to look again.
            await refreshAccount(account.id);
          } catch (err: unknown) {
            if (revision !== apiClient.getConnectionRevision()) return;
            showNotification(
              t('codex_quota.reset_failed', {
                name,
                message: getErrorMessage(err, t('common.unknown_error')),
              }),
              'error'
            );
            // The credit may have been spent even though a later step failed: look again.
            void load([account.id]);
            void refreshAccount(account.id);
          } finally {
            if (revision === apiClient.getConnectionRevision()) setResettingId(null);
          }
        },
      });
    },
    [credits, load, refreshAccount, resettingId, showConfirmation, showNotification, t]
  );

  const creditsFor = useCallback((authId: string) => credits[authId] ?? 0, [credits]);

  return { creditsFor, resettingId, requestReset, reload };
}
