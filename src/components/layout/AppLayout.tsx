import { ReactNode, useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useStoreDraft } from '@/store/useOrderDraftStore';
import { cn } from '@/lib/utils';
import { performGlobalDataSync } from '@/utils/versionCheck';
import {
  adminNavItems,
  buildStoreNavItems,
  visitorNavItems,
} from '@/config/navigation';
import { DesktopSidebar } from './DesktopSidebar';
import { DesktopHeader } from './DesktopHeader';
import { MobileHeader } from './MobileHeader';

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { user, isAdmin, storeId: currentStoreId, storeRoles, isAuthReady } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebar-collapsed');
    return saved ? JSON.parse(saved) : false;
  });
  const [hovered, setHovered] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isExpanded = !collapsed || hovered;

  const handleSidebarMouseEnter = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHovered(true);
  };

  const handleSidebarMouseLeave = () => {
    hoverTimerRef.current = setTimeout(() => {
      setHovered(false);
      hoverTimerRef.current = null;
    }, 200);
  };

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('sidebar-collapsed', JSON.stringify(next));
      return next;
    });
    setHovered(false);
  };

  useEffect(() => {
    if (isAuthReady) {
      performGlobalDataSync();
    }
  }, [isAuthReady]);

  const storeId = currentStoreId || storeRoles?.[0]?.store_id;
  const { totalItems: totalCartItems } = useStoreDraft(storeId);

  const navItems = useMemo(() => {
    if (!user) return visitorNavItems;
    if (isAdmin) return adminNavItems;
    return buildStoreNavItems(totalCartItems);
  }, [user, isAdmin, totalCartItems]);

  return (
    <div className="min-h-screen bg-background">
      <DesktopSidebar
        navItems={navItems}
        isExpanded={isExpanded}
        onMouseEnter={handleSidebarMouseEnter}
        onMouseLeave={handleSidebarMouseLeave}
      />

      <DesktopHeader isExpanded={isExpanded} onToggleCollapse={toggleCollapsed} />

      <MobileHeader
        navItems={navItems}
        sidebarOpen={sidebarOpen}
        onSidebarOpenChange={setSidebarOpen}
      />

      <main
        className={cn(
          'md:pt-14 min-w-0 transition-[padding] duration-200',
          isExpanded ? 'md:pl-64' : 'md:pl-16'
        )}
      >
        <div className="container py-6">{children}</div>
      </main>
    </div>
  );
}
