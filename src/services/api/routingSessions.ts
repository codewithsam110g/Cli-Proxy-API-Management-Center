import { apiClient } from './client';
import { isRecord } from '@/utils/helpers';

export type RoutingWindowKind = 'short' | 'long';

/** One provider quota window (5-hour, weekly, monthly) of an account. */
export interface RoutingWindow {
  kind: RoutingWindowKind;
  /** Backend wording: "5-hour", "weekly" or "monthly". Translate with the logic helpers. */
  label: string;
  /** null = unknown, stale, or the window already reset. */
  remainingPercent: number | null;
  /** ISO instant, or '' when unknown or already passed. */
  resetAt: string;
  /** Stop threshold in force for this window; null when the backend did not say. */
  reservePercent: number | null;
  stopped: boolean;
}
export interface RoutingAccount {
  id: string;
  label: string;
  provider: string;
  disabled: boolean;
  draining: boolean;
  recentSessions: number;
  remainingPercent: number | null;
  /** '' when never observed (the backend sends the zero time then). */
  observedAt: string;
  /** Inside a reserve or exhausted: the account takes no new conversations. */
  quotaStopped: boolean;
  quotaStopReason: string;
  /**
   * The stop is provider-enforced (confirmed quota or a window at 0%): conversations must leave.
   * `quotaStopped && !quotaExhausted` is the soft reserve: they stay unless another account has room.
   */
  quotaExhausted: boolean;
  /** Short window first. Empty for API-key accounts and other providers. */
  windows: RoutingWindow[];
  lastPollAt: string;
  lastPollSuccessAt: string;
  /** Short classification of the latest failed poll; '' after a success. */
  lastPollError: string;
}
export interface RoutingSession {
  id: string;
  sessionId: string;
  parentSessionId: string;
  provider: string;
  model: string;
  authId: string;
  generation: number;
  callerScope: string;
  createdAt: string;
  successes: number;
  failures: number;
  lastSeen: string;
  expiresAt: string;
  reason: string;
  pendingReason: string;
  /** Account a manual move is waiting to switch to; '' for automatic moves. */
  pendingAuthId: string;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  missingUsageSamples: number;
  migrations: Array<{ at: string; from: string; to: string; reason: string }>;
}
export interface RoutingSnapshot {
  enabled: boolean;
  stateError: string;
  /** 0 = background polling is off. */
  quotaPollIntervalSeconds: number;
  shortWindowReservePercent: number | null;
  longWindowReservePercent: number | null;
  sessions: RoutingSession[];
  accounts: RoutingAccount[];
}
export interface RoutingRefreshResult {
  /** Accounts whose poll finished moments ago and was reused. */
  coalescedAuthIds: string[];
  accounts: RoutingAccount[];
}

/** The refresh waits for the provider (bounded to 30 s per account by the backend). */
export const QUOTA_REFRESH_TIMEOUT_MS = 65 * 1000;

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const number = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
const percentOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;

/** Go's zero time ("0001-01-01…") and unparsable values both mean "never". */
const timestamp = (value: unknown): string => {
  const raw = text(value).trim();
  if (!raw || raw.startsWith('0001-')) return '';
  return Number.isNaN(Date.parse(raw)) ? '' : raw;
};

const normalizeWindow = (value: unknown): RoutingWindow | null => {
  if (!isRecord(value) || (value.kind !== 'short' && value.kind !== 'long')) return null;
  return {
    kind: value.kind,
    label: text(value.label),
    remainingPercent: percentOrNull(value.remaining_percent),
    resetAt: timestamp(value.reset_at),
    reservePercent: percentOrNull(value.reserve_percent),
    stopped: value.stopped === true,
  };
};

export function normalizeRoutingAccount(a: Record<string, unknown>): RoutingAccount {
  return {
    id: text(a.id),
    label: text(a.label),
    provider: text(a.provider),
    disabled: a.disabled === true,
    draining: a.draining === true,
    recentSessions: number(a.recent_sessions),
    remainingPercent: percentOrNull(a.remaining_percent),
    observedAt: timestamp(a.observed_at),
    quotaStopped: a.quota_stopped === true,
    quotaStopReason: text(a.quota_stop_reason),
    quotaExhausted: a.quota_exhausted === true,
    windows: Array.isArray(a.windows)
      ? a.windows.map(normalizeWindow).filter((w): w is RoutingWindow => w !== null)
      : [],
    lastPollAt: timestamp(a.last_poll_at),
    lastPollSuccessAt: timestamp(a.last_poll_success_at),
    lastPollError: text(a.last_poll_error).trim(),
  };
}

export function normalizeRoutingSnapshot(value: unknown): RoutingSnapshot {
  if (
    !isRecord(value) ||
    typeof value.enabled !== 'boolean' ||
    !Array.isArray(value.sessions) ||
    !Array.isArray(value.accounts)
  ) {
    throw new Error('Invalid routing response');
  }
  return {
    enabled: value.enabled,
    stateError: text(value.state_error),
    quotaPollIntervalSeconds: number(value.quota_poll_interval_seconds),
    shortWindowReservePercent: percentOrNull(value.short_window_reserve_percent),
    longWindowReservePercent: percentOrNull(value.long_window_reserve_percent),
    accounts: value.accounts.filter(isRecord).map(normalizeRoutingAccount),
    sessions: value.sessions.filter(isRecord).map((s) => ({
      id: text(s.id),
      sessionId: text(s.session_id),
      parentSessionId: text(s.parent_session_id),
      provider: text(s.provider),
      model: text(s.model),
      authId: text(s.auth_id),
      generation: number(s.generation),
      callerScope: text(s.caller_scope),
      createdAt: timestamp(s.created_at),
      successes: number(s.successes),
      failures: number(s.failures),
      lastSeen: timestamp(s.last_seen),
      expiresAt: timestamp(s.expires_at),
      reason: text(s.reason),
      pendingReason: text(s.pending_reason),
      pendingAuthId: text(s.pending_auth_id),
      inputTokens: number(s.input_tokens),
      cacheReadTokens: number(s.cache_read_tokens),
      cacheWriteTokens: number(s.cache_write_tokens),
      outputTokens: number(s.output_tokens),
      missingUsageSamples: number(s.missing_usage_samples),
      migrations: Array.isArray(s.migrations)
        ? s.migrations.filter(isRecord).map((m) => ({
            at: timestamp(m.at),
            from: text(m.from),
            to: text(m.to),
            reason: text(m.reason),
          }))
        : [],
    })),
  };
}

export function normalizeRoutingRefresh(value: unknown): RoutingRefreshResult {
  if (!isRecord(value) || !Array.isArray(value.accounts)) {
    throw new Error('Invalid routing refresh response');
  }
  return {
    coalescedAuthIds: Array.isArray(value.coalesced_auth_ids)
      ? value.coalesced_auth_ids.filter((id): id is string => typeof id === 'string')
      : [],
    accounts: value.accounts.filter(isRecord).map(normalizeRoutingAccount),
  };
}

export function cacheReadPercent(session: RoutingSession): number | null {
  return session.inputTokens > 0 && session.cacheReadTokens <= session.inputTokens
    ? (100 * session.cacheReadTokens) / session.inputTokens
    : null;
}

export const routingSessionsApi = {
  async list(): Promise<RoutingSnapshot> {
    return normalizeRoutingSnapshot(await apiClient.get<unknown>('/routing/sessions'));
  },
  move: (id: string, authId: string, generation: number) =>
    apiClient.post('/routing/sessions/move', {
      id,
      auth_id: authId,
      expected_generation: generation,
    }),
  drain: (authId: string, draining: boolean) =>
    apiClient.post('/routing/accounts/drain', { auth_id: authId, draining }),
  /** Polls provider usage now. Omit `authId` to poll every pollable account. */
  async refreshQuota(authId?: string): Promise<RoutingRefreshResult> {
    return normalizeRoutingRefresh(
      await apiClient.post<unknown>(
        '/routing/accounts/refresh-quota',
        authId ? { auth_id: authId } : {},
        { timeout: QUOTA_REFRESH_TIMEOUT_MS }
      )
    );
  },
};
