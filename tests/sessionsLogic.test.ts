import { describe, expect, test } from 'bun:test';
import type { RoutingAccount, RoutingSession } from '../src/services/api/routingSessions';
import {
  ACTIVE_WINDOW_MS,
  accountLoad,
  accountStatuses,
  accountsUpdatedAt,
  agoParts,
  describeReason,
  formatAgo,
  formatCountdown,
  formatPercentLeft,
  friendlyModelName,
  groupConversations,
  isQuotaStopped,
  isSubagentSession,
  moveTargets,
  parseReasons,
  parentSessionRef,
  shortSessionId,
  sortAccounts,
  stopSummary,
  windowTone,
} from '../src/features/sessions/logic';

const NOW = Date.parse('2026-10-22T12:00:00Z');
const MIN = 60_000;
const ago = (minutes: number) => new Date(NOW - minutes * MIN).toISOString();

const account = (patch: Partial<RoutingAccount> & { id: string }): RoutingAccount => ({
  label: patch.id,
  provider: 'claude',
  disabled: false,
  draining: false,
  recentSessions: 0,
  remainingPercent: null,
  observedAt: '',
  quotaStopped: false,
  quotaStopReason: '',
  quotaExhausted: false,
  windows: [],
  lastPollAt: '',
  lastPollSuccessAt: '',
  lastPollError: '',
  ...patch,
});

const session = (patch: Partial<RoutingSession> & { id: string }): RoutingSession => ({
  sessionId: patch.id,
  parentSessionId: '',
  provider: 'claude',
  model: 'claude-opus-5-5',
  authId: 'a',
  generation: 1,
  callerScope: 'scope',
  createdAt: ago(120),
  successes: 0,
  failures: 0,
  lastSeen: ago(1),
  expiresAt: new Date(NOW + 60 * MIN).toISOString(),
  reason: '',
  pendingReason: '',
  pendingAuthId: '',
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  missingUsageSamples: 0,
  migrations: [],
  ...patch,
});

describe('friendlyModelName', () => {
  test.each([
    ['claude-opus-5-5', 'Opus 5.5'],
    ['claude-sonnet-5', 'Sonnet 5'],
    ['claude-opus-4-1-20250805', 'Opus 4.1'],
    ['claude-opus-4-20250514', 'Opus 4'],
    ['claude-haiku-4-5-20251001', 'Haiku 4.5'],
    ['claude-opus-4-6-1m', 'Opus 4.6 (1M)'],
    ['claude-opus-5-5-high', 'Opus 5.5 (high)'],
    ['claude-opus-4-6-thinking', 'Opus 4.6 (thinking)'],
    ['claude-fable-5-1', 'Fable 5.1'],
    ['claude-5-fable', 'Fable 5'],
    ['claude-3-5-haiku-20241022', 'Haiku 3.5'],
    ['claude-opus-5-5[1m]', 'Opus 5.5 (1M)'],
    ['CLAUDE-SONNET-5-5', 'Sonnet 5.5'],
    ['gpt-5-3-codex', 'GPT-5.3 Codex'],
    ['gpt-5-4-mini', 'GPT-5.4 Mini'],
    ['gpt-5.1-codex-max', 'GPT-5.1 Codex Max'],
    ['gpt-6.1-sol', 'GPT-6.1 Sol'],
    ['gpt-5-codex', 'GPT-5 Codex'],
    ['gpt-5-2025-08-07', 'GPT-5'],
  ])('%s -> %s', (raw, expected) => {
    expect(friendlyModelName(raw)).toBe(expected);
  });
  test('unknown shapes are returned untouched and blank stays blank', () => {
    expect(friendlyModelName('gemini-3-flash')).toBe('gemini-3-flash');
    expect(friendlyModelName('my-custom/model')).toBe('my-custom/model');
    expect(friendlyModelName('  ')).toBe('');
  });
});

describe('session ids and subagents', () => {
  test('short ids use the subagent part so a parent and its subagents differ', () => {
    expect(shortSessionId('0123456789abcdef')).toBe('01234567');
    expect(shortSessionId('0123456789abcdef:agent:fedcba9876543210')).toBe('fedcba98');
    expect(shortSessionId('abc')).toBe('abc');
  });
  test('a subagent is recognized by parentSessionId or the :agent: marker', () => {
    expect(isSubagentSession(session({ id: 'x', parentSessionId: 'p' }))).toBe(true);
    expect(isSubagentSession(session({ id: 'x', sessionId: 'p:agent:1' }))).toBe(true);
    expect(isSubagentSession(session({ id: 'x', sessionId: 'plain' }))).toBe(false);
  });
  test('the parent reference falls back to the id prefix before :agent:', () => {
    expect(parentSessionRef(session({ id: 'x', parentSessionId: 'p' }))).toBe('p');
    expect(parentSessionRef(session({ id: 'x', sessionId: 'root:agent:1' }))).toBe('root');
    expect(parentSessionRef(session({ id: 'x', sessionId: ':agent:1' }))).toBe('');
    expect(parentSessionRef(session({ id: 'x', sessionId: 'plain' }))).toBe('');
  });
});

describe('reason humanizer', () => {
  const t = (key: string, params?: Record<string, string | number>) =>
    params ? `${key}${JSON.stringify(params)}` : key;

  test('parses window reasons and joined reasons', () => {
    expect(parseReasons('5-hour window at 3% remaining (reserve 5%)')).toEqual([
      {
        kind: 'window',
        windowLabel: '5-hour',
        percent: 3,
        reserve: 5,
        raw: '5-hour window at 3% remaining (reserve 5%)',
      },
    ]);
    expect(
      parseReasons(
        '5-hour window at 3% remaining (reserve 5%); weekly window at 1.5% remaining (reserve 2%)'
      ).map((p) => [p.kind, p.windowLabel, p.percent])
    ).toEqual([
      ['window', '5-hour', 3],
      ['window', 'weekly', 1.5],
    ]);
    expect(parseReasons('')).toEqual([]);
  });
  test('maps every backend reason to a kind and keeps unknown text', () => {
    const kinds = Object.fromEntries(
      [
        'confirmed credential quota',
        'confirmed quota exhaustion',
        'account unavailable',
        'account removed',
        'account authentication failed',
        'account disabled',
        'manual move',
        'quota and recent-session load',
        'transport session',
        'parent session',
        'something new',
      ].map((raw) => [raw, parseReasons(raw)[0].kind])
    );
    expect(kinds).toEqual({
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
      'something new': 'other',
    });
  });
  test('pending move text completes "Moving: ..."', () => {
    expect(describeReason(t, '5-hour window at 3% remaining (reserve 5%)', 'moving')).toBe(
      'sessions.moving_window{"window":"sessions.window_5h","percent":3,"reserve":5}'
    );
    expect(describeReason(t, 'weekly window at 1% remaining (reserve 2%)', 'moving')).toContain(
      'sessions.window_weekly'
    );
    expect(describeReason(t, 'confirmed quota exhaustion', 'moving')).toBe(
      'sessions.moving_exhausted'
    );
    expect(describeReason(t, 'manual move', 'moving')).toBe('sessions.moving_manual');
    expect(describeReason(t, 'brand new reason', 'moving')).toBe('brand new reason');
  });
  test('several reasons are joined and an unknown window label stays as sent', () => {
    expect(
      describeReason(
        t,
        '5-hour window at 3% remaining (reserve 5%); weekly window at 1% remaining (reserve 2%)',
        'moving'
      ).split(', ').length
    ).toBe(2);
    expect(describeReason(t, 'daily window at 3% remaining (reserve 5%)', 'stopped')).toContain(
      '"window":"daily"'
    );
  });
  test('stopped context describes the window state, other reasons fall back', () => {
    expect(describeReason(t, '5-hour window at 3% remaining (reserve 5%)', 'stopped')).toBe(
      'sessions.stopped_window{"window":"sessions.window_5h","percent":3,"reserve":5}'
    );
    expect(describeReason(t, 'confirmed credential quota', 'stopped')).toBe(
      'sessions.stopped_exhausted'
    );
    expect(describeReason(t, 'account removed', 'stopped')).toBe('sessions.moving_removed');
  });
  test('placement context separates first placement from later moves', () => {
    expect(describeReason(t, 'quota and recent-session load', 'placement')).toBe(
      'sessions.placement_load'
    );
    expect(describeReason(t, 'parent session', 'placement')).toBe('sessions.placement_parent');
    expect(describeReason(t, 'transport session', 'placement')).toBe(
      'sessions.placement_transport'
    );
    expect(describeReason(t, 'manual move', 'placement')).toBe('sessions.placement_manual');
    expect(describeReason(t, 'account unavailable', 'placement')).toBe(
      'sessions.placement_moved{"reason":"sessions.moving_unavailable"}'
    );
    expect(describeReason(t, 'unknown thing', 'placement')).toBe('unknown thing');
  });
});

describe('accounts', () => {
  test('status chips: disabled beats exhausted/reserve beats draining', () => {
    expect(accountStatuses(account({ id: 'a' }))).toEqual(['active']);
    expect(accountStatuses(account({ id: 'a', draining: true }))).toEqual(['draining']);
    // Inside the reserve only: still serves its own conversations when no other account has room.
    expect(accountStatuses(account({ id: 'a', quotaStopped: true }))).toEqual(['reserve']);
    expect(accountStatuses(account({ id: 'a', quotaStopped: true, draining: true }))).toEqual([
      'reserve',
      'draining',
    ]);
    // The provider limit itself: exhausted wins over the reserve wording.
    expect(
      accountStatuses(account({ id: 'a', quotaStopped: true, quotaExhausted: true }))
    ).toEqual(['exhausted']);
    expect(
      accountStatuses(
        account({ id: 'a', quotaStopped: true, quotaExhausted: true, draining: true })
      )
    ).toEqual(['exhausted', 'draining']);
    // Exhausted without the stopped flag (a snapshot that only sets one of them) is still a stop.
    expect(accountStatuses(account({ id: 'a', quotaExhausted: true }))).toEqual(['exhausted']);
    expect(
      accountStatuses(account({ id: 'a', disabled: true, quotaStopped: true, draining: true }))
    ).toEqual(['disabled']);
    expect(isQuotaStopped(account({ id: 'a' }))).toBe(false);
    expect(isQuotaStopped(account({ id: 'a', quotaExhausted: true }))).toBe(true);
  });
  describe('stop summary', () => {
    const t = (key: string, params?: Record<string, string | number>) =>
      params ? `${key}${JSON.stringify(params)}` : key;
    const reasons =
      '5-hour window at 2% remaining (reserve 5%); weekly window at 0% remaining (reserve 2%)';

    test('a reserve stop lists every window inside its reserve', () => {
      const parts = stopSummary(
        t,
        account({ id: 'a', quotaStopped: true, quotaStopReason: reasons })
      ).split(', sessions.');
      expect(parts).toHaveLength(2);
      expect(parts[0]).toContain('"window":"sessions.window_5h","percent":2');
      expect(parts[1]).toContain('"window":"sessions.window_weekly","percent":0');
    });
    test('an exhausted account names only what exhausted it', () => {
      expect(
        stopSummary(
          t,
          account({ id: 'a', quotaStopped: true, quotaExhausted: true, quotaStopReason: reasons })
        )
      ).toBe('sessions.stopped_window{"window":"sessions.window_weekly","percent":0,"reserve":2}');
      expect(
        stopSummary(
          t,
          account({
            id: 'a',
            quotaStopped: true,
            quotaExhausted: true,
            quotaStopReason: 'confirmed credential quota',
          })
        )
      ).toBe('sessions.stopped_exhausted');
    });
    test('falls back to every part when none is recognizably exhausted, and to "" without a reason', () => {
      expect(
        stopSummary(
          t,
          account({
            id: 'a',
            quotaStopped: true,
            quotaExhausted: true,
            quotaStopReason: '5-hour window at 3% remaining (reserve 5%)',
          })
        )
      ).toContain('sessions.stopped_window');
      expect(stopSummary(t, account({ id: 'a', quotaStopped: true }))).toBe('');
    });
  });
  test('quota tone: unknown is neutral, red only when used up, amber in the reserve or low', () => {
    expect(windowTone(null, 5)).toBe('idle');
    expect(windowTone(0, 5)).toBe('critical');
    expect(windowTone(0, null)).toBe('critical');
    expect(windowTone(0.1, 5)).toBe('warning');
    expect(windowTone(5, 5)).toBe('warning');
    expect(windowTone(4.9, 5)).toBe('warning');
    expect(windowTone(5.1, 5)).toBe('warning');
    expect(windowTone(29.9, 2)).toBe('warning');
    expect(windowTone(30, 2)).toBe('good');
    expect(windowTone(61, 2)).toBe('good');
  });
  test('percent left keeps a decimal only below 10%', () => {
    expect(formatPercentLeft(61)).toBe('61%');
    expect(formatPercentLeft(61.6)).toBe('62%');
    expect(formatPercentLeft(3)).toBe('3%');
    expect(formatPercentLeft(3.26)).toBe('3.3%');
    expect(formatPercentLeft(0)).toBe('0%');
  });
  test('accounts with quota windows sort first, disabled ones last, then by provider and label', () => {
    const w = [
      {
        kind: 'short' as const,
        label: '5-hour',
        remainingPercent: 1,
        resetAt: '',
        reservePercent: 5,
        stopped: false,
      },
    ];
    expect(
      sortAccounts([
        account({ id: '1', provider: 'gemini', label: 'g' }),
        account({ id: '2', provider: 'codex', label: 'zed', windows: w }),
        account({ id: '3', provider: 'claude', label: 'bob', windows: w }),
        account({ id: '4', provider: 'claude', label: 'amy', windows: w }),
        account({ id: '5', provider: 'claude', label: '', windows: w }),
        account({ id: '6', provider: 'claude', label: 'aaa', windows: w, disabled: true }),
      ]).map((a) => a.id)
    ).toEqual(['5', '4', '3', '2', '1', '6']);
  });
  test('the freshest of polls and passive observations is the update time', () => {
    expect(accountsUpdatedAt([])).toBeNull();
    expect(accountsUpdatedAt([account({ id: 'a' })])).toBeNull();
    expect(
      accountsUpdatedAt([
        account({ id: 'a', lastPollSuccessAt: ago(10) }),
        account({ id: 'b', observedAt: ago(2), lastPollSuccessAt: ago(30) }),
        account({ id: 'c', lastPollAt: ago(0), lastPollError: 'HTTP 401' }),
      ])
    ).toBe(NOW - 2 * MIN);
  });
});

describe('time formatting', () => {
  test('countdown picks the two most useful units', () => {
    expect(formatCountdown(2 * 3_600_000 + 14 * MIN + 59_000)).toBe('2h 14m');
    expect(formatCountdown(3_600_000)).toBe('1h');
    expect(formatCountdown(59 * MIN + 59_999)).toBe('59m');
    expect(formatCountdown(MIN)).toBe('1m');
    expect(formatCountdown(59_999)).toBe('<1m');
    expect(formatCountdown(-5)).toBe('<1m');
    expect(formatCountdown(3 * 86_400_000 + 4 * 3_600_000 + MIN)).toBe('3d 4h');
    expect(formatCountdown(2 * 86_400_000)).toBe('2d');
    expect(formatCountdown(Number.NaN)).toBe('<1m');
  });
  test('ago picks seconds, minutes, hours, days; future and tiny gaps read as now', () => {
    expect(agoParts(NOW - 40_000, NOW)).toEqual({ value: -40, unit: 'second' });
    expect(agoParts(NOW - 2_000, NOW)).toEqual({ value: 0, unit: 'second' });
    expect(agoParts(NOW + 90_000, NOW)).toEqual({ value: 0, unit: 'second' });
    expect(agoParts(NOW - 59_000, NOW)).toEqual({ value: -59, unit: 'second' });
    expect(agoParts(NOW - 59_999, NOW)).toEqual({ value: -59, unit: 'second' });
    expect(agoParts(NOW - 3 * MIN - 30_000, NOW)).toEqual({ value: -3, unit: 'minute' });
    expect(agoParts(NOW - 90 * MIN, NOW)).toEqual({ value: -1, unit: 'hour' });
    expect(agoParts(NOW - 50 * 3_600_000, NOW)).toEqual({ value: -2, unit: 'day' });
    expect(formatAgo(NOW - 3 * MIN, NOW, 'en')).toBe('3 min. ago');
    expect(formatAgo(NOW, NOW, 'en')).toBe('now');
  });
});

describe('conversation grouping', () => {
  const accounts = [account({ id: 'a' }), account({ id: 'b' }), account({ id: 'c' })];

  test('groups by account in account order and sorts conversations by activity', () => {
    const groups = groupConversations(
      {
        accounts,
        sessions: [
          session({ id: 's1', authId: 'b', lastSeen: ago(5) }),
          session({ id: 's2', authId: 'a', lastSeen: ago(10) }),
          session({ id: 's3', authId: 'a', lastSeen: ago(2) }),
        ],
      },
      { nowMs: NOW, showIdle: false }
    );
    expect(groups.map((g) => g.accountId)).toEqual(['a', 'b']);
    expect(groups[0].roots.map((n) => n.session.id)).toEqual(['s3', 's2']);
    expect(groups[0].account?.id).toBe('a');
  });

  test('nests subagents under their parent and shows the parent as live through a live child', () => {
    const groups = groupConversations(
      {
        accounts,
        sessions: [
          session({ id: 'root', sessionId: 'root', lastSeen: ago(90) }),
          session({
            id: 'kid1',
            sessionId: 'root:agent:1',
            parentSessionId: 'root',
            lastSeen: ago(3),
          }),
          // No parentSessionId: the id marker alone still nests it.
          session({ id: 'kid2', sessionId: 'root:agent:2', lastSeen: ago(40) }),
        ],
      },
      { nowMs: NOW, showIdle: true }
    );
    expect(groups).toHaveLength(1);
    const [root] = groups[0].roots;
    expect(root.session.id).toBe('root');
    expect(root.children.map((c) => c.session.id)).toEqual(['kid1', 'kid2']);
    expect(root.live).toBe(true);
    expect(root.activityMs).toBe(NOW - 3 * MIN);
    expect(root.children.map((c) => c.live)).toEqual([true, false]);
  });

  test('without idle, idle subagents drop out and an idle root with a live child stays', () => {
    const sessions = [
      session({ id: 'root', sessionId: 'root', lastSeen: ago(90) }),
      session({ id: 'live', sessionId: 'root:agent:1', parentSessionId: 'root', lastSeen: ago(3) }),
      session({ id: 'old', sessionId: 'root:agent:2', parentSessionId: 'root', lastSeen: ago(60) }),
    ];
    const [group] = groupConversations({ accounts, sessions }, { nowMs: NOW, showIdle: false });
    expect(group.roots[0].children.map((c) => c.session.id)).toEqual(['live']);
    expect(
      groupConversations(
        { accounts, sessions: [sessions[0], sessions[2]] },
        { nowMs: NOW, showIdle: false }
      )
    ).toEqual([]);
  });

  test('the idle boundary is inclusive at exactly the active window', () => {
    const edge = [
      session({ id: 'edge', lastSeen: new Date(NOW - ACTIVE_WINDOW_MS).toISOString() }),
    ];
    const past = [
      session({ id: 'past', lastSeen: new Date(NOW - ACTIVE_WINDOW_MS - 1).toISOString() }),
    ];
    expect(
      groupConversations({ accounts, sessions: edge }, { nowMs: NOW, showIdle: false })
    ).toHaveLength(1);
    expect(
      groupConversations({ accounts, sessions: past }, { nowMs: NOW, showIdle: false })
    ).toHaveLength(0);
    expect(
      groupConversations({ accounts, sessions: past }, { nowMs: NOW, showIdle: true })
    ).toHaveLength(1);
  });

  test('a subagent whose parent is on another account stays a standalone row', () => {
    const groups = groupConversations(
      {
        accounts,
        sessions: [
          session({ id: 'root', sessionId: 'root', authId: 'a' }),
          session({ id: 'kid', sessionId: 'root:agent:1', parentSessionId: 'root', authId: 'b' }),
        ],
      },
      { nowMs: NOW, showIdle: true }
    );
    expect(groups.map((g) => [g.accountId, g.roots.map((n) => n.session.id)])).toEqual([
      ['a', ['root']],
      ['b', ['kid']],
    ]);
  });

  test('expired bindings are dropped; unknown accounts are listed last', () => {
    const groups = groupConversations(
      {
        accounts,
        sessions: [
          session({ id: 'gone', authId: 'a', expiresAt: new Date(NOW).toISOString() }),
          session({ id: 'orphan', authId: 'removed-account' }),
          session({ id: 'ok', authId: 'c' }),
          session({ id: 'noexpiry', authId: 'c', expiresAt: '' }),
        ],
      },
      { nowMs: NOW, showIdle: true }
    );
    expect(groups.map((g) => g.accountId)).toEqual(['c', 'removed-account']);
    expect(groups[1].account).toBeNull();
    expect(groups[0].roots).toHaveLength(2);
  });

  test('a parent loop does not make conversations disappear', () => {
    const groups = groupConversations(
      {
        accounts,
        sessions: [
          session({ id: 'x', sessionId: 'x', parentSessionId: 'y' }),
          session({ id: 'y', sessionId: 'y', parentSessionId: 'x' }),
        ],
      },
      { nowMs: NOW, showIdle: true }
    );
    const ids = (nodes: (typeof groups)[number]['roots']): string[] =>
      nodes.flatMap((n) => [n.session.id, ...ids(n.children)]);
    expect(ids(groups[0].roots).sort()).toEqual(['x', 'y']);
  });

  test('prefers the parent with the same caller scope, then the most recent', () => {
    const [group] = groupConversations(
      {
        accounts,
        sessions: [
          session({ id: 'p-other', sessionId: 'p', callerScope: 'other', lastSeen: ago(1) }),
          session({ id: 'p-mine', sessionId: 'p', callerScope: 'mine', lastSeen: ago(20) }),
          session({ id: 'kid', sessionId: 'p:agent:1', parentSessionId: 'p', callerScope: 'mine' }),
        ],
      },
      { nowMs: NOW, showIdle: true }
    );
    expect(group.roots.find((n) => n.session.id === 'p-mine')?.children).toHaveLength(1);
    expect(group.roots.find((n) => n.session.id === 'p-other')?.children).toHaveLength(0);
  });

  test('missing activity timestamps count as idle, not as just now', () => {
    const groups = groupConversations(
      { accounts, sessions: [session({ id: 'blank', lastSeen: '', createdAt: '' })] },
      { nowMs: NOW, showIdle: false }
    );
    expect(groups).toEqual([]);
  });

  test('load counts top-level live and idle conversations regardless of the filter', () => {
    const load = accountLoad(
      {
        accounts,
        sessions: [
          session({ id: 'r1', sessionId: 'r1', authId: 'a', lastSeen: ago(5) }),
          session({ id: 'k1', sessionId: 'r1:agent:1', authId: 'a', lastSeen: ago(5) }),
          session({ id: 'r2', sessionId: 'r2', authId: 'a', lastSeen: ago(120) }),
          session({ id: 'r3', sessionId: 'r3', authId: 'b', lastSeen: ago(120) }),
        ],
      },
      NOW
    );
    expect(load.get('a')).toEqual({ live: 1, idle: 1 });
    expect(load.get('b')).toEqual({ live: 0, idle: 1 });
    expect(load.has('c')).toBe(false);
  });
});

describe('move targets', () => {
  test('only same-provider, running, non-draining accounts outside their reserve', () => {
    const targets = moveTargets(session({ id: 's', authId: 'a', provider: 'claude' }), [
      account({ id: 'a' }),
      account({ id: 'ok' }),
      account({ id: 'drain', draining: true }),
      account({ id: 'reserve', quotaStopped: true }),
      account({ id: 'exhausted', quotaStopped: true, quotaExhausted: true }),
      account({ id: 'exhausted-only', quotaExhausted: true }),
      account({ id: 'off', disabled: true }),
      account({ id: 'other', provider: 'codex' }),
    ]);
    expect(targets.map((a) => a.id)).toEqual(['ok']);
  });
});
