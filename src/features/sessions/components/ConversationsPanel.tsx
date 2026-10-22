import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronDown } from '@/components/ui/icons';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { providerLabel } from '@/features/dashboard/utils';
import {
  cacheReadPercent,
  type RoutingAccount,
  type RoutingSession,
} from '@/services/api/routingSessions';
import { useNotificationStore } from '@/stores';
import { copyToClipboard } from '@/utils/clipboard';
import { formatCompactNumber, formatPercent } from '@/utils/format';
import {
  SUBAGENT_COLLAPSE_THRESHOLD,
  describeReason,
  formatAgo,
  formatPercentLeft,
  friendlyModelName,
  groupConversations,
  isQuotaStopped,
  isSubagentSession,
  moveTargets,
  parseMs,
  sessionActivityMs,
  shortSessionId,
  sortAccounts,
  windowLabelText,
  type ConversationGroup,
  type ConversationNode,
} from '../logic';
import type { RoutingController } from '../useRoutingOverview';
import { useTicker } from '../useTicker';
import styles from './RoutingPanels.module.scss';
import { RowMenu, type RowMenuSection } from './RowMenu';

interface ConversationsPanelProps {
  routing: RoutingController;
  /** The Dashboard starts with live conversations only, the Sessions page with everything. */
  defaultShowIdle?: boolean;
  eyebrow?: string;
  /** Adds the explanation of what a requested move does (the Sessions page). */
  showMoveHelp?: boolean;
}

const countRoots = (groups: ConversationGroup[]) =>
  groups.reduce((sum, group) => sum + group.roots.length, 0);

export function ConversationsPanel({
  routing,
  defaultShowIdle = false,
  eyebrow,
  showMoveHelp = false,
}: ConversationsPanelProps) {
  const { t } = useTranslation();
  const nowMs = useTicker();
  const [showIdle, setShowIdle] = useState(defaultShowIdle);
  const { data } = routing;

  const { groups, hiddenIdle } = useMemo(() => {
    if (!data?.enabled) return { groups: [], hiddenIdle: 0 };
    // Same order as the accounts table above, so the two lists read alike.
    const ordered = { accounts: sortAccounts(data.accounts), sessions: data.sessions };
    const visible = groupConversations(ordered, { nowMs, showIdle });
    const all = showIdle ? visible : groupConversations(ordered, { nowMs, showIdle: true });
    return { groups: visible, hiddenIdle: countRoots(all) - countRoots(visible) };
  }, [data, nowMs, showIdle]);

  // The accounts panel already explains a missing or disabled backend feature.
  if (!routing.connected || !data?.enabled) return null;

  return (
    <section className={styles.section} aria-label={t('sessions.conversations')}>
      <header className={styles.head}>
        <div className={styles.headCopy}>
          {eyebrow && <span className={styles.eyebrow}>{eyebrow}</span>}
          <h2 className={styles.title}>
            {showIdle ? t('sessions.conversations') : t('sessions.live_conversations_title')}
          </h2>
        </div>
        <div className={styles.filters}>
          <ToggleSwitch
            checked={showIdle}
            onChange={setShowIdle}
            label={t('sessions.show_idle')}
            ariaLabel={t('sessions.show_idle')}
          />
        </div>
      </header>

      <div className={styles.panel}>
        {groups.length === 0 ? (
          <p className={styles.note}>
            {t('sessions.empty_active')}
            {hiddenIdle > 0 && ` ${t('sessions.idle_hidden', { count: hiddenIdle })}`}
          </p>
        ) : (
          <div>
            {groups.map((group) => (
              <GroupBlock
                key={group.accountId}
                group={group}
                accounts={data.accounts}
                routing={routing}
                nowMs={nowMs}
              />
            ))}
          </div>
        )}
        {showMoveHelp && <p className={styles.help}>{t('sessions.move_help')}</p>}
      </div>
    </section>
  );
}

interface GroupBlockProps {
  group: ConversationGroup;
  accounts: RoutingAccount[];
  routing: RoutingController;
  nowMs: number;
}

function GroupBlock({ group, accounts, routing, nowMs }: GroupBlockProps) {
  const { t } = useTranslation();
  const { account } = group;
  const shortWindow = account?.windows.find((w) => w.kind === 'short');
  const name = account ? account.label || account.id : group.accountId;
  return (
    <div className={styles.group}>
      <div className={styles.groupHead}>
        <span className={styles.groupName}>{name}</span>
        {account && (
          <span className={styles.provider}>
            {providerLabel(account.provider, account.provider)}
          </span>
        )}
        {account && isQuotaStopped(account) && (
          <span
            className={`${styles.chip} ${account.quotaExhausted ? styles.chipStopped : styles.chipReserve}`}
          >
            {t(account.quotaExhausted ? 'sessions.status_exhausted' : 'sessions.status_reserve')}
          </span>
        )}
        {!account && <span className={styles.groupQuota}>{t('sessions.account_gone')}</span>}
        {shortWindow && shortWindow.remainingPercent !== null && (
          <span className={styles.groupQuota}>
            {windowLabelText(t, shortWindow.label)}{' '}
            {t('sessions.percent_left', {
              percent: formatPercentLeft(shortWindow.remainingPercent),
            })}
          </span>
        )}
        <span className={styles.groupCount}>
          {t('sessions.conversation_count', { count: group.roots.length })}
        </span>
      </div>
      <ul className={styles.list}>
        {group.roots.map((node) => (
          <ConversationItem
            key={node.session.id}
            node={node}
            accounts={accounts}
            routing={routing}
            nowMs={nowMs}
          />
        ))}
      </ul>
    </div>
  );
}

interface ConversationItemProps {
  node: ConversationNode;
  /** A subagent row, drawn indented under its parent. */
  nested?: boolean;
  accounts: RoutingAccount[];
  routing: RoutingController;
  nowMs: number;
}

function ConversationItem({
  node,
  nested = false,
  accounts,
  routing,
  nowMs,
}: ConversationItemProps) {
  const { t, i18n } = useTranslation();
  const showNotification = useNotificationStore((s) => s.showNotification);
  const showConfirmation = useNotificationStore((s) => s.showConfirmation);
  const { session, children } = node;
  const [showDetails, setShowDetails] = useState(false);
  const [showChildren, setShowChildren] = useState(children.length <= SUBAGENT_COLLAPSE_THRESHOLD);

  const accountName = (id: string) => {
    const found = accounts.find((a) => a.id === id);
    return found ? found.label || found.id : id;
  };
  const targets = moveTargets(session, accounts);
  const cache = cacheReadPercent(session);
  const activityMs = sessionActivityMs(session);
  const busy = routing.busySessionIds.has(session.id);
  const modelName = friendlyModelName(session.model) || session.model || '—';

  const copyId = async () => {
    const ok = await copyToClipboard(session.sessionId);
    showNotification(
      t(ok ? 'sessions.id_copied' : 'sessions.copy_failed'),
      ok ? 'success' : 'error'
    );
  };

  const requestMove = (target: RoutingAccount) => {
    showConfirmation({
      title: t('sessions.move_confirm_title'),
      message: t('sessions.move_confirm_message', {
        id: shortSessionId(session.sessionId),
        from: accountName(session.authId),
        to: target.label || target.id,
      }),
      confirmText: t('sessions.move'),
      variant: 'primary',
      onConfirm: () => routing.moveSession(session, target.id),
    });
  };

  const menu: RowMenuSection[] = [
    {
      items: [
        {
          id: 'details',
          label: showDetails ? t('sessions.hide_details') : t('sessions.details'),
          onSelect: () => setShowDetails((value) => !value),
        },
      ],
    },
    {
      label: t('sessions.move_to'),
      items: targets.length
        ? targets.map((target) => {
            const shortWindow = target.windows.find((w) => w.kind === 'short');
            return {
              id: target.id,
              label: target.label || target.id,
              hint:
                shortWindow && shortWindow.remainingPercent !== null
                  ? `${windowLabelText(t, shortWindow.label)} ${t('sessions.percent_left', {
                      percent: formatPercentLeft(shortWindow.remainingPercent),
                    })}`
                  : providerLabel(target.provider, target.provider),
              disabled: busy || Boolean(routing.data?.stateError),
              onSelect: () => requestMove(target),
            };
          })
        : [
            {
              id: 'none',
              label: t('sessions.no_move_targets'),
              disabled: true,
              onSelect: () => {},
            },
          ],
    },
  ];

  const pending = session.pendingReason ? describeReason(t, session.pendingReason, 'moving') : '';

  return (
    <li>
      <div
        className={[
          styles.convRow,
          nested ? styles.convChild : '',
          node.live ? '' : styles.convIdle,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className={styles.convMain}>
          <span className={styles.model} title={session.model}>
            {modelName}
          </span>
          <button
            type="button"
            className={styles.idButton}
            title={`${session.sessionId}\n${t('sessions.copy_id_hint')}`}
            aria-label={t('sessions.copy_id', { id: session.sessionId })}
            onClick={() => void copyId()}
          >
            {shortSessionId(session.sessionId)}
          </button>
          {isSubagentSession(session) && children.length === 0 && (
            <span className={styles.subagentTag}>{t('sessions.subagent')}</span>
          )}
          {children.length > 0 && (
            <button
              type="button"
              className={styles.subagentBadge}
              aria-expanded={showChildren}
              onClick={() => setShowChildren((value) => !value)}
            >
              {t('sessions.subagent_count', { count: children.length })}
              <span className={`${styles.chevron} ${showChildren ? styles.chevronOpen : ''}`}>
                <IconChevronDown size={12} />
              </span>
            </button>
          )}
          {pending && (
            <span className={styles.pending} title={session.pendingReason}>
              {t('sessions.moving', { reason: pending })}
            </span>
          )}
        </div>
        <div className={styles.convMeta}>
          <span
            className={styles.activity}
            title={activityMs ? new Date(activityMs).toLocaleString(i18n.language) : undefined}
          >
            {activityMs ? formatAgo(activityMs, nowMs, i18n.resolvedLanguage) : '—'}
          </span>
          <span className={styles.tokens} title={t('sessions.tokens_hint')}>
            {formatCompactNumber(session.inputTokens)}{' '}
            <span className={styles.metaLabel}>{t('sessions.tokens_in')}</span>
            {' · '}
            {formatCompactNumber(session.outputTokens)}{' '}
            <span className={styles.metaLabel}>{t('sessions.tokens_out')}</span>
          </span>
          <span className={styles.cache} title={t('sessions.cache_hint')}>
            {cache === null ? (
              '—'
            ) : (
              <>
                {formatPercent(cache, 0)}{' '}
                <span className={styles.metaLabel}>{t('sessions.cache_short')}</span>
              </>
            )}
          </span>
        </div>
        <div className={styles.convMenu}>
          <RowMenu ariaLabel={t('sessions.row_actions')} sections={menu} disabled={busy} />
        </div>
        {showDetails && (
          <div className={`${styles.details} ${styles.convDetails}`}>
            <SessionDetails session={session} accountName={accountName} />
          </div>
        )}
      </div>
      {children.length > 0 && showChildren && (
        <ul className={styles.children}>
          {children.map((child) => (
            <ConversationItem
              key={child.session.id}
              node={child}
              nested
              accounts={accounts}
              routing={routing}
              nowMs={nowMs}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function SessionDetails({
  session,
  accountName,
}: {
  session: RoutingSession;
  accountName: (id: string) => string;
}) {
  const { t, i18n } = useTranslation();
  const cache = cacheReadPercent(session);
  const when = (value: string) => {
    const ms = parseMs(value);
    return ms === null ? t('sessions.unknown') : new Date(ms).toLocaleString(i18n.language);
  };
  const named = friendlyModelName(session.model);
  return (
    <>
      <dl className={styles.detailsGrid}>
        <div>
          <dt>{t('sessions.session_id')}</dt>
          <dd className={styles.mono}>{session.sessionId}</dd>
        </div>
        <div>
          <dt>{t('sessions.model')}</dt>
          <dd>
            {named && named !== session.model ? `${named} · ` : ''}
            <span className={styles.mono}>{session.model || '—'}</span>
            <span className={styles.subtle}>
              {' '}
              · {providerLabel(session.provider, session.provider)}
            </span>
          </dd>
        </div>
        <div>
          <dt>{t('sessions.account')}</dt>
          <dd>
            {accountName(session.authId)}
            {accountName(session.authId) !== session.authId && (
              <span className={`${styles.mono} ${styles.subtle}`}> · {session.authId}</span>
            )}
          </dd>
        </div>
        <div>
          <dt>{t('sessions.reason')}</dt>
          <dd title={session.reason}>
            {session.reason ? describeReason(t, session.reason, 'placement') : '—'}
          </dd>
        </div>
        {session.pendingReason && (
          <div>
            <dt>{t('sessions.pending')}</dt>
            <dd title={session.pendingReason}>
              {describeReason(t, session.pendingReason, 'moving')}
              {session.pendingAuthId && ` → ${accountName(session.pendingAuthId)}`}
            </dd>
          </div>
        )}
        <div>
          <dt>{t('sessions.last_seen')}</dt>
          <dd>{when(session.lastSeen)}</dd>
        </div>
        <div>
          <dt>{t('sessions.created')}</dt>
          <dd>{when(session.createdAt)}</dd>
        </div>
        <div>
          <dt>{t('sessions.expires')}</dt>
          <dd>{when(session.expiresAt)}</dd>
        </div>
        <div>
          <dt>{t('sessions.results')}</dt>
          <dd>
            {session.successes} / {session.failures}
          </dd>
        </div>
        <div>
          <dt>{t('sessions.tokens')}</dt>
          <dd className={styles.mono}>
            {session.inputTokens.toLocaleString()} / {session.outputTokens.toLocaleString()}
          </dd>
        </div>
        <div>
          <dt>{t('sessions.cache_read')}</dt>
          <dd>{cache === null ? t('sessions.unknown') : `${cache.toFixed(1)}%`}</dd>
        </div>
        <div>
          <dt>{t('sessions.cache_write')}</dt>
          <dd className={styles.mono}>{session.cacheWriteTokens.toLocaleString()}</dd>
        </div>
        <div>
          <dt>{t('sessions.parent')}</dt>
          <dd className={styles.mono}>{session.parentSessionId || '—'}</dd>
        </div>
        <div>
          <dt>{t('sessions.caller')}</dt>
          <dd className={styles.mono}>{session.callerScope || '—'}</dd>
        </div>
        <div>
          <dt>{t('sessions.generation')}</dt>
          <dd>{session.generation}</dd>
        </div>
      </dl>
      {session.missingUsageSamples > 0 && (
        <p className={styles.subtle}>{t('sessions.partial_usage')}</p>
      )}
      {session.migrations.length > 0 && (
        <details className={styles.history}>
          <summary>
            {t('sessions.history')} ({session.migrations.length})
          </summary>
          <ul>
            {session.migrations.map((m, index) => (
              <li key={`${m.at}-${index}`}>
                {when(m.at)}: {accountName(m.from)} → {accountName(m.to)} (
                {describeReason(t, m.reason, 'moving')})
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
