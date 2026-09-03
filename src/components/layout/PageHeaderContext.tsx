import { createContext, useContext, useState, ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

export interface PageHeaderConfig {
  title?: string;
  back?: string;
  onBack?: () => void;
  actions?: ReactNode;
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

  return (
    <PageHeaderContext.Provider value={{ pageHeader, setPageHeader }}>
      {children}
    </PageHeaderContext.Provider>
  );
}

export function usePageHeader() {
  return useContext(PageHeaderContext);
}