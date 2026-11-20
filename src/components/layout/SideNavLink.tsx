import { useState, useEffect, useRef } from 'react';
import { Link, useMatch, useLocation } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NavItem } from '@/config/navigation';

interface SideNavLinkProps {
  item: NavItem;
  onClick: () => void;
  collapsed?: boolean;
  isOpen?: boolean;
  onOpen?: () => void;
  onToggle?: () => void;
}

const DEFAULT_TABS: Record<string, string> = {
  '/admin/stores': 'stores',
  '/admin/reps': 'reps',
  '/admin/products': 'list',
  '/admin/inventory': 'inventory',
  '/admin/categories': 'categories',
  '/admin/purchase-orders': 'orders',
  '/admin/consignment': 'orders',
  '/admin/accounting': 'entries',
  '/admin/logistics': 'delivery-methods',
};

export function SideNavLink({ item, onClick, collapsed, isOpen = false, onOpen, onToggle }: SideNavLinkProps) {
  const location = useLocation();
  const hasChildren = !!item.children && item.children.length > 0;

  const childActive = hasChildren
    ? item.children!.some((c) => {
        const [pathname, search] = c.href.split('?');
        if (location.pathname !== pathname) return false;
        const targetTab = search ? new URLSearchParams(search).get('tab') : null;
        if (!targetTab) return true;
        const currentTab = new URLSearchParams(location.search).get('tab');
        const effectiveCurrent = currentTab ?? DEFAULT_TABS[pathname];
        return targetTab === effectiveCurrent;
      })
    : false;

  const [pathname, search] = item.href.split('?');
  const match = useMatch({
    path: pathname,
    end: item.href === '/admin' || item.href === '/dashboard' || item.href === '/',
  });

  let isActive = !!match && !hasChildren;
  if (isActive && search) {
    const targetTab = new URLSearchParams(search).get('tab');
    const currentTab = new URLSearchParams(location.search).get('tab');
    const effectiveCurrent = currentTab ?? DEFAULT_TABS[pathname];
    if (targetTab && targetTab !== effectiveCurrent) {
      isActive = false;
    }
  }

  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  useEffect(() => {
    if (hasChildren && childActive && onOpenRef.current) {
      onOpenRef.current();
    }
  }, [hasChildren, childActive]);

  const handleMouseEnter = () => {
    if (hasChildren && onOpen) onOpen();
  };

  if (!hasChildren) {
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

  return (
    <GroupFlyout
      item={item}
      onClick={onClick}
      collapsed={!!collapsed}
      childActive={childActive}
      isOpen={isOpen}
      onOpen={onOpen}
      onToggle={onToggle}
    />
  );
}

interface GroupFlyoutProps {
  item: NavItem;
  onClick: () => void;
  collapsed: boolean;
  childActive: boolean;
  isOpen: boolean;
  onOpen?: () => void;
  onToggle?: () => void;
}

function GroupFlyout({ item, onClick, collapsed, childActive, isOpen, onOpen, onToggle }: GroupFlyoutProps) {
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const location = useLocation();

  // 當前頁面所屬群組：子項永遠 inline 可見（不需 hover、不推移其他項目以外的空間）
  const pinned = isOpen || childActive;

  const openFlyout = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setFlyoutOpen(true);
    if (onOpen) onOpen();
  };

  const scheduleClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setFlyoutOpen(false), 150);
  };

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const isActiveChild = (child: NavItem) => {
    const [pathname, search] = child.href.split('?');
    if (location.pathname !== pathname) return false;
    const targetTab = search ? new URLSearchParams(search).get('tab') : null;
    const currentTab = new URLSearchParams(location.search).get('tab');
    if (!targetTab) return true;
    const effectiveCurrent = currentTab ?? DEFAULT_TABS[pathname];
    return targetTab === effectiveCurrent;
  };

  const showFlyout = flyoutOpen;

  return (
    <div
      className="space-y-0.5"
      onMouseEnter={openFlyout}
      onMouseLeave={scheduleClose}
    >
      <div
        className={cn(
          'flex items-center gap-3 rounded-lg text-sm transition-colors relative cursor-pointer select-none',
          collapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2.5',
          childActive
            ? 'text-sidebar-foreground font-medium'
            : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
        )}
      >
        <Link
          to={item.href}
          onClick={onClick}
          title={collapsed ? item.title : undefined}
          className="flex items-center gap-3 flex-1 min-w-0"
        >
          <item.icon className="h-5 w-5 shrink-0" />
          {!collapsed && <span className="flex-1 truncate">{item.title}</span>}
        </Link>
        {!collapsed && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (onToggle) onToggle();
            }}
            aria-label={isOpen ? '收合' : '展開'}
            className="p-0.5 rounded hover:bg-sidebar-accent/60"
          >
            {isOpen || pinned ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        )}
      </div>

      {/* collapsed 模式：hover 浮動 flyout（右側） */}
      {collapsed && (
        <CollapsedFlyoutInner item={item} onClick={onClick} childActive={childActive} isActiveChild={isActiveChild} />
      )}

      {/* expanded 模式：hover 浮動 flyout（右側，不推移下方項目） */}
      {!collapsed && showFlyout && (
        <div
          className="absolute left-full top-0 ml-2 z-50 min-w-[180px] rounded-lg border border-sidebar-border bg-sidebar shadow-lg py-1"
          onMouseEnter={openFlyout}
          onMouseLeave={scheduleClose}
        >
          <div className="px-3 py-1.5 text-xs font-semibold text-sidebar-foreground/60 border-b border-sidebar-border/60">
            {item.title}
          </div>
          {item.children!.map((child) => (
            <Link
              key={child.href}
              to={child.href}
              onClick={() => {
                onClick();
                setFlyoutOpen(false);
              }}
              className={cn(
                'flex items-center gap-2 px-3 py-2 text-sm transition-colors',
                isActiveChild(child)
                  ? 'bg-sidebar-primary text-sidebar-primary-foreground font-medium'
                  : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
              )}
            >
              <child.icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{child.title}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

interface CollapsedFlyoutInnerProps {
  item: NavItem;
  onClick: () => void;
  childActive: boolean;
  isActiveChild: (child: NavItem) => boolean;
}

function CollapsedFlyoutInner({ item, onClick, childActive, isActiveChild }: CollapsedFlyoutInnerProps) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openFlyout = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setOpen(true);
  };

  const scheduleClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  };

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  return (
    <div
      className="relative"
      onMouseEnter={openFlyout}
      onMouseLeave={scheduleClose}
    >
      {open && (
        <div
          className="absolute left-full top-0 ml-2 z-50 min-w-[180px] rounded-lg border border-sidebar-border bg-sidebar shadow-lg py-1"
          onMouseEnter={openFlyout}
          onMouseLeave={scheduleClose}
        >
          <div className="px-3 py-1.5 text-xs font-semibold text-sidebar-foreground/60 border-b border-sidebar-border/60">
            {item.title}
          </div>
          {item.children!.map((child) => (
            <Link
              key={child.href}
              to={child.href}
              onClick={() => {
                onClick();
                setOpen(false);
              }}
              className={cn(
                'flex items-center gap-2 px-3 py-2 text-sm transition-colors',
                isActiveChild(child)
                  ? 'bg-sidebar-primary text-sidebar-primary-foreground font-medium'
                  : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
              )}
            >
              <child.icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{child.title}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}