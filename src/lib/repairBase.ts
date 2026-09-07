import { useLocation } from 'react-router-dom';

// 維修單相關頁面可同時掛在 admin（/admin/repair-orders）與
// FixEngineer 獨立工作台（/workshop）下，導覽 base 依目前路由自動判斷。
export function useRepairBase(): string {
  const { pathname } = useLocation();
  if (pathname.startsWith('/workshop')) return '/workshop';
  return '/admin/repair-orders';
}