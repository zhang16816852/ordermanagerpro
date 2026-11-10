// 路由 → 瀏覽器分頁標題 fallback 對照表
// PageHeaderContext 會優先使用頁面自行設定的 documentTitle；未設定時才走此表。

const EXACT_TITLES: Record<string, string> = {
  '/': '首頁',
  '/shop': '商品目錄',
  '/market': '媒合市場',
  '/auth': '登入',
  '/admin': '後台儀表板',
  '/admin/inventory': '庫存管理',
  '/admin/products': '產品管理',
  '/admin/products/new': '新增產品',
  '/admin/categories': '分類管理',
  '/admin/categories/new': '新增分類',
  '/admin/stores': '店鋪管理',
  '/admin/reps': '業務管理',
  '/admin/my-commission': '我的佣金',
  '/admin/orders': '訂單管理',
  '/admin/orders/checkout': '建立訂單',
  '/admin/sales-notes': '銷貨單管理',
  '/admin/shipping-pool': '出貨池',
  '/admin/brand-pricing': '品牌定價',
  '/admin/accounting': '會計管理',
  '/admin/logistics': '物流管理',
  '/admin/storefront': '首頁內容',
  '/admin/notification-bots': 'Telegram Bot 管理',
  '/admin/purchase-orders': '採購單管理',
  '/admin/cross-border': '集運倉管理',
  '/admin/consignment': '寄賣管理',
  '/admin/audit-logs': '稽核紀錄',
  '/admin/order-grid-templates': '訂單表格範本',
  '/admin/repair-orders': '維修單管理',
  '/admin/repair-orders/new': '新增維修單',
  '/admin/repair-parts': '維修零件',
  '/dashboard': '門市儀表板',
  '/orders': '訂單列表',
  '/cart': '購物車結帳',
  '/catalog': '商品目錄',
  '/sales-notes': '銷貨單',
  '/receiving': '收貨',
  '/team': '團隊管理',
  '/audit': '稽核紀錄',
  '/notifications': '通知',
  '/accounting': '會計',
  '/market/create': '建立媒合',
  '/market/my-listings': '我的刊登',
};

export function getRouteTitle(pathname: string): string | null {
  if (EXACT_TITLES[pathname]) return EXACT_TITLES[pathname];

  // 動態路由
  if (pathname.startsWith('/shop/')) return '商品詳情';
  if (pathname.startsWith('/market/')) return '媒合詳情';
  if (pathname.startsWith('/invite/')) return '接受邀請';
  if (pathname.startsWith('/share/order/')) return '訂單分享';
  if (pathname.startsWith('/share/sale/')) return '銷貨單分享';
  if (pathname.startsWith('/share/consignment/')) return '寄賣單分享';
  if (pathname.startsWith('/share/statement/')) return '客戶對帳單';
  if (pathname.startsWith('/admin/products/') && pathname.endsWith('/edit')) return '編輯產品';
  if (pathname.startsWith('/admin/categories/') && pathname !== '/admin/categories/new') return '編輯分類';
  if (pathname.startsWith('/admin/orders/') && pathname.endsWith('/edit')) return '編輯訂單';
  if (pathname.startsWith('/admin/purchase-orders/') && pathname.endsWith('/edit')) return '編輯採購單';
  if (pathname.startsWith('/admin/repair-orders/') && pathname.endsWith('/edit')) return '編輯維修單';
  if (/^\/admin\/repair-orders\/[^/]+$/.test(pathname)) return '維修單詳情';
  if (/^\/admin\/reps\/[^/]+\/commission$/.test(pathname)) return '佣金明細';
  if (/^\/admin\/categories\/[^/]+$/.test(pathname)) return '分類編輯';
  if (pathname.startsWith('/orders/') && pathname.endsWith('/edit')) return '編輯訂單';
  if (pathname.startsWith('/dashboard/repair-orders/')) {
    if (pathname.endsWith('/edit')) return '編輯維修單';
    if (/\/dashboard\/repair-orders\/[^/]+$/.test(pathname)) return '維修單詳情';
    if (pathname === '/dashboard/repair-orders/new') return '新增維修單';
  }
  if (pathname === '/dashboard/repair-orders') return '維修單管理';

  // 後台重新導向
  if (pathname === '/admin/shipping-settlements' || pathname === '/admin/delivery-methods') {
    return '物流管理';
  }

  return null;
}