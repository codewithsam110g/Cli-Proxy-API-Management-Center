import { apiClient } from './client';
import { isRecord } from '@/utils/helpers';

export interface RoutingAccount {
  id: string;
  label: string;
  provider: string;
  disabled: boolean;
  draining: boolean;
  recentSessions: number;
  remainingPercent: number | null;
  observedAt: string;
  quotaStopped: boolean;
  quotaStopReason: string;
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
  sessions: RoutingSession[];
  accounts: RoutingAccount[];
}
const text = (value: unknown) => (typeof value === 'string' ? value : '');
const number = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

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
    accounts: value.accounts.filter(isRecord).map((a) => ({
      id: text(a.id),
      label: text(a.label),
      provider: text(a.provider),
      disabled: a.disabled === true,
      draining: a.draining === true,
      recentSessions: number(a.recent_sessions),
      remainingPercent:
        typeof a.remaining_percent === 'number' &&
        Number.isFinite(a.remaining_percent) &&
        a.remaining_percent >= 0 &&
        a.remaining_percent <= 100
          ? a.remaining_percent
          : null,
      observedAt: text(a.observed_at),
      quotaStopped: a.quota_stopped === true,
      quotaStopReason: text(a.quota_stop_reason),
    })),
    sessions: value.sessions.filter(isRecord).map((s) => ({
      id: text(s.id),
      sessionId: text(s.session_id),
      parentSessionId: text(s.parent_session_id),
      provider: text(s.provider),
      model: text(s.model),
      authId: text(s.auth_id),
      generation: number(s.generation),
      callerScope: text(s.caller_scope),
      createdAt: text(s.created_at),
      successes: number(s.successes),
      failures: number(s.failures),
      lastSeen: text(s.last_seen),
      expiresAt: text(s.expires_at),
      reason: text(s.reason),
      pendingReason: text(s.pending_reason),
      inputTokens: number(s.input_tokens),
      cacheReadTokens: number(s.cache_read_tokens),
      cacheWriteTokens: number(s.cache_write_tokens),
      outputTokens: number(s.output_tokens),
      missingUsageSamples: number(s.missing_usage_samples),
      migrations: Array.isArray(s.migrations)
        ? s.migrations.filter(isRecord).map((m) => ({
            at: text(m.at),
            from: text(m.from),
            to: text(m.to),
            reason: text(m.reason),
          }))
        : [],
    })),
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
};
