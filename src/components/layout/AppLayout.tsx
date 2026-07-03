import { ReactNode, useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation, Link, useMatch, useResolvedPath } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useSpecStore } from '@/store/useSpecStore';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useStoreDraft } from '@/store/useOrderDraftStore';
import { Badge } from "@/components/ui/badge"; // ← 新增這行
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Package,
  Menu,
  Home,
  Store,
  ShoppingCart,
  ShoppingBag,
  PackageSearch,
  Truck,
  FileText,
  Users,
  Bell,
  ClipboardList,
  LogOut,
  Settings,
  ChevronRight,
  ChevronLeft,
  Layers,
  History as HistoryIcon,
  Wrench,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { NotificationDropdown } from './NotificationDropdown';
import { performGlobalDataSync } from '@/utils/versionCheck';

interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
  end?: boolean;
}

const adminNavItems: NavItem[] = [
  { title: '總覽', href: '/admin', icon: Home },
  { title: '店鋪管理', href: '/admin/stores', icon: Store },
  { title: '產品管理', href: '/admin/products', icon: PackageSearch },
  { title: '庫存管理', href: '/admin/inventory', icon: Package },
  { title: '維修管理', href: '/admin/repair-orders', icon: Wrench },
  { title: '分類管理', href: '/admin/categories', icon: Layers },
  { title: '連鎖客戶價格', href: '/admin/brand-pricing', icon: ShoppingCart },
  { title: '所有訂單', href: '/admin/orders', icon: ClipboardList },
  { title: '出貨池', href: '/admin/shipping-pool', icon: Truck },
  { title: '銷售單', href: '/admin/sales-notes', icon: FileText },
  { title: '採購管理', href: '/admin/purchase-orders', icon: Truck },
  { title: '會計管理', href: '/admin/accounting', icon: FileText },
  { title: '媒合市場', href: '/market', icon: ShoppingBag },
  { title: 'Table 式下單', href: '/admin/order-grid-templates', icon: Layers },
  { title: '操作日誌', href: '/admin/audit-logs', icon: HistoryIcon },
];
// ← 新增這兩行：取得購物車總件數




interface AppLayoutProps {
  children: ReactNode;
}
// 放在 AppLayout 外部或同個檔案內
function SideNavLink({
  item,
  onClick,
  collapsed,
}: {
  item: NavItem;
  onClick: () => void;
  collapsed?: boolean;
}) {
  // useMatch 會檢查當前 URL 是否匹配 item.href
  // end: item.href === '/' 確保首頁必須完全匹配，而其他路徑則匹配開頭即可
  const match = useMatch({
    path: item.href,
    end: item.href === '/admin' || item.href === '/dashboard' || item.href === '/'
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

export function AppLayout({ children }: AppLayoutProps) {
  const { user, isAdmin, signOut, storeRoles, currentStoreId } = useAuth();
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
    setCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('sidebar-collapsed', JSON.stringify(next));
      return next;
    });
    setHovered(false);
  };

  // [v6] 啟動全域版本同步 (邏輯已封裝至 versionCheck.ts)
  useEffect(() => {
    performGlobalDataSync();
  }, []);
  const storeId = currentStoreId || storeRoles?.[0]?.store_id;
  const { totalItems: totalCartItems } = useStoreDraft(storeId);
  const baseStoreNavItems: NavItem[] = [
    { title: '儀表板', href: '/dashboard', icon: Home },
    { title: '商品目錄', href: '/catalog', icon: PackageSearch },
    { title: '我的訂單', href: '/orders', icon: ClipboardList },
    { title: '維修管理', href: '/dashboard/repair-orders', icon: Wrench },
    { title: '媒合市場', href: '/market', icon: ShoppingBag },
    { title: '銷貨單', href: '/sales-notes', icon: FileText },
    { title: '會計報表', href: '/accounting', icon: FileText },
    { title: '團隊管理', href: '/team', icon: Users },
  ];

  const storeNavItems: NavItem[] = [
    ...baseStoreNavItems.slice(0, 2),
    {
      title: '購物車',
      href: '/cart',
      icon: ShoppingCart,
      badge: totalCartItems > 0 ? totalCartItems : undefined,
    },
    ...baseStoreNavItems.slice(2),
  ];
  
  const visitorNavItems: NavItem[] = [
    { title: '媒合市場', href: '/market', icon: ShoppingBag },
  ];
  
  const navItems = !user ? visitorNavItems : (isAdmin ? adminNavItems : storeNavItems);
  const userInitial = user?.email?.charAt(0).toUpperCase() || 'U';

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  const NavContent = ({ collapsed: navCollapsed }: { collapsed?: boolean }) => (
    <div className="flex flex-col h-full">
      {/* Logo ... */}

      <ScrollArea className="flex-1 py-4">
        <nav className="px-3 space-y-1">
          {navItems.map((item) => (
            <SideNavLink
              key={item.href}
              item={item}
              collapsed={navCollapsed}
              onClick={() => setSidebarOpen(false)}
            />
          ))}
        </nav>
      </ScrollArea>
      {/* User section */}
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
              {/*          <DropdownMenuItem onClick={() => navigate('/settings')}>
                <Settings className="mr-2 h-4 w-4" />
                設定
              </DropdownMenuItem>*/}
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

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop Sidebar */}
      <aside
        onMouseEnter={handleSidebarMouseEnter}
        onMouseLeave={handleSidebarMouseLeave}
        className={cn(
          'hidden lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:flex-col bg-sidebar z-20 transition-[width] duration-200',
          isExpanded ? 'lg:w-64' : 'lg:w-16'
        )}
      >
        <NavContent collapsed={!isExpanded} />
      </aside>

      {/* Desktop Header */}
      <header className={cn(
        'hidden lg:flex fixed top-0 right-0 h-14 items-center justify-between px-6 bg-background/60 backdrop-blur-md border-b z-30 transition-[left] duration-200',
        isExpanded ? 'left-64' : 'left-16'
      )}>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={toggleCollapsed} className="h-8 w-8 shrink-0">
            {isExpanded ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        </div>
        <div className="flex items-center gap-4">
          <NotificationDropdown />
        </div>
      </header>

      {/* Mobile Header */}
      <header className="lg:hidden sticky top-0 z-40 flex h-14 items-center gap-4 border-b bg-card px-4">
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="-ml-2">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-64 bg-sidebar border-sidebar-border">
            <SheetTitle className="sr-only">導覽選單</SheetTitle>
            <SheetDescription className="sr-only">存取系統的各個模組與功能</SheetDescription>
            <NavContent collapsed={false} />
          </SheetContent>
        </Sheet>

        <NotificationDropdown />
      </header>

      {/* Main Content */}
      <main className={cn(
        'lg:pt-14 min-w-0 transition-[padding] duration-200',
        isExpanded ? 'lg:pl-64' : 'lg:pl-16'
      )}>
        <div className="container py-6">{children}</div>
      </main>
    </div>
  );
}
