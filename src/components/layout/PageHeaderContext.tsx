import { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { getRouteTitle } from '@/utils/routeTitles';

export interface PageHeaderConfig {
  title?: ReactNode;
  /**
   * 純文字標題，用於同步到瀏覽器分頁標題（document.title）。
   * title 可為 JSX（UI 顯示用），documentTitle 才寫入 document.title。
   */
  documentTitle?: string;
  back?: string;
  onBack?: () => void;
  actions?: ReactNode;
  /**
   * 僅呈現於 MobileHeader；DesktopHeader 略過 title/actions。
   * 供「頁面內自行渲染大型 h1（桌機）」的頁面使用：手機改由 sticky header 顯示標題，
   * 桌機則維持頁面內的大標，避免兩個 Header 同時出現造成標題重複。
   */
  mobileOnly?: boolean;
}

interface PageHeaderContextValue {
  pageHeader: PageHeaderConfig | null;
  setPageHeader: (config: PageHeaderConfig | null) => void;
}

const PageHeaderContext = createContext<PageHeaderContextValue>({
  pageHeader: null,
  setPageHeader: () => {},
});

export function PageHeaderProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [pageHeader, setPageHeader] = useState<PageHeaderConfig | null>(null);
  const [prevPath, setPrevPath] = useState(pathname);

  if (prevPath !== pathname) {
    // 路由切換時於 render 階段同步清空，避免殘留上一頁的標題
    setPrevPath(pathname);
    setPageHeader(null);
  }

  useEffect(() => {
    const title =
      pageHeader?.documentTitle ??
      (typeof pageHeader?.title === 'string' ? (pageHeader.title as string) : null) ??
      getRouteTitle(pathname) ??
      'ordermanager';
    document.title = title;
  }, [pageHeader, pathname]);

  return (
    <PageHeaderContext.Provider value={{ pageHeader, setPageHeader }}>
      {children}
    </PageHeaderContext.Provider>
  );
}

export function usePageHeader() {
  return useContext(PageHeaderContext);
}