import { useEffect, useState, type ReactElement } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export function ProtectedRoute({ children }: { children: ReactElement }) {
  const location = useLocation();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const restoreSession = useAuthStore((state) => state.restoreSession);
  const [checking, setChecking] = useState(!isAuthenticated);
  useEffect(() => {
    let active = true;
    if (!isAuthenticated)
      void restoreSession().finally(() => {
        if (active) setChecking(false);
      });
    else setChecking(false);
    return () => {
      active = false;
    };
  }, [isAuthenticated, restoreSession]);
  if (checking)
    return (
      <div className="main-content">
        <LoadingSpinner />
      </div>
    );
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location }} />;
  return children;
}
