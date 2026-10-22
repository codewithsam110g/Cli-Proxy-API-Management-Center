import { describe, expect, test } from 'bun:test';
import { parseDocument } from 'yaml';
import { getVisualConfigValidationErrors } from '../src/hooks/useVisualConfig';
import { DEFAULT_VISUAL_VALUES, type VisualConfigValues } from '../src/types/visualConfig';
import { runVisualConfig } from './helpers/visualConfig';

const errorsFor = (patch: Partial<VisualConfigValues>) =>
  getVisualConfigValidationErrors({ ...structuredClone(DEFAULT_VISUAL_VALUES), ...patch });
const quotaOf = (yaml: string) => parseDocument(yaml).getIn(['routing', 'session-quota']);

describe('routing.session-quota in the visual config', () => {
  test('reads the three keys, keeping blanks for absent ones', () => {
    const loaded = runVisualConfig(
      'routing:\n  session-quota:\n    short-window-reserve-percent: 7.5\n    poll-interval: 10m\n'
    );
    expect(loaded.visualValues.routingSessionQuotaShortReserve).toBe('7.5');
    expect(loaded.visualValues.routingSessionQuotaLongReserve).toBe('');
    expect(loaded.visualValues.routingSessionQuotaPollInterval).toBe('10m');
    expect(loaded.visualDirty).toBe(false);
  });

  test('writes reserves as YAML numbers (the backend rejects strings) and the interval as text', () => {
    const yaml = 'routing:\n  strategy: session-balanced\n';
    const config = runVisualConfig(yaml, [
      {
        routingSessionQuotaShortReserve: '7.5',
        routingSessionQuotaLongReserve: ' 3 ',
        routingSessionQuotaPollInterval: '10m',
      },
    ]);
    const output = config.applyVisualChangesToYaml(yaml);
    const quota = quotaOf(output)?.toJSON();
    expect(quota).toEqual({
      'short-window-reserve-percent': 7.5,
      'long-window-reserve-percent': 3,
      'poll-interval': '10m',
    });
    expect(typeof quota['short-window-reserve-percent']).toBe('number');
    expect(parseDocument(output).getIn(['routing', 'strategy'])).toBe('session-balanced');
  });

  test('a reserve of 0 is a real value, not "unset"', () => {
    const yaml = 'routing: {strategy: session-balanced}\n';
    const output = runVisualConfig(yaml, [
      { routingSessionQuotaShortReserve: '0', routingSessionQuotaPollInterval: '0' },
    ]).applyVisualChangesToYaml(yaml);
    expect(quotaOf(output)?.toJSON()).toEqual({
      'short-window-reserve-percent': 0,
      'poll-interval': '0',
    });
  });

  test('works under a null routing section and keeps unrelated edits', () => {
    const yaml = 'config-version: 8\nrouting: null\n';
    const output = runVisualConfig(yaml, [
      { routingSessionQuotaLongReserve: '1.5' },
    ]).applyVisualChangesToYaml(yaml);
    expect(parseDocument(output).toJS()).toEqual({
      'config-version': 8,
      routing: { 'session-quota': { 'long-window-reserve-percent': 1.5 } },
    });
  });

  test('clearing the last key removes the empty session-quota map; other routing keys stay', () => {
    const yaml =
      'routing:\n  strategy: session-balanced\n  session-quota:\n    poll-interval: 5m\n';
    const output = runVisualConfig(yaml, [
      { routingSessionQuotaPollInterval: '' },
    ]).applyVisualChangesToYaml(yaml);
    expect(quotaOf(output)).toBeUndefined();
    expect(parseDocument(output).getIn(['routing', 'strategy'])).toBe('session-balanced');
  });

  test('clearing one key keeps its siblings and any key this editor does not know', () => {
    const yaml =
      'routing:\n  session-quota:\n    short-window-reserve-percent: 5\n    long-window-reserve-percent: 2\n    future-key: keep\n';
    const output = runVisualConfig(yaml, [
      { routingSessionQuotaShortReserve: '' },
    ]).applyVisualChangesToYaml(yaml);
    expect(quotaOf(output)?.toJSON()).toEqual({
      'long-window-reserve-percent': 2,
      'future-key': 'keep',
    });
  });

  test('an unrelated edit does not touch the section', () => {
    const yaml =
      'server: {port: 8317}\nrouting:\n  session-quota:\n    short-window-reserve-percent: 5\n';
    const output = runVisualConfig(yaml, [{ port: '9000' }]).applyVisualChangesToYaml(yaml);
    expect(quotaOf(output)?.toJSON()).toEqual({ 'short-window-reserve-percent': 5 });
  });

  describe('validation mirrors the backend', () => {
    for (const [value, valid] of [
      ['', true],
      ['0', true],
      ['5', true],
      ['2.5', true],
      ['.5', true],
      ['50', true],
      ['50.0', true],
      ['50.01', false],
      ['51', false],
      ['-1', false],
      ['-0.5', false],
      ['abc', false],
      ['5%', false],
      ['1e1', false],
      ['1,5', false],
      ['NaN', false],
      ['Infinity', false],
    ] as const) {
      test(`reserve "${value}" is ${valid ? 'accepted' : 'rejected'}`, () => {
        for (const key of [
          'routingSessionQuotaShortReserve',
          'routingSessionQuotaLongReserve',
        ] as const) {
          expect(errorsFor({ [key]: value })[key]).toBe(valid ? undefined : 'reserve_range');
        }
      });
    }

    for (const [value, valid] of [
      ['', true],
      ['0', true],
      ['0s', true],
      ['1m', true],
      ['60s', true],
      ['5m', true],
      ['90s', true],
      ['1h30m', true],
      ['1.5m', true],
      ['59s', false],
      ['59.9s', false],
      ['30s', false],
      ['500ms', false],
      ['-1m', false],
      ['5', false],
      ['five minutes', false],
      ['5 m', false],
    ] as const) {
      test(`poll interval "${value}" is ${valid ? 'accepted' : 'rejected'}`, () => {
        expect(
          errorsFor({ routingSessionQuotaPollInterval: value }).routingSessionQuotaPollInterval
        ).toBe(valid ? undefined : 'invalid_poll_interval');
      });
    }
  });
});
