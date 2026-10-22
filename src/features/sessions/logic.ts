/**
 * Pure logic behind the accounts table and the conversation list that the
 * Dashboard and the Sessions page share. React-free and clock-free (`nowMs` is
 * always passed in) so every rule is directly testable.
 */

import type {
  RoutingAccount,
  RoutingSession,
  RoutingSnapshot,
} from '@/services/api/routingSessions';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '@/utils/time/durations';

/** A conversation counts as live when it was active within this window. */
export const ACTIVE_WINDOW_MS = 30 * MINUTE_MS;
/** A parent with more subagents than this starts collapsed. */
export const SUBAGENT_COLLAPSE_THRESHOLD = 3;
/** Quota bars turn amber below this share remaining (red at or below the reserve). */
export const LOW_QUOTA_PERCENT = 30;

const AGENT_MARKER = ':agent:';

export const parseMs = (value: string): number | null => {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
};

/* ------------------------------------------------------------------ */
/* Names and ids                                                       */
/* ------------------------------------------------------------------ */

const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
const joinVersion = (major: string, minor?: string) => (minor ? `${major}.${minor}` : major);
const withQualifier = (name: string, qualifier: string) => {
  if (!qualifier) return name;
  return `${name} (${qualifier === '1m' ? '1M' : qualifier})`;
};
const DATE_SUFFIX = /(?:-\d{8}|-\d{4}-\d{2}-\d{2})$/;

/**
 * "claude-opus-5-5" -> "Opus 5.5", "gpt-5-3-codex" -> "GPT-5.3 Codex".
 * Unknown shapes come back unchanged rather than being guessed at.
 */
export function friendlyModelName(model: string): string {
  const raw = model.trim();
  if (!raw) return '';
  let id = raw.toLowerCase();
  let qualifier = '';
  const bracket = /\[([a-z0-9]+)\]$/.exec(id);
  if (bracket) {
    qualifier = bracket[1];
    id = id.slice(0, bracket.index);
  }

  // claude-opus-4-1-20250805, claude-opus-5-5-high, claude-sonnet-4-6-1m, claude-fable-5-1
  const family =
    /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:-(1m|high|thinking))?$/.exec(
      id
    );
  if (family) {
    return withQualifier(
      `${capitalize(family[1])} ${joinVersion(family[2], family[3])}`,
      qualifier || family[4] || ''
    );
  }
  // Older order: claude-3-5-haiku-20241022, claude-5-fable
  const legacy = /^claude-(\d+)(?:-(\d{1,2}))?-(opus|sonnet|haiku|fable)(?:-\d{8})?$/.exec(id);
  if (legacy) {
    return withQualifier(
      `${capitalize(legacy[3])} ${joinVersion(legacy[1], legacy[2])}`,
      qualifier
    );
  }

  // gpt-5-3-codex, gpt-5.1-codex-max, gpt-6.1-sol
  const gpt = /^gpt-(\d+)(?:[.-](\d{1,2}))?((?:-[a-z][a-z0-9]*)*)$/.exec(
    id.replace(DATE_SUFFIX, '')
  );
  if (gpt) {
    const rest = gpt[3].split('-').filter(Boolean).map(capitalize).join(' ');
    return withQualifier(`GPT-${joinVersion(gpt[1], gpt[2])}${rest ? ` ${rest}` : ''}`, qualifier);
  }
  return raw;
}

/** Session ids of subagents read "<parent>:agent:<id>"; their own part is what tells rows apart. */
export function shortSessionId(sessionId: string): string {
  const at = sessionId.lastIndexOf(AGENT_MARKER);
  const own = at >= 0 ? sessionId.slice(at + AGENT_MARKER.length) : sessionId;
  return (own || sessionId).slice(0, 8);
}

/** The parent session id a conversation points at, or '' for a top-level conversation. */
export function parentSessionRef(session: RoutingSession): string {
  if (session.parentSessionId) return session.parentSessionId;
  const at = session.sessionId.indexOf(AGENT_MARKER);
  return at > 0 ? session.sessionId.slice(0, at) : '';
}

export const isSubagentSession = (session: RoutingSession): boolean =>
  Boolean(session.parentSessionId) || session.sessionId.includes(AGENT_MARKER);

/* ------------------------------------------------------------------ */
/* Reasons                                                             */
/* ------------------------------------------------------------------ */

export type ReasonKind =
  | 'window'
  | 'exhausted'
  | 'unavailable'
  | 'removed'
  | 'auth_failed'
  | 'disabled'
  | 'manual'
  | 'load'
  | 'transport'
  | 'parent'
  | 'other';

export interface ReasonPart {
  kind: ReasonKind;
  /** Backend wording of the window ("5-hour"); only for kind "window". */
  windowLabel?: string;
  percent?: number;
  reserve?: number;
  /** The untouched backend text of this part. */
  raw: string;
}

const WINDOW_REASON = /^(.+?) window at (\d+(?:\.\d+)?)% remaining \(reserve (\d+(?:\.\d+)?)%\)$/;
const SIMPLE_REASONS: Record<string, ReasonKind> = {
  'confirmed credential quota': 'exhausted',
  'confirmed quota exhaustion': 'exhausted',
  'account unavailable': 'unavailable',
  'account removed': 'removed',
  'account authentication failed': 'auth_failed',
  'account disabled': 'disabled',
  'manual move': 'manual',
  'quota and recent-session load': 'load',
  'transport session': 'transport',
  'parent session': 'parent',
};

/** Parses a backend reason ("a; b" joins several) into typed parts. */
export function parseReasons(value: string): ReasonPart[] {
  return value
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((raw): ReasonPart => {
      const window = WINDOW_REASON.exec(raw);
      if (window) {
        return {
          kind: 'window',
          windowLabel: window[1],
          percent: Number(window[2]),
          reserve: Number(window[3]),
          raw,
        };
      }
      return { kind: SIMPLE_REASONS[raw.toLowerCase()] ?? 'other', raw };
    });
}

type Translate = (key: string, params?: Record<string, string | number>) => string;
export type ReasonContext = 'moving' | 'stopped' | 'placement';

export function windowLabelText(t: Translate, label: string): string {
  const key = {
    '5-hour': 'sessions.window_5h',
    weekly: 'sessions.window_weekly',
    monthly: 'sessions.window_monthly',
  }[label];
  return key ? t(key) : label;
}

/**
 * Plain-language text for a backend reason. `moving` completes "Moving: …",
 * `stopped` completes "In reserve – …" / "Exhausted – …", `placement` stands alone.
 */
export function describeReason(t: Translate, value: string, context: ReasonContext): string {
  return parseReasons(value)
    .map((part) => describePart(t, part, context))
    .join(', ');
}

function describePart(t: Translate, part: ReasonPart, context: ReasonContext): string {
  const window = part.windowLabel ? windowLabelText(t, part.windowLabel) : '';
  const params = { window, percent: part.percent ?? 0, reserve: part.reserve ?? 0 };
  if (context === 'stopped') {
    if (part.kind === 'window') return t('sessions.stopped_window', params);
    if (part.kind === 'exhausted') return t('sessions.stopped_exhausted');
  }
  if (context === 'placement') {
    if (part.kind === 'load') return t('sessions.placement_load');
    if (part.kind === 'transport') return t('sessions.placement_transport');
    if (part.kind === 'parent') return t('sessions.placement_parent');
    if (part.kind === 'manual') return t('sessions.placement_manual');
    if (part.kind === 'other') return part.raw;
    return t('sessions.placement_moved', { reason: describePart(t, part, 'moving') });
  }
  switch (part.kind) {
    case 'window':
      return t('sessions.moving_window', params);
    case 'exhausted':
      return t('sessions.moving_exhausted');
    case 'unavailable':
      return t('sessions.moving_unavailable');
    case 'removed':
      return t('sessions.moving_removed');
    case 'auth_failed':
      return t('sessions.moving_auth_failed');
    case 'disabled':
      return t('sessions.moving_disabled');
    case 'manual':
      return t('sessions.moving_manual');
    default:
      return part.raw;
  }
}

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */

/**
 * `reserve` = inside the reserve (takes no new conversations, keeps its own unless another
 * account has room); `exhausted` = the provider limit itself is reached (conversations must leave).
 */
export type AccountStatus = 'active' | 'draining' | 'reserve' | 'exhausted' | 'disabled';

/** True when the account takes no new conversations because of quota (reserve or exhausted). */
export const isQuotaStopped = (account: RoutingAccount): boolean =>
  account.quotaStopped || account.quotaExhausted;

/** Status chips for an account, most important first. */
export function accountStatuses(account: RoutingAccount): AccountStatus[] {
  if (account.disabled) return ['disabled'];
  if (isQuotaStopped(account)) {
    const quota: AccountStatus = account.quotaExhausted ? 'exhausted' : 'reserve';
    return account.draining ? [quota, 'draining'] : [quota];
  }
  return [account.draining ? 'draining' : 'active'];
}

/** A stop part that the provider itself enforces: a window at 0% or a confirmed quota error. */
const isExhaustingPart = (part: ReasonPart): boolean =>
  part.kind === 'exhausted' || (part.kind === 'window' && (part.percent ?? 1) <= 0);

/**
 * Why an account is held back, in plain words ("5-hour window at 3%"). An exhausted account
 * names only what exhausted it, since the reserve parts beside it are no longer the point.
 */
export function stopSummary(t: Translate, account: RoutingAccount): string {
  const parts = parseReasons(account.quotaStopReason);
  const exhausting = account.quotaExhausted ? parts.filter(isExhaustingPart) : [];
  return (exhausting.length ? exhausting : parts)
    .map((part) => describePart(t, part, 'stopped'))
    .join(', ');
}

/**
 * Accounts with quota windows first, disabled ones last, otherwise by provider and label, so
 * rows keep their place between refreshes.
 */
export function sortAccounts(accounts: readonly RoutingAccount[]): RoutingAccount[] {
  const rank = (a: RoutingAccount) => (a.disabled ? 2 : a.windows.length > 0 ? 0 : 1);
  return [...accounts].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.provider.localeCompare(b.provider) ||
      (a.label || a.id).localeCompare(b.label || b.id)
  );
}

export type QuotaTone = 'good' | 'warning' | 'critical' | 'idle';

/** Red only when the window is used up; inside the reserve is amber, like "getting low". */
export function windowTone(remaining: number | null, reserve: number | null): QuotaTone {
  if (remaining === null) return 'idle';
  if (remaining <= 0) return 'critical';
  if (reserve !== null && remaining <= reserve) return 'warning';
  return remaining < LOW_QUOTA_PERCENT ? 'warning' : 'good';
}

/** "61% left"; fractions are kept only below 10% where one point matters. */
export function formatPercentLeft(remaining: number): string {
  return `${remaining < 10 ? Number(remaining.toFixed(1)) : Math.round(remaining)}%`;
}

/** The newest quota information of any account (poll or passive observation), or null. */
export function accountsUpdatedAt(accounts: readonly RoutingAccount[]): number | null {
  let newest: number | null = null;
  for (const account of accounts) {
    for (const value of [account.lastPollSuccessAt, account.observedAt]) {
      const ms = parseMs(value);
      if (ms !== null && (newest === null || ms > newest)) newest = ms;
    }
  }
  return newest;
}

/* ------------------------------------------------------------------ */
/* Time                                                                */
/* ------------------------------------------------------------------ */

/** "2h 14m", "3d 4h", "<1m". Units stay Latin letters in every language. */
export function formatCountdown(ms: number): string {
  if (!Number.isFinite(ms) || ms < MINUTE_MS) return '<1m';
  if (ms >= DAY_MS) {
    const days = Math.floor(ms / DAY_MS);
    const hours = Math.floor((ms % DAY_MS) / HOUR_MS);
    return hours ? `${days}d ${hours}h` : `${days}d`;
  }
  if (ms >= HOUR_MS) {
    const hours = Math.floor(ms / HOUR_MS);
    const minutes = Math.floor((ms % HOUR_MS) / MINUTE_MS);
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${Math.floor(ms / MINUTE_MS)}m`;
}

export interface AgoParts {
  value: number;
  unit: 'second' | 'minute' | 'hour' | 'day';
}

/** Signed (negative = past) magnitude for "3 min ago"; future times clamp to now. */
export function agoParts(thenMs: number, nowMs: number): AgoParts {
  const delta = Math.max(0, nowMs - thenMs);
  if (delta >= DAY_MS) return { value: -Math.floor(delta / DAY_MS), unit: 'day' };
  if (delta >= HOUR_MS) return { value: -Math.floor(delta / HOUR_MS), unit: 'hour' };
  if (delta >= MINUTE_MS) return { value: -Math.floor(delta / MINUTE_MS), unit: 'minute' };
  const seconds = Math.floor(delta / 1000);
  return { value: seconds < 5 ? 0 : -seconds, unit: 'second' };
}

const agoFormatters = new Map<string, Intl.RelativeTimeFormat>();

/** Localized "3 min. ago" / "now". */
export function formatAgo(thenMs: number, nowMs: number, locale?: string): string {
  const key = locale ?? '';
  let formatter = agoFormatters.get(key);
  if (!formatter) {
    try {
      formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
    } catch {
      formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' });
    }
    agoFormatters.set(key, formatter);
  }
  const { value, unit } = agoParts(thenMs, nowMs);
  return formatter.format(value, unit);
}

/* ------------------------------------------------------------------ */
/* Conversations                                                       */
/* ------------------------------------------------------------------ */

export interface ConversationNode {
  session: RoutingSession;
  /** Subagents, newest first. */
  children: ConversationNode[];
  /** Latest activity of the conversation or any of its subagents (ms, 0 = unknown). */
  activityMs: number;
  live: boolean;
}

export interface ConversationGroup {
  accountId: string;
  /** null when the pinned account is no longer listed. */
  account: RoutingAccount | null;
  roots: ConversationNode[];
}

export interface AccountLoad {
  live: number;
  idle: number;
}

export interface GroupOptions {
  nowMs: number;
  /** Include conversations idle for longer than `activeWindowMs`. */
  showIdle: boolean;
  activeWindowMs?: number;
}

export const sessionActivityMs = (session: RoutingSession): number =>
  parseMs(session.lastSeen) ?? parseMs(session.createdAt) ?? 0;

const byActivityDesc = (a: ConversationNode, b: ConversationNode) => b.activityMs - a.activityMs;

function buildTree(
  sessions: RoutingSession[],
  nowMs: number,
  activeWindowMs: number
): ConversationNode[] {
  const nodes = sessions.map<ConversationNode>((session) => {
    const activityMs = sessionActivityMs(session);
    return { session, children: [], activityMs, live: nowMs - activityMs <= activeWindowMs };
  });

  // The parent is another conversation of the same account carrying the referenced session id.
  const parentOf = new Map<ConversationNode, ConversationNode>();
  for (const node of nodes) {
    const ref = parentSessionRef(node.session);
    if (!ref) continue;
    const candidates = nodes.filter((n) => n !== node && n.session.sessionId === ref);
    candidates.sort(
      (a, b) =>
        Number(b.session.callerScope === node.session.callerScope) -
          Number(a.session.callerScope === node.session.callerScope) ||
        sessionActivityMs(b.session) - sessionActivityMs(a.session)
    );
    if (candidates[0]) parentOf.set(node, candidates[0]);
  }
  // Two conversations pointing at each other would vanish from the list: break the loop.
  for (const node of nodes) {
    const seen = new Set<ConversationNode>([node]);
    for (let up = parentOf.get(node); up; up = parentOf.get(up)) {
      if (seen.has(up)) {
        parentOf.delete(node);
        break;
      }
      seen.add(up);
    }
  }
  for (const [child, parent] of parentOf) parent.children.push(child);
  const roots = nodes.filter((node) => !parentOf.has(node));

  const settle = (node: ConversationNode): number => {
    node.children.sort(byActivityDesc);
    for (const child of node.children) node.activityMs = Math.max(node.activityMs, settle(child));
    node.live = nowMs - node.activityMs <= activeWindowMs;
    return node.activityMs;
  };
  roots.forEach(settle);
  return roots;
}

function prune(node: ConversationNode): ConversationNode | null {
  if (!node.live) return null;
  return {
    ...node,
    children: node.children.map(prune).filter((child): child is ConversationNode => child !== null),
  };
}

/**
 * Accounts -> conversations -> subagents. Expired bindings are dropped; idle
 * ones (older than the active window) only appear with `showIdle`. Groups
 * follow the order of `accounts`, unknown accounts last; empty groups are omitted.
 */
export function groupConversations(
  snapshot: Pick<RoutingSnapshot, 'accounts' | 'sessions'>,
  { nowMs, showIdle, activeWindowMs = ACTIVE_WINDOW_MS }: GroupOptions
): ConversationGroup[] {
  const byAccount = new Map<string, RoutingSession[]>();
  for (const session of snapshot.sessions) {
    const expiresAt = parseMs(session.expiresAt);
    if (expiresAt !== null && expiresAt <= nowMs) continue;
    const list = byAccount.get(session.authId);
    if (list) list.push(session);
    else byAccount.set(session.authId, [session]);
  }

  const known = new Set(snapshot.accounts.map((a) => a.id));
  const order: Array<[string, RoutingAccount | null]> = [
    ...snapshot.accounts.map((a): [string, RoutingAccount | null] => [a.id, a]),
    ...[...byAccount.keys()].filter((id) => !known.has(id)).map((id): [string, null] => [id, null]),
  ];

  const groups: ConversationGroup[] = [];
  for (const [accountId, account] of order) {
    const sessions = byAccount.get(accountId);
    if (!sessions) continue;
    const trees = buildTree(sessions, nowMs, activeWindowMs);
    const roots = (
      showIdle ? trees : trees.map(prune).filter((n): n is ConversationNode => n !== null)
    ).sort(byActivityDesc);
    if (roots.length) groups.push({ accountId, account, roots });
  }
  return groups;
}

/** Live and idle top-level conversations per account, independent of any filter. */
export function accountLoad(
  snapshot: Pick<RoutingSnapshot, 'accounts' | 'sessions'>,
  nowMs: number,
  activeWindowMs = ACTIVE_WINDOW_MS
): Map<string, AccountLoad> {
  const load = new Map<string, AccountLoad>();
  for (const group of groupConversations(snapshot, { nowMs, showIdle: true, activeWindowMs })) {
    load.set(group.accountId, {
      live: group.roots.filter((n) => n.live).length,
      idle: group.roots.filter((n) => !n.live).length,
    });
  }
  return load;
}

/** Accounts a conversation can be moved to: same provider, running, not draining, not stopped. */
export function moveTargets(
  session: RoutingSession,
  accounts: readonly RoutingAccount[]
): RoutingAccount[] {
  return accounts.filter(
    (a) =>
      a.id !== session.authId &&
      a.provider === session.provider &&
      !a.disabled &&
      !isQuotaStopped(a) &&
      !a.draining
  );
}
