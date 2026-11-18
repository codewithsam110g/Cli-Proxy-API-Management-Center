import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { apiClient } from '@/services/api/client';
import { portalApi, type AccountLabel, type ViewerUser } from '@/services/api/portal';
import { useNotificationStore } from '@/stores';

export function PortalManagementPage() {
  const { t } = useTranslation();
  const showConfirmation = useNotificationStore((s) => s.showConfirmation);
  const [users, setUsers] = useState<ViewerUser[]>([]);
  const [accounts, setAccounts] = useState<AccountLabel[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [resetId, setResetId] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const revision = apiClient.getConnectionRevision();
    try {
      const [u, a] = await Promise.all([portalApi.users(), portalApi.labels()]);
      if (revision === apiClient.getConnectionRevision()) {
        setUsers(u.users);
        setAccounts(a.accounts);
        setError('');
      }
    } catch {
      if (revision === apiClient.getConnectionRevision()) setError(t('portal.management_error'));
    }
  }, [t]);
  useEffect(() => {
    void load();
  }, [load]);
  const run = async (action: () => Promise<unknown>) => {
    const revision = apiClient.getConnectionRevision();
    setBusy(true);
    setError('');
    try {
      await action();
      if (revision === apiClient.getConnectionRevision()) await load();
    } catch (error) {
      if (revision === apiClient.getConnectionRevision()) {
        const code = (error as { apiCode?: string }).apiCode;
        setError(
          code === 'portal_user_exists'
            ? t('portal.user_exists')
            : code === 'portal_invalid_request'
              ? t('portal.invalid_request')
              : t('portal.management_error')
        );
      }
    } finally {
      if (revision === apiClient.getConnectionRevision()) setBusy(false);
    }
  };
  const confirm = (action: () => Promise<unknown>) => {
    const revision = apiClient.getConnectionRevision();
    showConfirmation({
      message: t('portal.confirm_revoke'),
      variant: 'danger',
      onConfirm: () => {
        if (revision === apiClient.getConnectionRevision()) return run(action);
      },
    });
  };
  const validPassword = (value: string) => {
    const n = new TextEncoder().encode(value).length;
    return n >= 12 && n <= 72;
  };
  const create = () => {
    if (
      !/^[a-z][a-z0-9_.-]{2,63}$/.test(username.trim().toLowerCase()) ||
      !validPassword(password)
    ) {
      setError(t('portal.credentials_hint'));
      return;
    }
    const name = username.trim().toLowerCase();
    const secret = password;
    setPassword('');
    setUsername('');
    void run(() => portalApi.create(name, secret));
  };
  const reset = () => {
    if (!resetId || !validPassword(resetPassword)) {
      setError(t('portal.credentials_hint'));
      return;
    }
    const secret = resetPassword;
    const userId = resetId;
    setResetPassword('');
    setResetId('');
    confirm(() => portalApi.password(userId, secret));
  };
  return (
    <section>
      <h1>{t('portal.manage')}</h1>
      {error && <p role="alert">{error}</p>}
      <h2>{t('portal.create')}</h2>
      <p>{t('portal.credentials_hint')}</p>
      <Input
        label={t('portal.username')}
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        autoComplete="off"
      />
      <Input
        label={t('portal.password')}
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
      />
      <Button disabled={busy} onClick={create}>
        {t('portal.create')}
      </Button>
      <h2>{t('portal.users')}</h2>
      {users.map((user) => (
        <article className="card" key={user.id}>
          <h3>{user.username}</h3>
          <p>
            {user.enabled ? t('portal.enabled') : t('portal.disabled')} · {t('portal.sessions')}:{' '}
            {user.active_sessions}
          </p>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              user.enabled
                ? confirm(() => portalApi.enable(user.id, false))
                : void run(() => portalApi.enable(user.id, true))
            }
          >
            {user.enabled ? t('portal.disable') : t('portal.enable')}
          </Button>{' '}
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setResetPassword('');
              setResetId(user.id);
            }}
          >
            {t('portal.reset_password')}
          </Button>{' '}
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => confirm(() => portalApi.remove(user.id))}
          >
            {t('portal.delete')}
          </Button>
          {resetId === user.id && (
            <div>
              <Input
                label={t('portal.new_password')}
                type="password"
                autoComplete="new-password"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
              />
              <Button disabled={busy} onClick={reset}>
                {t('portal.reset_password')}
              </Button>{' '}
              <Button
                variant="secondary"
                onClick={() => {
                  setResetPassword('');
                  setResetId('');
                }}
              >
                {t('portal.cancel')}
              </Button>
            </div>
          )}
        </article>
      ))}
      <h2>{t('portal.aliases')}</h2>
      <p>{t('portal.alias_hint')}</p>
      {accounts.map((account) => (
        <AliasEditor
          key={account.id}
          account={account}
          disabled={busy}
          save={(label) => run(() => portalApi.label(account.id, label))}
        />
      ))}
    </section>
  );
}
function AliasEditor({
  account,
  disabled,
  save,
}: {
  account: AccountLabel;
  disabled: boolean;
  save: (value: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [label, setLabel] = useState(account.label);
  useEffect(() => setLabel(account.label), [account.label]);
  return (
    <div className="card">
      <p>
        {account.provider} · {account.admin_label} · {account.auth_id}
      </p>
      <Input
        label={t('portal.alias')}
        maxLength={64}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <Button disabled={disabled} onClick={() => void save(label)}>
        {t('portal.save')}
      </Button>
    </div>
  );
}
