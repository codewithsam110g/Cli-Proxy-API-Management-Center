import { Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/stores';
import { PortalStatusPage } from './PortalStatusPage';

export function ViewerLayout() {
  const { t } = useTranslation();
  const location = useLocation();
  const principal = useAuthStore((state) => state.principal);
  const logout = useAuthStore((state) => state.logout);
  if (location.pathname !== '/portal/status') return <Navigate to="/portal/status" replace />;
  if (!principal?.capabilities.includes('status:read'))
    return <p role="alert">{t('portal.denied')}</p>;
  return (
    <div className="main-content">
      <header>
        <span>{principal.username}</span>{' '}
        <Button variant="secondary" onClick={logout}>
          {t('header.logout')}
        </Button>
      </header>
      <PortalStatusPage />
    </div>
  );
}
