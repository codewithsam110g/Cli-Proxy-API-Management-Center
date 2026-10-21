import { describe, expect, test } from 'bun:test';
import { cacheReadPercent, normalizeRoutingSnapshot } from '../src/services/api/routingSessions';

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
