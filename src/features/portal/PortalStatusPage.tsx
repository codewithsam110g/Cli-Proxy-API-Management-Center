import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { portalApi, type PortalStatus } from '@/services/api/portal';
import { apiClient } from '@/services/api/client';

export function PortalStatusPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<PortalStatus | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    const revision = apiClient.getConnectionRevision();
    try {
      const value = await portalApi.status();
      if (revision === apiClient.getConnectionRevision()) {
        setStatus(value);
        setError(false);
      }
    } catch {
      if (revision === apiClient.getConnectionRevision()) {
        setStatus(null);
        setError(true);
      }
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30000);
    return () => window.clearInterval(timer);
  }, [load]);
  return (
    <section>
      <h1>{t('portal.status')}</h1>
      <p>{t('portal.read_only')}</p>
      <Button variant="secondary" onClick={() => void load()}>
        {t('portal.refresh')}
      </Button>
      {error && <p role="alert">{t('portal.status_error')}</p>}
      {status && <PortalStatusContent status={status} />}
    </section>
  );
}

export function PortalStatusContent({ status }: { status: PortalStatus }) {
  const { t } = useTranslation();
  const date = (value: string | null) => {
    if (!value) return t('portal.unknown');
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? t('portal.unknown') : parsed.toLocaleString();
  };
  return (
    <>
      <p>
        {t('portal.server_time')}: {date(status.server_time)}
      </p>
      {!status.available && <p role="status">{t('portal.unavailable')}</p>}
      {status.truncated && <p role="status">{t('portal.truncated')}</p>}
      {status.available && status.accounts.length === 0 && <p>{t('portal.no_accounts')}</p>}
      {status.accounts.map((account) => (
        <article key={account.id} className="card">
          <h2>{account.label}</h2>
          <p>
            {account.provider} ·{' '}
            {t(`portal.availability.${account.availability}`, {
              defaultValue: t('portal.unknown'),
            })}
          </p>
          <p>
            {t('portal.models')}: {account.model_count ?? t('portal.unknown')}
          </p>
          {account.windows.map((window) => (
            <div key={window.kind}>
              <h3>{t(`portal.window.${window.kind}`)}</h3>
              <p>
                {t('portal.remaining')}:{' '}
                {window.remaining_percent === null
                  ? t('portal.unknown')
                  : `${window.remaining_percent}%`}
              </p>
              <p>
                {t('portal.reset')}: {date(window.resets_at)} · {t('portal.observed')}:{' '}
                {date(window.observed_at)}
              </p>
              <p>
                {t('portal.freshness')}:{' '}
                {t(`portal.freshness_values.${window.freshness}`, {
                  defaultValue: t('portal.unknown'),
                })}
              </p>
            </div>
          ))}
        </article>
      ))}
    </>
  );
}
