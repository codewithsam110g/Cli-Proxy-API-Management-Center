import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { IconAlertTriangle, IconRefreshCw } from '@/components/ui/icons';
import { providerLabel } from '@/features/dashboard/utils';
import type { RoutingAccount, RoutingSnapshot } from '@/services/api/routingSessions';
import {
  accountLoad,
  accountStatuses,
  accountsUpdatedAt,
  isQuotaStopped,
  formatAgo,
  formatCountdown,
  parseMs,
  sortAccounts,
  stopSummary,
  type AccountLoad,
  type AccountStatus,
} from '../logic';
import type { CodexResets } from '../useCodexResets';
import type { RoutingController } from '../useRoutingOverview';
import { useTicker } from '../useTicker';
import { QuotaWindowBar } from './QuotaWindowBar';
import styles from './RoutingPanels.module.scss';

const CHIP_CLASS: Record<AccountStatus, string> = {
  active: styles.chipActive,
  draining: styles.chipDraining,
  reserve: styles.chipReserve,
  exhausted: styles.chipStopped,
  disabled: styles.chipDisabled,
};

interface AccountsPanelProps {
  routing: RoutingController;
  resets: CodexResets;
  /** Adds the long explanation of Drain (the Sessions page). */
  showDrainHelp?: boolean;
  /** Small caption above the title, in the dashboard's section style. */
  eyebrow?: string;
}

const NO_LOAD: AccountLoad = { live: 0, idle: 0 };

export function AccountsPanel({
  routing,
  resets,
  showDrainHelp = false,
  eyebrow,
}: AccountsPanelProps) {
  const { t, i18n } = useTranslation();
  const nowMs = useTicker();
  const { data } = routing;

  const accounts = useMemo(() => sortAccounts(data?.accounts ?? []), [data?.accounts]);
  const load = useMemo(
    () => (data ? accountLoad(data, nowMs) : new Map<string, AccountLoad>()),
    [data, nowMs]
  );

  if (!routing.connected) return null;

  const enabled = data?.enabled === true;
  const pollable = accounts.some((a) => a.windows.length > 0 && !a.disabled);
  const updatedAt = enabled ? accountsUpdatedAt(accounts) : null;

  return (
    <section className={styles.section} aria-label={t('sessions.accounts')}>
      <header className={styles.head}>
        <div className={styles.headCopy}>
          {eyebrow && <span className={styles.eyebrow}>{eyebrow}</span>}
          <h2 className={styles.title}>{t('sessions.accounts')}</h2>
          {enabled && data && <p className={styles.intro}>{introText(t, data)}</p>}
        </div>
        {enabled && (
          <div className={styles.headActions}>
            <span className={styles.updated} aria-live="off">
              {updatedAt === null
                ? t('sessions.not_checked_yet')
                : t('sessions.updated_ago', {
                    time: formatAgo(updatedAt, nowMs, i18n.resolvedLanguage),
                  })}
              {data ? ` · ${pollText(t, data.quotaPollIntervalSeconds)}` : ''}
            </span>
            {pollable && (
              <Button
                variant="secondary"
                size="sm"
                loading={routing.refreshingAll}
                onClick={() => {
                  void routing.refreshAll();
                  void resets.reload();
                }}
              >
                {t('sessions.refresh_all')}
              </Button>
            )}
          </div>
        )}
      </header>

      {routing.error && (
        <p role="alert" className={styles.alert}>
          {routing.error}
        </p>
      )}
      {data?.stateError && (
        <p role="alert" className={styles.alert}>
          {data.stateError}
        </p>
      )}

      <div className={styles.panel}>
        {!data ? (
          <p className={styles.note}>
            {routing.loaded ? t('sessions.unavailable_page') : t('sessions.loading')}
          </p>
        ) : !enabled ? (
          <div className={styles.notice}>
            <span>{t('sessions.disabled')}</span>
            <Link to="/config">{t('sessions.open_config')}</Link>
          </div>
        ) : accounts.length === 0 ? (
          <p className={styles.note}>{t('sessions.no_accounts')}</p>
        ) : (
          <ul className={styles.list}>
            {accounts.map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                load={load.get(account.id) ?? NO_LOAD}
                routing={routing}
                resets={resets}
                nowMs={nowMs}
                locked={Boolean(data.stateError)}
              />
            ))}
          </ul>
        )}
        {enabled && showDrainHelp && <p className={styles.help}>{t('sessions.account_help')}</p>}
      </div>
    </section>
  );
}

type Translate = ReturnType<typeof useTranslation>['t'];

function introText(t: Translate, data: RoutingSnapshot): string {
  const { shortWindowReservePercent: short, longWindowReservePercent: long } = data;
  return short === null || long === null
    ? t('sessions.accounts_intro_plain')
    : t('sessions.accounts_intro', { short, long });
}

function pollText(t: Translate, seconds: number): string {
  return seconds > 0
    ? t('sessions.poll_every', { interval: formatCountdown(seconds * 1000) })
    : t('sessions.poll_off');
}

interface AccountRowProps {
  account: RoutingAccount;
  load: AccountLoad;
  routing: RoutingController;
  resets: CodexResets;
  nowMs: number;
  locked: boolean;
}

function AccountRow({ account, load, routing, resets, nowMs, locked }: AccountRowProps) {
  const { t, i18n } = useTranslation();
  const [showDetails, setShowDetails] = useState(false);
  const statuses = accountStatuses(account);
  const name = account.label || account.id;
  const busy = routing.busyAccountIds.has(account.id) || routing.refreshingAll;
  const credits =
    account.provider === 'codex' && !account.disabled ? resets.creditsFor(account.id) : 0;
  const neverChecked = !account.observedAt && !account.lastPollSuccessAt;
  const canRefresh = account.windows.length > 0 && !account.disabled;
  const stoppedBy = isQuotaStopped(account) ? stopSummary(t, account) : '';
  const pollAt = parseMs(account.lastPollAt);

  const statusText = (status: AccountStatus) => {
    if (status === 'reserve' || status === 'exhausted') {
      return stoppedBy
        ? t(`sessions.status_${status}_reason`, { reason: stoppedBy })
        : t(`sessions.status_${status}`);
    }
    return t(`sessions.status_${status}`);
  };

  return (
    <li className={styles.accountRow}>
      <div className={styles.identity}>
        <div className={styles.nameLine}>
          <span className={styles.name} title={name}>
            {name}
          </span>
          <span className={styles.provider}>
            {providerLabel(account.provider, account.provider)}
          </span>
          {account.lastPollError && (
            <span
              className={styles.pollWarning}
              role="img"
              aria-label={t('sessions.poll_failed', { error: account.lastPollError })}
              title={t('sessions.poll_failed', { error: account.lastPollError })}
            >
              <IconAlertTriangle size={15} />
            </span>
          )}
        </div>
        <div className={styles.statusLine}>
          {statuses.map((status) => (
            <span key={status} className={`${styles.chip} ${CHIP_CLASS[status]}`}>
              {statusText(status)}
            </span>
          ))}
          <span className={styles.load}>{loadText(t, load)}</span>
        </div>
        <button
          type="button"
          className={styles.moreToggle}
          aria-expanded={showDetails}
          onClick={() => setShowDetails((value) => !value)}
        >
          {showDetails ? t('sessions.hide_details') : t('sessions.details')}
        </button>
      </div>

      {account.windows.length > 0 && !account.disabled ? (
        <div className={styles.windows}>
          {account.windows.map((window) => (
            <QuotaWindowBar
              key={`${window.kind}-${window.label}`}
              window={window}
              neverChecked={neverChecked}
              checkFailed={Boolean(account.lastPollError)}
              nowMs={nowMs}
            />
          ))}
        </div>
      ) : (
        <span className={styles.noWindows}>
          {account.disabled ? t('sessions.disabled_account_note') : t('sessions.no_quota_windows')}
        </span>
      )}

      <div className={styles.actions}>
        {canRefresh && (
          <Button
            variant="secondary"
            size="sm"
            loading={routing.busyAccountIds.has(account.id)}
            disabled={routing.refreshingAll || locked}
            title={t('sessions.refresh_account_hint')}
            onClick={() => {
              void routing.refreshAccount(account.id);
              if (account.provider === 'codex') void resets.reload([account.id]);
            }}
          >
            <span className={styles.btnIcon}>
              <IconRefreshCw size={13} />
            </span>
            {t('sessions.refresh')}
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || account.disabled || locked}
          title={account.draining ? t('sessions.resume_hint') : t('sessions.drain_hint')}
          onClick={() => void routing.setDraining(account.id, !account.draining)}
        >
          {account.draining ? t('sessions.resume') : t('sessions.drain')}
        </Button>
        {credits > 0 && (
          <Button
            variant="secondary"
            size="sm"
            loading={resets.resettingId === account.id}
            disabled={busy || Boolean(resets.resettingId) || locked}
            title={t('sessions.use_reset_hint')}
            onClick={() => resets.requestReset(account)}
          >
            {t('sessions.use_reset', { count: credits })}
          </Button>
        )}
      </div>

      {showDetails && (
        <div className={`${styles.details} ${styles.accountDetails}`}>
          <dl className={styles.detailsGrid}>
            <div>
              <dt>{t('sessions.account_id')}</dt>
              <dd className={styles.mono}>{account.id}</dd>
            </div>
            <div>
              <dt>{t('sessions.provider')}</dt>
              <dd>{providerLabel(account.provider, account.provider)}</dd>
            </div>
            <div>
              <dt>{t('sessions.recent')}</dt>
              <dd>{account.recentSessions}</dd>
            </div>
            <div>
              <dt>{t('sessions.observed')}</dt>
              <dd>{when(account.observedAt, i18n.language, t('sessions.never'))}</dd>
            </div>
            <div>
              <dt>{t('sessions.last_check')}</dt>
              <dd>
                {when(account.lastPollAt, i18n.language, t('sessions.never'))}
                {pollAt !== null && (
                  <span className={styles.subtle}>
                    {' '}
                    ({formatAgo(pollAt, nowMs, i18n.resolvedLanguage)})
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt>{t('sessions.last_check_ok')}</dt>
              <dd>{when(account.lastPollSuccessAt, i18n.language, t('sessions.never'))}</dd>
            </div>
            {account.lastPollError && (
              <div>
                <dt>{t('sessions.last_check_error')}</dt>
                <dd>{account.lastPollError}</dd>
              </div>
            )}
            {isQuotaStopped(account) && (
              <div>
                <dt>{t('sessions.quota_stopped')}</dt>
                <dd>
                  {stoppedBy}
                  {account.quotaStopReason && (
                    <span className={styles.subtle}> — {account.quotaStopReason}</span>
                  )}
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}
    </li>
  );
}

function loadText(t: Translate, load: AccountLoad): string {
  if (load.live === 0 && load.idle === 0) return t('sessions.no_conversations');
  const live = t('sessions.live_conversations', { count: load.live });
  return load.idle > 0
    ? `${live} · ${t('sessions.idle_conversations', { count: load.idle })}`
    : live;
}

function when(value: string, locale: string, fallback: string): string {
  const ms = parseMs(value);
  return ms === null ? fallback : new Date(ms).toLocaleString(locale);
}
