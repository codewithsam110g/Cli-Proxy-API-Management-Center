import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { apiClient } from '@/services/api/client';
import {
  cacheReadPercent,
  routingSessionsApi,
  type RoutingSnapshot,
} from '@/services/api/routingSessions';
import { useAuthStore } from '@/stores';
import { getErrorMessage } from '@/utils/helpers';
import styles from './SessionsPage.module.scss';

export function SessionsPage() {
  const { t } = useTranslation();
  const apiBase = useAuthStore((s) => s.apiBase);
  const managementKey = useAuthStore((s) => s.managementKey);
  const connected = useAuthStore((s) => s.connectionStatus === 'connected');
  const [data, setData] = useState<RoutingSnapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const request = useRef(0);
  const loadedRevision = useRef(-1);

  const load = useCallback(async () => {
    const seq = ++request.current;
    const revision = apiClient.getConnectionRevision();
    if (!connected) {
      setData(null);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const next = await routingSessionsApi.list();
      if (seq !== request.current || revision !== apiClient.getConnectionRevision()) return;
      loadedRevision.current = revision;
      setData(next);
      setTargets({});
    } catch (err: unknown) {
      if (seq === request.current && revision === apiClient.getConnectionRevision()) {
        setData(null);
        setError(getErrorMessage(err, t('sessions.load_failed')));
      }
    } finally {
      if (seq === request.current && revision === apiClient.getConnectionRevision()) setBusy(false);
    }
  }, [connected, t]);

  const invalidateRequests = useCallback(() => {
    request.current++;
  }, []);

  useEffect(() => {
    setData(null);
    setTargets({});
    loadedRevision.current = -1;
    void load();
    return invalidateRequests;
  }, [apiBase, managementKey, load, invalidateRequests]);
  useHeaderRefresh(load, connected);

  const act = async (operation: () => Promise<unknown>) => {
    const revision = apiClient.getConnectionRevision();
    if (loadedRevision.current !== revision) {
      setError(t('sessions.refresh_first'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await operation();
      if (revision === apiClient.getConnectionRevision()) await load();
    } catch (err: unknown) {
      if (revision === apiClient.getConnectionRevision())
        setError(getErrorMessage(err, t('sessions.action_failed')));
    } finally {
      if (revision === apiClient.getConnectionRevision()) setBusy(false);
    }
  };
  const date = (value: string) =>
    value && !value.startsWith('0001-') ? new Date(value).toLocaleString() : t('sessions.unknown');

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>{t('sessions.title')}</h1>
          <p>{t('sessions.description')}</p>
        </div>
        <Button variant="secondary" loading={busy} onClick={() => void load()}>
          {t('sessions.refresh')}
        </Button>
      </header>
      {error && (
        <div role="alert" className="error-box">
          {error}
        </div>
      )}
      {data?.stateError && (
        <div role="alert" className="error-box">
          {data.stateError}
        </div>
      )}
      {data && !data.enabled && (
        <section className={styles.card}>
          <p>{t('sessions.disabled')}</p>
          <Link to="/config">{t('sessions.open_config')}</Link>
        </section>
      )}
      {data?.enabled && (
        <>
          <section aria-label={t('sessions.accounts')}>
            <h2>{t('sessions.accounts')}</h2>
            <p>{t('sessions.account_help')}</p>
            <div className={styles.grid}>
              {data.accounts.map((account) => (
                <article key={account.id} className={styles.card}>
                  <h3>{account.label || account.id}</h3>
                  <p className={styles.identity}>{account.id}</p>
                  <p>{account.provider}</p>
                  <dl>
                    <dt>{t('sessions.headroom')}</dt>
                    <dd>
                      {account.remainingPercent === null
                        ? t('sessions.unknown')
                        : `${account.remainingPercent.toFixed(0)}%`}
                    </dd>
                    <dt>{t('sessions.observed')}</dt>
                    <dd>{date(account.observedAt)}</dd>
                    <dt>{t('sessions.recent')}</dt>
                    <dd>{account.recentSessions}</dd>
                    <dt>{t('sessions.status')}</dt>
                    <dd>
                      {account.disabled
                        ? t('sessions.unavailable')
                        : account.quotaStopped
                          ? t('sessions.quota_stopped')
                          : account.draining
                            ? t('sessions.draining')
                            : t('sessions.accepting')}
                    </dd>
                  </dl>
                  {account.quotaStopped && <p>{t('sessions.quota_stop_help')}</p>}
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy || account.disabled || Boolean(data.stateError)}
                    onClick={() =>
                      void act(() => routingSessionsApi.drain(account.id, !account.draining))
                    }
                  >
                    {account.draining ? t('sessions.resume') : t('sessions.drain')}
                  </Button>
                </article>
              ))}
            </div>
          </section>
          <section aria-label={t('sessions.conversations')}>
            <h2>{t('sessions.conversations')}</h2>
            {!data.sessions.length && <p>{t('sessions.empty')}</p>}
            <div className={styles.grid}>
              {data.sessions.map((session) => {
                const cache = cacheReadPercent(session);
                const candidates = data.accounts.filter(
                  (a) =>
                    a.id !== session.authId &&
                    a.provider === session.provider &&
                    !a.disabled &&
                    !a.quotaStopped &&
                    !a.draining
                );
                return (
                  <article key={session.id} className={styles.card}>
                    <h3 className={styles.identity}>{session.sessionId}</h3>
                    <p>
                      {session.provider} · {session.model}
                    </p>
                    <dl>
                      <dt>{t('sessions.account')}</dt>
                      <dd>{session.authId}</dd>
                      <dt>{t('sessions.reason')}</dt>
                      <dd>{session.reason}</dd>
                      <dt>{t('sessions.last_seen')}</dt>
                      <dd>{date(session.lastSeen)}</dd>
                      <dt>{t('sessions.cache_read')}</dt>
                      <dd>{cache === null ? t('sessions.unknown') : `${cache.toFixed(1)}%`}</dd>
                      <dt>{t('sessions.tokens')}</dt>
                      <dd>
                        {session.inputTokens.toLocaleString()} /{' '}
                        {session.outputTokens.toLocaleString()}
                      </dd>
                      <dt>{t('sessions.cache_write')}</dt>
                      <dd>{session.cacheWriteTokens.toLocaleString()}</dd>
                    </dl>
                    <details>
                      <summary>{t('sessions.details')}</summary>
                      <dl>
                        <dt>{t('sessions.parent')}</dt>
                        <dd>{session.parentSessionId || '—'}</dd>
                        <dt>{t('sessions.caller')}</dt>
                        <dd className={styles.identity}>{session.callerScope || '—'}</dd>
                        <dt>{t('sessions.generation')}</dt>
                        <dd>{session.generation}</dd>
                        <dt>{t('sessions.created')}</dt>
                        <dd>{date(session.createdAt)}</dd>
                        <dt>{t('sessions.expires')}</dt>
                        <dd>{date(session.expiresAt)}</dd>
                        <dt>{t('sessions.results')}</dt>
                        <dd>
                          {session.successes} / {session.failures}
                        </dd>
                      </dl>
                    </details>
                    {session.missingUsageSamples > 0 && <p>{t('sessions.partial_usage')}</p>}
                    {session.pendingReason && (
                      <p className={styles.pending}>
                        {t('sessions.pending')}: {session.pendingReason}
                      </p>
                    )}
                    {!!session.migrations.length && (
                      <details>
                        <summary>
                          {t('sessions.history')} ({session.migrations.length})
                        </summary>
                        <ul>
                          {session.migrations.map((m, index) => (
                            <li key={`${m.at}-${index}`}>
                              {date(m.at)}: {m.from} → {m.to} ({m.reason})
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {!!candidates.length && (
                      <div className={styles.actions}>
                        <Select
                          value={targets[session.id] || ''}
                          options={candidates.map((a) => ({
                            value: a.id,
                            label: a.label ? `${a.label} (${a.id})` : a.id,
                          }))}
                          placeholder={t('sessions.choose_account')}
                          ariaLabel={t('sessions.choose_account')}
                          disabled={busy || Boolean(data.stateError)}
                          onChange={(value) =>
                            setTargets((old) => ({ ...old, [session.id]: value }))
                          }
                        />
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy || !targets[session.id] || Boolean(data.stateError)}
                          onClick={() =>
                            void act(() =>
                              routingSessionsApi.move(
                                session.id,
                                targets[session.id],
                                session.generation
                              )
                            )
                          }
                        >
                          {t('sessions.move')}
                        </Button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
            <p>{t('sessions.move_help')}</p>
          </section>
        </>
      )}
    </div>
  );
}
