import { describe, expect, test } from 'bun:test';
import {
  cacheReadPercent,
  normalizeRoutingRefresh,
  normalizeRoutingSnapshot,
} from '../src/services/api/routingSessions';

describe('session routing observations', () => {
  test('unknown and invalid quota are not presented as unused capacity', () => {
    const result = normalizeRoutingSnapshot({
      enabled: true,
      sessions: [],
      accounts: [
        { id: 'missing' },
        { id: 'null', remaining_percent: null },
        { id: 'invalid', remaining_percent: 200 },
        { id: 'empty', remaining_percent: 0 },
      ],
    });
    expect(result.accounts.map((a) => a.remainingPercent)).toEqual([null, null, null, 0]);
  });
  test('cache ratio weights input tokens and excludes cache writes', () => {
    const row = normalizeRoutingSnapshot({
      enabled: true,
      accounts: [],
      sessions: [
        { id: 'one', input_tokens: 1000, cache_read_tokens: 600, cache_write_tokens: 300 },
      ],
    }).sessions[0];
    expect(cacheReadPercent(row)).toBe(60);
    expect(cacheReadPercent({ ...row, inputTokens: 0 })).toBeNull();
    expect(cacheReadPercent({ ...row, cacheReadTokens: 1001 })).toBeNull();
  });
  test('requires the matching backend contract', () => {
    expect(() => normalizeRoutingSnapshot({ sessions: [] })).toThrow();
    expect(normalizeRoutingSnapshot({ enabled: false, sessions: [], accounts: [] }).enabled).toBe(
      false
    );
  });
  test('reads quota windows, poll fields and the reserve settings', () => {
    const result = normalizeRoutingSnapshot({
      enabled: true,
      quota_poll_interval_seconds: 300,
      short_window_reserve_percent: 5,
      long_window_reserve_percent: 2.5,
      sessions: [],
      accounts: [
        {
          id: 'codex-a',
          provider: 'codex',
          observed_at: '2026-10-22T08:15:03.412Z',
          quota_stopped: true,
          quota_exhausted: false,
          quota_stop_reason: '5-hour window at 3% remaining (reserve 5%)',
          windows: [
            {
              kind: 'short',
              label: '5-hour',
              remaining_percent: 3,
              reset_at: '2026-10-22T10:30:00Z',
              reserve_percent: 5,
              stopped: true,
            },
            {
              kind: 'long',
              label: 'weekly',
              remaining_percent: 61,
              reset_at: '',
              reserve_percent: 2,
              stopped: false,
            },
          ],
          last_poll_at: '2026-10-22T08:15:03Z',
          last_poll_success_at: '2026-10-22T08:15:03Z',
          last_poll_error: '',
        },
      ],
    });
    expect(result.quotaPollIntervalSeconds).toBe(300);
    expect(result.shortWindowReservePercent).toBe(5);
    expect(result.longWindowReservePercent).toBe(2.5);
    const [account] = result.accounts;
    expect(account.windows).toEqual([
      {
        kind: 'short',
        label: '5-hour',
        remainingPercent: 3,
        resetAt: '2026-10-22T10:30:00Z',
        reservePercent: 5,
        stopped: true,
      },
      {
        kind: 'long',
        label: 'weekly',
        remainingPercent: 61,
        resetAt: '',
        reservePercent: 2,
        stopped: false,
      },
    ]);
    expect(account.lastPollSuccessAt).toBe('2026-10-22T08:15:03Z');
    expect(account.lastPollError).toBe('');
    expect(account.quotaStopped).toBe(true);
    expect(account.quotaExhausted).toBe(false);
  });
  test('quota_exhausted marks a provider-enforced stop; anything but true is false', () => {
    const result = normalizeRoutingSnapshot({
      enabled: true,
      sessions: [],
      accounts: [
        { id: 'a', quota_stopped: true, quota_exhausted: true },
        { id: 'b', quota_stopped: true },
        { id: 'c', quota_stopped: true, quota_exhausted: 'true' },
        { id: 'd', quota_stopped: true, quota_exhausted: 1 },
      ],
    });
    expect(result.accounts.map((a) => a.quotaExhausted)).toEqual([true, false, false, false]);
    // The refresh response carries the same account entries.
    expect(
      normalizeRoutingRefresh({ accounts: [{ id: 'a', quota_exhausted: true }, { id: 'b' }] })
        .accounts.map((a) => a.quotaExhausted)
    ).toEqual([true, false]);
  });
  test('missing or invalid window and poll data fall back to unknown, never to fake values', () => {
    const result = normalizeRoutingSnapshot({
      enabled: true,
      sessions: [],
      accounts: [
        { id: 'bare' },
        {
          id: 'messy',
          observed_at: '0001-01-01T00:00:00Z',
          last_poll_at: 'not a date',
          last_poll_error: '  HTTP 401 ',
          windows: [
            { kind: 'medium', label: 'x', remaining_percent: 10 },
            'junk',
            {
              kind: 'short',
              label: '5-hour',
              remaining_percent: -4,
              reset_at: 'soon',
              reserve_percent: 'five',
              stopped: 'yes',
            },
            { kind: 'long', label: 'weekly', remaining_percent: 101 },
          ],
        },
        { id: 'not-a-list', windows: { kind: 'short' } },
      ],
    });
    expect(result.quotaPollIntervalSeconds).toBe(0);
    expect(result.shortWindowReservePercent).toBeNull();
    expect(result.longWindowReservePercent).toBeNull();
    const [bare, messy, notList] = result.accounts;
    expect(bare.windows).toEqual([]);
    expect(bare.lastPollAt).toBe('');
    expect(bare.observedAt).toBe('');
    expect(notList.windows).toEqual([]);
    expect(messy.observedAt).toBe('');
    expect(messy.lastPollAt).toBe('');
    expect(messy.lastPollError).toBe('HTTP 401');
    expect(messy.windows).toEqual([
      {
        kind: 'short',
        label: '5-hour',
        remainingPercent: null,
        resetAt: '',
        reservePercent: null,
        stopped: false,
      },
      {
        kind: 'long',
        label: 'weekly',
        remainingPercent: null,
        resetAt: '',
        reservePercent: null,
        stopped: false,
      },
    ]);
  });
  test('normalizes the refresh response and rejects a malformed one', () => {
    const result = normalizeRoutingRefresh({
      status: 'ok',
      coalesced_auth_ids: ['a', 7, 'b'],
      accounts: [{ id: 'a', last_poll_error: 'HTTP 429' }, null],
    });
    expect(result.coalescedAuthIds).toEqual(['a', 'b']);
    expect(result.accounts.map((a) => [a.id, a.lastPollError])).toEqual([['a', 'HTTP 429']]);
    expect(normalizeRoutingRefresh({ accounts: [] }).coalescedAuthIds).toEqual([]);
    expect(() => normalizeRoutingRefresh({ status: 'ok' })).toThrow();
  });
  test('session timestamps use "" for the never-observed zero time', () => {
    const [session] = normalizeRoutingSnapshot({
      enabled: true,
      accounts: [],
      sessions: [
        { id: 's', last_seen: '0001-01-01T00:00:00Z', created_at: '2026-10-22T08:00:00Z' },
      ],
    }).sessions;
    expect(session.lastSeen).toBe('');
    expect(session.createdAt).toBe('2026-10-22T08:00:00Z');
  });
  test('retains a quota stop even when the scoring observation is unknown', () => {
    const result = normalizeRoutingSnapshot({
      enabled: true,
      sessions: [],
      accounts: [
        {
          id: 'stopped',
          remaining_percent: null,
          quota_stopped: true,
          quota_stop_reason: 'confirmed credential quota',
        },
      ],
    });
    expect(result.accounts[0].remainingPercent).toBeNull();
    expect(result.accounts[0].quotaStopped).toBe(true);
    expect(result.accounts[0].quotaStopReason).toBe('confirmed credential quota');
  });
});
