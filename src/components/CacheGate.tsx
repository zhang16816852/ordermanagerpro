import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { CacheService } from "@/services/cacheService";

/**
 * 依路徑決定要不要等離線快取
 * ------------------------------------------------------------
 * 公開頁面（/ 與 /shop*）不該被 ERP 的 IndexedDB 初始化卡住，
 * 所以這些路徑直接渲染 children，背景繼續跑 CacheService.init()。
 * 其餘路徑維持原本「載入中...」的全屏 gate，行為與重構前一致。
 */
const PUBLIC_PREFIXES = ["/", "/shop"];

function isPublicPath(pathname: string) {
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some((p) => p !== "/" && pathname.startsWith(p));
}

export function CacheGate({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const isPublic = isPublicPath(pathname);
  const [cacheReady, setCacheReady] = useState(false);

  useEffect(() => {
    // 已經 ready 就不要再初始化一次
    if (cacheReady) return;
    CacheService.init().then(() => setCacheReady(true));
  }, [cacheReady]);

  if (isPublic) return <>{children}</>;

  if (!cacheReady) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
          fontFamily: "system-ui",
          color: "#666",
        }}
      >
        載入中...
      </div>
    );
  }

  return <>{children}</>;
}