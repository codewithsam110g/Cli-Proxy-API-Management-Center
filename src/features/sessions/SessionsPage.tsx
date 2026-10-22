import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { AccountsPanel } from './components/AccountsPanel';
import { ConversationsPanel } from './components/ConversationsPanel';
import { useCodexResets } from './useCodexResets';
import { useRoutingOverview } from './useRoutingOverview';
import styles from './SessionsPage.module.scss';

/** The same accounts table and conversation list as the Dashboard, with idle conversations shown. */
export function SessionsPage() {
  const { t } = useTranslation();
  const routing = useRoutingOverview();
  const resets = useCodexResets(routing);
  const { refreshAll, connected } = routing;
  const { reload } = resets;

  const refresh = useCallback(async () => {
    await Promise.all([refreshAll(), reload()]);
  }, [refreshAll, reload]);
  useHeaderRefresh(refresh, connected);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>{t('sessions.title')}</h1>
        <p>{t('sessions.description')}</p>
      </header>
      <AccountsPanel routing={routing} resets={resets} showDrainHelp />
      <ConversationsPanel routing={routing} defaultShowIdle showMoveHelp />
    </div>
  );
}
