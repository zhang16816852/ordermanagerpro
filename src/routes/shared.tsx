import { lazy, Suspense } from "react";
import { Route } from "react-router-dom";

const Auth = lazy(() => import("@/pages/Auth"));
const AcceptInvite = lazy(() => import("@/pages/AcceptInvite"));
const SharedOrder = lazy(() => import("@/pages/share/SharedOrder"));
const SharedSales = lazy(() => import("@/pages/share/SharedSales"));
const SharedConsignment = lazy(() => import("@/pages/share/SharedConsignment"));
const SharedCustomerStatement = lazy(() => import("@/pages/share/SharedCustomerStatement"));
const NotFound = lazy(() => import("@/pages/NotFound"));

const PageFallback = () => <div className="flex items-center justify-center min-h-[50vh] text-muted-foreground">載入中...</div>;

export const sharedRoutes = [
    { path: "/auth", element: <Suspense fallback={<PageFallback />}><Auth /></Suspense> },
    { path: "/invite/:token", element: <Suspense fallback={<PageFallback />}><AcceptInvite /></Suspense> },
    { path: "/share/order/:orderId", element: <Suspense fallback={<PageFallback />}><SharedOrder /></Suspense> },
    { path: "/share/sale/:salesNoteId", element: <Suspense fallback={<PageFallback />}><SharedSales /></Suspense> },
    { path: "/share/consignment/:consignmentId", element: <Suspense fallback={<PageFallback />}><SharedConsignment /></Suspense> },
    { path: "/share/statement/:statementId", element: <Suspense fallback={<PageFallback />}><SharedCustomerStatement /></Suspense> },
    { path: "*", element: <Suspense fallback={<PageFallback />}><NotFound /></Suspense> },
];