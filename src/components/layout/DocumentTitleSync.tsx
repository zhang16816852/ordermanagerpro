import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { getRouteTitle } from '@/utils/routeTitles';

/**
 * 全站路由 → 分頁標題同步器。
 * 掛在 BrowserRouter 內、Routes 之上，確保不含 AppLayout 的路由
 * （Share 頁面、Auth、首頁、商品目錄等）也能套用 routeTitles 的 fallback 標題。
 * 若頁面自行透過 PageHeaderProvider 設定 documentTitle，會由其 effect 覆寫。
 */
export function DocumentTitleSync() {
  const { pathname } = useLocation();

  useEffect(() => {
    const title = getRouteTitle(pathname) ?? 'ordermanager';
    document.title = title;
  }, [pathname]);

  return null;
}