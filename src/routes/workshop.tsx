import { lazy, Suspense } from "react";

const WorkshopRepairOrders = lazy(() => import("@/pages/admin/repair-orders/RepairOrdersPage"));
const WorkshopRepairOrderNew = lazy(() => import("@/pages/admin/repair-orders/new"));
const WorkshopRepairOrderEdit = lazy(() => import("@/pages/admin/repair-orders/new"));
const WorkshopRepairOrderDetail = lazy(() => import("@/pages/admin/repair-orders/detail"));

const PageFallback = () => <div className="flex items-center justify-center min-h-[50vh] text-muted-foreground">載入中...</div>;

// FixEngineer（維修人員）獨立工作台路由
export const workshopRoutes = [
    { path: "/workshop", element: <Suspense fallback={<PageFallback />}><WorkshopRepairOrders /></Suspense> },
    { path: "/workshop/new", element: <Suspense fallback={<PageFallback />}><WorkshopRepairOrderNew /></Suspense> },
    { path: "/workshop/:id", element: <Suspense fallback={<PageFallback />}><WorkshopRepairOrderDetail /></Suspense> },
    { path: "/workshop/:id/edit", element: <Suspense fallback={<PageFallback />}><WorkshopRepairOrderEdit /></Suspense> },
];