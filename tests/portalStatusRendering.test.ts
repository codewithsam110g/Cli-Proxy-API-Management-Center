import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { PortalStatusContent } from '@/features/portal/PortalStatusPage';
import type { PortalStatus } from '@/services/api/portal';

test('renders zero separately from unknown and marks stale windows and truncation', () => {
  const status: PortalStatus = {
    server_time: '2026-11-02T12:00:00Z',
    available: true,
    truncated: true,
    accounts: [
      {
        id: 'opaque',
        label: 'Safe synthetic label',
        provider: 'codex',
        availability: 'ready',
        model_count: null,
        windows: [
          {
            kind: 'session',
            remaining_percent: 0,
            resets_at: null,
            observed_at: null,
            freshness: 'unknown',
          },
          {
            kind: 'weekly',
            remaining_percent: null,
            resets_at: null,
            observed_at: '2026-11-02T11:00:00Z',
            freshness: 'stale',
          },
        ],
      },
    ],
  };
  const markup = renderToStaticMarkup(createElement(PortalStatusContent, { status }));
  expect(markup).toContain('Safe synthetic label');
  expect(markup).toContain('0%');
  expect(markup).toContain(i18n.t('portal.unknown'));
  expect(markup).toContain(i18n.t('portal.freshness_values.stale'));
  expect(markup).toContain(i18n.t('portal.truncated'));
});
