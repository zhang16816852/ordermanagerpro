import { NotificationDropdown } from './NotificationDropdown';
import { MobileSidebar } from './MobileSidebar';
import type { NavItem } from '@/config/navigation';

interface MobileHeaderProps {
  navItems: NavItem[];
  sidebarOpen: boolean;
  onSidebarOpenChange: (open: boolean) => void;
}

export function MobileHeader({ navItems, sidebarOpen, onSidebarOpenChange }: MobileHeaderProps) {
  return (
    <header className="md:hidden sticky top-0 z-40 flex h-14 items-center gap-4 border-b bg-card px-4">
      <MobileSidebar
        navItems={navItems}
        open={sidebarOpen}
        onOpenChange={onSidebarOpenChange}
      />
      <NotificationDropdown />
    </header>
  );
}
