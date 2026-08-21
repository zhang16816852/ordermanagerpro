import { Link, useMatch } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NavItem } from '@/config/navigation';

interface SideNavLinkProps {
  item: NavItem;
  onClick: () => void;
  collapsed?: boolean;
}

export function SideNavLink({ item, onClick, collapsed }: SideNavLinkProps) {
  const match = useMatch({
    path: item.href,
    end: item.href === '/admin' || item.href === '/dashboard' || item.href === '/',
  });

  const isActive = !!match;

  return (
    <Link
      to={item.href}
      onClick={onClick}
      title={collapsed ? item.title : undefined}
      className={cn(
        'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors relative',
        collapsed ? 'justify-center' : '',
        isActive
          ? 'bg-sidebar-primary text-sidebar-primary-foreground font-medium'
          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
      )}
    >
      <div className={cn('relative', collapsed ? 'mx-auto' : '')}>
        <item.icon className="h-5 w-5" />
        {item.badge !== undefined && item.badge > 0 && (
          <Badge
            variant="destructive"
            className={cn(
              'absolute -top-1.5 -right-1.5 h-5 min-w-[1.25rem] px-1 text-[10px] flex items-center justify-center rounded-full border-2 border-sidebar',
              collapsed ? 'hidden' : ''
            )}
          >
            {item.badge > 99 ? '99+' : item.badge}
          </Badge>
        )}
      </div>

      {!collapsed && <span className="flex-1">{item.title}</span>}

      {!collapsed && isActive && <ChevronRight className="ml-auto h-4 w-4 opacity-70" />}
    </Link>
  );
}
