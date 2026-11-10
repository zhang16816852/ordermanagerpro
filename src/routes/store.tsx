import { lazy, Suspense } from "react";
import { Navigate } from "react-router-dom";

const StoreDashboard = lazy(() => import("@/pages/store/Dashboard"));
const StoreOrderList = lazy(() => import("@/pages/store/StoreOrderList"));
const StoreCatalog = lazy(() => import("@/pages/store/Catalog"));
const StoreSalesNotes = lazy(() => import("@/pages/store/SalesNotes"));
const StoreCheckout = lazy(() => import("@/pages/store/Checkout"));
const StoreOrderEdit = lazy(() => import("@/pages/store/StoreOrderEdit"));
const StoreReceiving = lazy(() => import("@/pages/store/Receiving"));
const StoreTeam = lazy(() => import("@/pages/store/Team"));
const StoreAudit = lazy(() => import("@/pages/store/Audit"));
const StoreNotifications = lazy(() => import("@/pages/store/Notifications"));
const StoreAccounting = lazy(() => import("@/pages/store/Accounting"));
const MarketCreatePage = lazy(() => import("@/pages/market/create"));
const MyListingsPage = lazy(() => import("@/pages/market/my-listings"));
const StoreRepairOrders = lazy(() => import("@/pages/store/repair-orders/index"));
const StoreRepairOrderNew = lazy(() => import("@/pages/store/repair-orders/new"));
const StoreRepairOrderEdit = lazy(() => import("@/pages/store/repair-orders/new"));
const StoreRepairOrderDetail = lazy(() => import("@/pages/store/repair-orders/detail"));

const PageFallback = () => <div className="flex items-center justify-center min-h-[50vh] text-muted-foreground">載入中...</div>;
export const storeRoutes = [
    { path: "/dashboard", element: <Suspense fallback={<PageFallback />}><StoreDashboard /></Suspense> },
    { path: "/orders", element: <Suspense fallback={<PageFallback />}><StoreOrderList /></Suspense> },
    { path: "/cart", element: <Suspense fallback={<PageFallback />}><StoreCheckout /></Suspense> },
    { path: "/orders/:orderId/edit", element: <Suspense fallback={<PageFallback />}><StoreOrderEdit /></Suspense> },
    { path: "/catalog", element: <Suspense fallback={<PageFallback />}><StoreCatalog /></Suspense> },
    { path: "/sales-notes", element: <Suspense fallback={<PageFallback />}><StoreSalesNotes /></Suspense> },
    { path: "/consignment-sales", element: <Navigate to="/sales-notes" replace /> },
    { path: "/receiving", element: <Suspense fallback={<PageFallback />}><StoreReceiving /></Suspense> },
    { path: "/team", element: <Suspense fallback={<PageFallback />}><StoreTeam /></Suspense> },
    { path: "/audit", element: <Suspense fallback={<PageFallback />}><StoreAudit /></Suspense> },
    { path: "/notifications", element: <Suspense fallback={<PageFallback />}><StoreNotifications /></Suspense> },
    { path: "/accounting", element: <Suspense fallback={<PageFallback />}><StoreAccounting /></Suspense> },
    { path: "/market/create", element: <Suspense fallback={<PageFallback />}><MarketCreatePage /></Suspense> },
    { path: "/market/my-listings", element: <Suspense fallback={<PageFallback />}><MyListingsPage /></Suspense> },
    { path: "/dashboard/repair-orders", element: <Suspense fallback={<PageFallback />}><StoreRepairOrders /></Suspense> },
    { path: "/dashboard/repair-orders/new", element: <Suspense fallback={<PageFallback />}><StoreRepairOrderNew /></Suspense> },
    { path: "/dashboard/repair-orders/:id", element: <Suspense fallback={<PageFallback />}><StoreRepairOrderDetail /></Suspense> },
    { path: "/dashboard/repair-orders/:id/edit", element: <Suspense fallback={<PageFallback />}><StoreRepairOrderEdit /></Suspense> },
];
