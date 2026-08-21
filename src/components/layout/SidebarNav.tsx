import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SideNavLink } from './SideNavLink';
import type { NavItem } from '@/config/navigation';

interface SidebarNavProps {
  navItems: NavItem[];
  collapsed?: boolean;
  onNavClick?: () => void;
}

export function SidebarNav({ navItems, collapsed: navCollapsed, onNavClick }: SidebarNavProps) {
  const { user, isAdmin, storeRoles, signOut } = useAuth();
  const navigate = useNavigate();

  const userInitial = user?.email?.charAt(0).toUpperCase() || 'U';

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  return (
    <div className="flex flex-col h-full">
      <div className="brand-bar h-[3px] w-full flex-shrink-0" />
      <ScrollArea className="flex-1 py-4">
        <nav className="px-3 space-y-1">
          {navItems.map((item) => (
            <SideNavLink
              key={item.href}
              item={item}
              collapsed={navCollapsed}
              onClick={onNavClick ?? (() => {})}
            />
          ))}
        </nav>
      </ScrollArea>

      <div className="p-4 border-t border-sidebar-border">
        {user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className={cn(
                  'w-full justify-start gap-3 h-auto py-2 px-3 text-sidebar-foreground hover:bg-sidebar-accent',
                  navCollapsed ? 'justify-center px-2' : ''
                )}
              >
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-sm">
                    {userInitial}
                  </AvatarFallback>
                </Avatar>
                {!navCollapsed && (
                  <div className="flex-1 text-left min-w-0">
                    <p className="text-sm font-medium truncate">{user?.email}</p>
                    <p className="text-xs text-sidebar-foreground/60">
                      {isAdmin ? '系統管理員' : storeRoles?.[0]?.role || 'Customer'}
                    </p>
                  </div>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>我的帳號</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                登出
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            onClick={() => navigate('/auth')}
            className={cn(
              'h-10 rounded-xl font-semibold bg-primary hover:bg-primary/95 text-primary-foreground flex items-center justify-center gap-2',
              navCollapsed ? 'w-10 p-0 mx-auto' : 'w-full'
            )}
            title={navCollapsed ? '登入系統' : undefined}
          >
            <span className="text-sm">{navCollapsed ? '⋯' : '登入系統'}</span>
          </Button>
        )}
      </div>
    </div>
  );
}
