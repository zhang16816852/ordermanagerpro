import { Routes, Route } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/layout/AppLayout";
import { PublicLayout } from "@/components/layout/PublicLayout";
import StorefrontPage from "@/storefront/StorefrontPage";

import { adminRoutes } from "./admin";
import { storeRoutes } from "./store";
import { sharedRoutes } from "./shared";
import { workshopRoutes } from "./workshop";
import MarketPage from "@/pages/market/index";
import MarketDetailPage from "@/pages/market/detail";

export function AppRoutes() {
    return (
        <Routes>
            {/* 公開首頁：所有訪客（含未登入）都看得到，不做 redirect */}
            <Route
                path="/"
                element={
                    <PublicLayout>
                        <StorefrontPage />
                    </PublicLayout>
                }
            />

            {/* 公開但使用 Layout 的路由 (如：媒合市場) */}
            <Route
                path="/market"
                element={
                    <AppLayout>
                        <MarketPage />
                    </AppLayout>
                }
            />
            <Route
                path="/market/:id"
                element={
                    <AppLayout>
                        <MarketDetailPage />
                    </AppLayout>
                }
            />

            {/* 公開與共享路由 (無需 Layout) */}
            {sharedRoutes.map((route) => (
                <Route key={route.path} path={route.path} element={route.element} />
            ))}

            {/* 後台路由 (需登入 + Layout) */}
            {adminRoutes.map((route) => (
                <Route
                    key={route.path}
                    path={route.path}
                    element={
                        <ProtectedRoute requireAdmin>
                            <AppLayout>{route.element}</AppLayout>
                        </ProtectedRoute>
                    }
                />
            ))}

            {/* FixEngineer 維修工作台路由 (需 fixengineer 身分 + Layout) */}
            {workshopRoutes.map((route) => (
                <Route
                    key={route.path}
                    path={route.path}
                    element={
                        <ProtectedRoute requireFixEngineer>
                            <AppLayout>{route.element}</AppLayout>
                        </ProtectedRoute>
                    }
                />
            ))}

            {/* 門市路由 (需登入 + Layout) */}
            {storeRoutes.map((route) => (
                <Route
                    key={route.path}
                    path={route.path}
                    element={
                        <ProtectedRoute>
                            <AppLayout>{route.element}</AppLayout>
                        </ProtectedRoute>
                    }
                />
            ))}
        </Routes>
    );
}
