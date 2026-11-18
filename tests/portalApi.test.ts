import { expect, test } from 'bun:test';
import type { AxiosInstance } from 'axios';
import { apiClient } from '@/services/api/client';
import { portalApi } from '@/services/api/portal';

test('owner management calls use the frozen paths, methods, fields and owner transport', async () => {
  const instance = (apiClient as unknown as { instance: AxiosInstance }).instance;
  const previous = instance.defaults.adapter;
  const requests: Array<{
    method?: string;
    url?: string;
    data: unknown;
    authorization?: string;
    viewer?: string;
  }> = [];
  instance.defaults.adapter = async (config) => {
    requests.push({
      method: config.method,
      url: config.url,
      data: config.data ? JSON.parse(config.data) : undefined,
      authorization: config.headers.Authorization as string | undefined,
      viewer: config.headers['X-Portal-Session'] as string | undefined,
    });
    return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
  };
  try {
    apiClient.setConfig({ apiBase: 'http://fixture.invalid', managementKey: 'fixture-owner' });
    await portalApi.users();
    await portalApi.create('reader', 'synthetic-password');
    await portalApi.enable('user/one', false);
    await portalApi.password('user/one', 'new-synthetic-password');
    await portalApi.remove('user/one');
    await portalApi.labels();
    await portalApi.label('account/one', 'Public');
    expect(requests.map(({ method, url, data }) => [method, url, data])).toEqual([
      ['get', '/portal/users', undefined],
      ['post', '/portal/users', { username: 'reader', password: 'synthetic-password' }],
      ['patch', '/portal/users/user%2Fone', { enabled: false }],
      ['put', '/portal/users/user%2Fone/password', { password: 'new-synthetic-password' }],
      ['delete', '/portal/users/user%2Fone', undefined],
      ['get', '/portal/account-labels', undefined],
      ['put', '/portal/account-labels/account%2Fone', { label: 'Public' }],
    ]);
    expect(
      requests.every(
        (request) => request.authorization === 'Bearer fixture-owner' && !request.viewer
      )
    ).toBe(true);
  } finally {
    instance.defaults.adapter = previous;
    apiClient.setConfig({ apiBase: '', managementKey: '' });
  }
});
