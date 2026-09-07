import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: ReactNode;
  requireAdmin?: boolean;
  requireFixEngineer?: boolean;
}

export function ProtectedRoute({ children, requireAdmin = false, requireFixEngineer = false }: ProtectedRouteProps) {
  const { user, loading, rolesReady, isAdmin, isRep, isFixEngineer } = useAuth();
  const location = useLocation();

  if (loading || ((requireAdmin || requireFixEngineer) && !rolesReady)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" role="status" aria-live="polite">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  if (requireAdmin && !isAdmin && !isRep) {
    return <Navigate to="/dashboard" replace />;
  }

  if (requireFixEngineer && !isFixEngineer) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
