import { cn } from '@/lib/utils';
import { SidebarNav } from './SidebarNav';
import type { NavItem } from '@/config/navigation';

interface DesktopSidebarProps {
  navItems: NavItem[];
  isExpanded: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function DesktopSidebar({
  navItems,
  isExpanded,
  onMouseEnter,
  onMouseLeave,
}: DesktopSidebarProps) {
  return (
    <aside
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        'hidden md:fixed md:inset-y-0 md:left-0 md:flex md:flex-col bg-sidebar z-20 transition-[width] duration-200',
        isExpanded ? 'md:w-64' : 'md:w-16'
      )}
    >
      <SidebarNav navItems={navItems} collapsed={!isExpanded} />
    </aside>
  );
}
