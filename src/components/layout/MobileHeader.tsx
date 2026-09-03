import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { NotificationDropdown } from './NotificationDropdown';
import { MobileSidebar } from './MobileSidebar';
import type { NavItem } from '@/config/navigation';
import type { PageHeaderConfig } from './PageHeaderContext';

interface MobileHeaderProps {
  navItems: NavItem[];
  sidebarOpen: boolean;
  onSidebarOpenChange: (open: boolean) => void;
  pageHeader?: PageHeaderConfig | null;
}

export function MobileHeader({ navItems, sidebarOpen, onSidebarOpenChange, pageHeader }: MobileHeaderProps) {
  const navigate = useNavigate();

  const handleBack = () => {
    if (pageHeader?.onBack) {
      pageHeader.onBack();
    } else if (pageHeader?.back) {
      navigate(pageHeader.back);
    }
  };

  const hasBack = !!(pageHeader?.back || pageHeader?.onBack);

  return (
    <header className="md:hidden sticky top-0 z-40 flex h-14 items-center gap-2 border-b bg-card px-4">
      <MobileSidebar
        navItems={navItems}
        open={sidebarOpen}
        onOpenChange={onSidebarOpenChange}
      />
      {hasBack && (
        <Button variant="ghost" size="icon" onClick={handleBack} aria-label="返回" className="-ml-1 h-8 w-8 shrink-0">
          <ArrowLeft className="h-4 w-4" />
        </Button>
      )}
      {pageHeader?.title && (
        <span className="text-sm font-semibold tracking-tight truncate flex-1 min-w-0">{pageHeader.title}</span>
      )}
      {pageHeader?.actions && <div className="shrink-0">{pageHeader.actions}</div>}
      <NotificationDropdown />
    </header>
  );
}