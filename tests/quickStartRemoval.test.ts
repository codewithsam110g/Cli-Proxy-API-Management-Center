import { describe, expect, test } from 'bun:test';

const read = (path: string) => Bun.file(path).text();

// The route table and the sidebar import pages/stylesheets, so they are checked as source
// (the repo has no browser harness); the redirect itself was verified in a browser.
describe('Quick Start retirement', () => {
  test('the old routes only redirect to the dashboard', async () => {
    const routes = await read('src/router/MainRoutes.tsx');
    expect(routes).toContain(`{ path: '/quick-start', element: <Navigate to="/" replace /> }`);
    expect(routes).toContain(`{ path: '/quick-start/*', element: <Navigate to="/" replace /> }`);
    expect(routes).not.toContain('fixedBrand="apikeyFun"');
  });

  test('the sidebar has no Quick Start entry and no sponsor lookups', async () => {
    const layout = await read('src/components/layout/MainLayout.tsx');
    expect(layout).not.toContain('/quick-start');
    expect(layout).not.toContain('quickStart');
    expect(layout).not.toContain('hasApiKeyFunConfig');
  });

  test('the nav hint of the removed entry is gone from every locale', async () => {
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko']) {
      const messages = (await Bun.file(`src/i18n/locales/${locale}.json`).json()) as {
        nav_meta: Record<string, string>;
      };
      expect(messages.nav_meta).not.toHaveProperty('quick_start');
    }
  });
});
