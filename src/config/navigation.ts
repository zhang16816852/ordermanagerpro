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
  Wallet,
  Globe,
  Layout,
  Send,
  Database,
  Tag,
  Smartphone,
  Link2,
  ClipboardCheck,
  Percent,
} from 'lucide-react';

export interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
  end?: boolean;
  /** 子導航（可展開/收合群組） */
  children?: NavItem[];
}

export const adminNavItems: NavItem[] = [
  { title: '總覽', href: '/admin', icon: Home },
  {
    title: '店鋪管理', href: '/admin/stores', icon: Store,
    children: [
      { title: '店鋪', href: '/admin/stores?tab=stores', icon: Store },
      { title: '人員', href: '/admin/stores?tab=users', icon: Users },
      { title: '邀請', href: '/admin/stores?tab=invitations', icon: Users },
    ],
  },
  { title: '業務管理', href: '/admin/reps', icon: Users,
    children: [
      { title: '業務列表', href: '/admin/reps?tab=reps', icon: Users },
      { title: '店家分配', href: '/admin/reps?tab=assign', icon: Store },
      { title: '成本設定', href: '/admin/reps?tab=costs', icon: Percent },
    ],
  },
  {
    title: '產品管理', href: '/admin/products', icon: PackageSearch,
    children: [
      { title: '產品列表', href: '/admin/products?tab=list', icon: PackageSearch },
      { title: '變體管理', href: '/admin/products?tab=variants', icon: Layers },
      { title: '顏色管理', href: '/admin/products?tab=colors', icon: Layers },
    ],
  },
  {
    title: '庫存管理', href: '/admin/inventory', icon: Package,
    children: [
      { title: '庫存列表', href: '/admin/inventory?tab=inventory', icon: Package },
      { title: '倉庫管理', href: '/admin/inventory?tab=warehouses', icon: Package },
      { title: '批次 / 序號', href: '/admin/inventory?tab=batches', icon: PackageSearch },
    ],
  },
  { title: '維修管理', href: '/admin/repair-orders', icon: Wrench },
  { title: '維修零件', href: '/admin/repair-parts', icon: Wrench },
  {
    title: '分類管理', href: '/admin/categories', icon: Layers,
    children: [
      { title: '分類架構', href: '/admin/categories?tab=categories', icon: Layers },
      { title: '規格屬性庫', href: '/admin/categories?tab=spec_library', icon: Database },
      { title: '品牌管理', href: '/admin/categories?tab=brands', icon: Tag },
      { title: '型號標籤庫', href: '/admin/categories?tab=models', icon: Smartphone },
      { title: '分類綁定', href: '/admin/categories?tab=bindings', icon: Link2 },
    ],
  },
  { title: '首頁內容', href: '/admin/storefront', icon: Layout },
  { title: '連鎖客戶價格', href: '/admin/brand-pricing', icon: ShoppingCart },
  { title: '所有訂單', href: '/admin/orders', icon: ClipboardList },
  { title: '建立新單據', href: '/admin/orders/checkout', icon: PlusCircle },
  { title: '出貨池', href: '/admin/shipping-pool', icon: Truck },
  { title: '銷售單', href: '/admin/sales-notes', icon: FileText },
  {
    title: '採購管理', href: '/admin/purchase-orders', icon: Truck,
    children: [
      { title: '採購單', href: '/admin/purchase-orders?tab=orders', icon: Truck },
      { title: '收貨', href: '/admin/purchase-orders?tab=receiving', icon: Truck },
      { title: '供應商', href: '/admin/purchase-orders?tab=suppliers', icon: Users },
    ],
  },
  { title: '集運倉管理', href: '/admin/cross-border', icon: Globe },
  {
    title: '寄賣管理', href: '/admin/consignment', icon: Package,
    children: [
      { title: '寄賣單', href: '/admin/consignment?tab=orders', icon: Package },
      { title: '銷售回報審核', href: '/admin/consignment?tab=reports', icon: ClipboardCheck },
    ],
  },
  {
    title: '會計管理', href: '/admin/accounting', icon: FileText,
    children: [
      { title: '收支明細', href: '/admin/accounting?tab=entries', icon: FileText },
      { title: '帳戶管理', href: '/admin/accounting?tab=accounts', icon: Wallet },
      { title: '收支類型', href: '/admin/accounting?tab=categories', icon: Layers },
      { title: '外幣 FIFO', href: '/admin/accounting?tab=currency-fifo', icon: Layers },
    ],
  },
  {
    title: '物流管理', href: '/admin/logistics', icon: Truck,
    children: [
      { title: '配送方式', href: '/admin/logistics?tab=delivery-methods', icon: Truck },
      { title: '包裹列表', href: '/admin/logistics?tab=shipping-packages', icon: Package },
      { title: '運費月結', href: '/admin/logistics?tab=shipping-settlements', icon: Truck },
    ],
  },
  { title: '媒合市場', href: '/market', icon: ShoppingBag },
  { title: 'Table 式下單', href: '/admin/order-grid-templates', icon: Layers },
  { title: '操作日誌', href: '/admin/audit-logs', icon: HistoryIcon },
  { title: 'Telegram Bot', href: '/admin/notification-bots', icon: Send },
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

// 業務（rep）導航：登入後進入 /admin，選單僅限與自己相關的功能
export const repNavItems: NavItem[] = [
  { title: '我的儀表板', href: '/admin', icon: Home },
  { title: '所有訂單', href: '/admin/orders', icon: ClipboardList },
  { title: '建立新單據', href: '/admin/orders/checkout', icon: PlusCircle },
  { title: '銷售單', href: '/admin/sales-notes', icon: FileText },
  { title: '我的分潤', href: '/admin/my-commission', icon: Wallet },
];

// FixEngineer（維修人員）獨立工作台導航：不進 /admin 後台
export const fixengineerNavItems: NavItem[] = [
  { title: '維修工作檯', href: '/workshop', icon: Wrench, end: true },
  { title: '新增維修單', href: '/workshop/new', icon: PlusCircle },
  { title: '媒合市場', href: '/market', icon: ShoppingBag },
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
