import {
  Home,
  Store,
  PackageSearch,
  Package,
  Wrench,
  Layers,
  ShoppingCart,
  ShoppingBag,
  ClipboardList,
  Truck,
  FileText,
  Users,
  History as HistoryIcon,
  PlusCircle,
} from 'lucide-react';

export interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
  end?: boolean;
}

export const adminNavItems: NavItem[] = [
  { title: '總覽', href: '/admin', icon: Home },
  { title: '店鋪管理', href: '/admin/stores', icon: Store },
  { title: '產品管理', href: '/admin/products', icon: PackageSearch },
  { title: '庫存管理', href: '/admin/inventory', icon: Package },
  { title: '維修管理', href: '/admin/repair-orders', icon: Wrench },
  { title: '分類管理', href: '/admin/categories', icon: Layers },
  { title: '連鎖客戶價格', href: '/admin/brand-pricing', icon: ShoppingCart },
  { title: '所有訂單', href: '/admin/orders', icon: ClipboardList },
  { title: '建立新單據', href: '/admin/orders/checkout', icon: PlusCircle },
  { title: '出貨池', href: '/admin/shipping-pool', icon: Truck },
  { title: '銷售單', href: '/admin/sales-notes', icon: FileText },
  { title: '採購管理', href: '/admin/purchase-orders', icon: Truck },
  { title: '寄賣管理', href: '/admin/consignment', icon: Package },
  { title: '會計管理', href: '/admin/accounting', icon: FileText },
  { title: '媒合市場', href: '/market', icon: ShoppingBag },
  { title: 'Table 式下單', href: '/admin/order-grid-templates', icon: Layers },
  { title: '操作日誌', href: '/admin/audit-logs', icon: HistoryIcon },
];

export const baseStoreNavItems: NavItem[] = [
  { title: '儀表板', href: '/dashboard', icon: Home },
  { title: '商品目錄', href: '/catalog', icon: PackageSearch },
  { title: '我的訂單', href: '/orders', icon: ClipboardList },
  { title: '維修管理', href: '/dashboard/repair-orders', icon: Wrench },
  { title: '媒合市場', href: '/market', icon: ShoppingBag },
  { title: '寄賣/銷貨', href: '/sales-notes', icon: Package },
  { title: '會計報表', href: '/accounting', icon: FileText },
  { title: '團隊管理', href: '/team', icon: Users },
];

export function buildStoreNavItems(totalCartItems: number): NavItem[] {
  return [
    ...baseStoreNavItems.slice(0, 2),
    {
      title: '購物車',
      href: '/cart',
      icon: ShoppingCart,
      badge: totalCartItems > 0 ? totalCartItems : undefined,
    },
    ...baseStoreNavItems.slice(2),
  ];
}

export const visitorNavItems: NavItem[] = [
  { title: '媒合市場', href: '/market', icon: ShoppingBag },
];
