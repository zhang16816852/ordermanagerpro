import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/layout/AppLayout";
import { Loader2 } from "lucide-react";

import { adminRoutes } from "./admin";
import { storeRoutes } from "./store";
import { sharedRoutes } from "./shared";

function RootRedirect() {
    const { user, isAdmin, loading } = useAuth();

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    if (!user) {
        return <Navigate to="/auth" replace />;
    }

    return isAdmin ?
        <Navigate to="/admin" replace /> :
        <Navigate to="/dashboard" replace />;
}

export function AppRoutes() {
    return (
        <Routes>
            {/* 根路徑與重定向 */}
            <Route path="/" element={<RootRedirect />} />

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
                        <ProtectedRoute>
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
