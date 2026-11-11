import { lazy, Suspense } from "react";
import { Navigate } from "react-router-dom";

const AdminDashboard = lazy(() => import("@/pages/admin/Dashboard"));
const AdminOrderList = lazy(() => import("@/pages/admin/orders/list/OrderListPage"));
const AdminProducts = lazy(() => import("@/pages/admin/products/ProductsPage"));
const AdminProductFormPage = lazy(() => import("@/pages/admin/products/ProductFormPage"));
const AdminStores = lazy(() => import("@/pages/admin/Stores"));
const AdminStoreDetail = lazy(() => import("@/pages/admin/stores/StoreDetailPage"));
const AdminOrderForm = lazy(() => import("@/pages/admin/AdminOrderForm"));
const AdminSalesNotes = lazy(() => import("@/pages/admin/SalesNotes"));
const AdminShippingPool = lazy(() => import("@/pages/admin/ShippingPool"));
const AdminStorePricing = lazy(() => import("@/pages/admin/BrandPricing"));
const AdminAccounting = lazy(() => import("@/pages/admin/accounting/AccountingPage"));
const AdminPurchaseOrders = lazy(() => import("@/pages/admin/purchase-orders/PurchaseOrdersPage"));
const AdminCrossBorder = lazy(() => import("@/pages/admin/cross-border/CrossBorderPage"));
const AdminConsignment = lazy(() => import("@/pages/admin/consignment/ConsignmentPage"));
const AdminCategories = lazy(() => import("@/pages/admin/categories/CategoriesPage"));
const CategoryEditor = lazy(() => import("@/pages/admin/categories/CategoryEditor"));
const AdminInventory = lazy(() => import("@/pages/admin/inventory/InventoryPage"));
const AdminAuditLogs = lazy(() => import("@/pages/admin/audit-logs/AuditLogsPage"));
const AdminOrderGridTemplates = lazy(() => import("@/pages/admin/order-grid-templates/OrderGridTemplatesPage"));
const AdminRepairOrders = lazy(() => import("@/pages/admin/repair-orders/RepairOrdersPage"));
const AdminRepairOrderNew = lazy(() => import("@/pages/admin/repair-orders/new"));
const AdminRepairOrderEdit = lazy(() => import("@/pages/admin/repair-orders/new"));
const AdminRepairOrderDetail = lazy(() => import("@/pages/admin/repair-orders/detail"));
const AdminRepairParts = lazy(() => import("@/pages/admin/repair-parts/RepairPartsPage"));
const AdminReps = lazy(() => import("@/pages/admin/Reps"));
const RepCommissionPage = lazy(() => import("@/pages/admin/RepCommissionPage"));
const MyCommissionPage = lazy(() => import("@/pages/admin/MyCommissionPage"));
const AdminLogistics = lazy(() => import("@/pages/admin/logistics/LogisticsPage"));
const AdminStorefront = lazy(() => import("@/pages/admin/storefront/StorefrontEditorPage"));
const AdminNotificationBots = lazy(() => import("@/pages/admin/NotificationBotsPage"));

const PageFallback = () => <div className="flex items-center justify-center min-h-[50vh] text-muted-foreground">載入中...</div>;

export const adminRoutes = [
    { path: "/admin", element: <Suspense fallback={<PageFallback />}><AdminDashboard /></Suspense> },
    { path: "/admin/inventory", element: <Suspense fallback={<PageFallback />}><AdminInventory /></Suspense> },
    { path: "/admin/products", element: <Suspense fallback={<PageFallback />}><AdminProducts /></Suspense> },
    { path: "/admin/products/new", element: <Suspense fallback={<PageFallback />}><AdminProductFormPage /></Suspense> },
    { path: "/admin/products/:productId/edit", element: <Suspense fallback={<PageFallback />}><AdminProductFormPage /></Suspense> },
    { path: "/admin/categories", element: <Suspense fallback={<PageFallback />}><AdminCategories /></Suspense> },
    { path: "/admin/categories/new", element: <Suspense fallback={<PageFallback />}><CategoryEditor /></Suspense> },
    { path: "/admin/categories/:categoryId", element: <Suspense fallback={<PageFallback />}><CategoryEditor /></Suspense> },
    { path: "/admin/stores", element: <Suspense fallback={<PageFallback />}><AdminStores /></Suspense> },
{ path: "/admin/stores/:storeId", element: <Suspense fallback={<PageFallback />}><AdminStoreDetail /></Suspense> },
    { path: "/admin/reps", element: <Suspense fallback={<PageFallback />}><AdminReps /></Suspense> },
    { path: "/admin/reps/:userId/commission", element: <Suspense fallback={<PageFallback />}><RepCommissionPage /></Suspense> },
    { path: "/admin/my-commission", element: <Suspense fallback={<PageFallback />}><MyCommissionPage /></Suspense> },
    { path: "/admin/orders", element: <Suspense fallback={<PageFallback />}><AdminOrderList /></Suspense> },
    { path: "/admin/orders/checkout", element: <Suspense fallback={<PageFallback />}><AdminOrderForm /></Suspense> },
    { path: "/admin/orders/:orderId/edit", element: <Suspense fallback={<PageFallback />}><AdminOrderForm /></Suspense> },
    { path: "/admin/sales-notes", element: <Suspense fallback={<PageFallback />}><AdminSalesNotes /></Suspense> },
    { path: "/admin/shipping-pool", element: <Suspense fallback={<PageFallback />}><AdminShippingPool /></Suspense> },
    { path: "/admin/brand-pricing", element: <Suspense fallback={<PageFallback />}><AdminStorePricing /></Suspense> },
    { path: "/admin/accounting", element: <Suspense fallback={<PageFallback />}><AdminAccounting /></Suspense> },
    { path: "/admin/logistics", element: <Suspense fallback={<PageFallback />}><AdminLogistics /></Suspense> },
    { path: "/admin/storefront", element: <Suspense fallback={<PageFallback />}><AdminStorefront /></Suspense> },
    { path: "/admin/notification-bots", element: <Suspense fallback={<PageFallback />}><AdminNotificationBots /></Suspense> },
    { path: "/admin/shipping-settlements", element: <Navigate to="/admin/logistics?tab=shipping-settlements" replace /> },
    { path: "/admin/delivery-methods", element: <Navigate to="/admin/logistics?tab=delivery-methods" replace /> },
    { path: "/admin/purchase-orders", element: <Suspense fallback={<PageFallback />}><AdminPurchaseOrders /></Suspense> },
    { path: "/admin/cross-border", element: <Suspense fallback={<PageFallback />}><AdminCrossBorder /></Suspense> },
    { path: "/admin/purchase-orders/:orderId/edit", element: <Suspense fallback={<PageFallback />}><AdminOrderForm /></Suspense> },
    { path: "/admin/consignment", element: <Suspense fallback={<PageFallback />}><AdminConsignment /></Suspense> },
    { path: "/admin/audit-logs", element: <Suspense fallback={<PageFallback />}><AdminAuditLogs /></Suspense> },
    { path: "/admin/order-grid-templates", element: <Suspense fallback={<PageFallback />}><AdminOrderGridTemplates /></Suspense> },
    { path: "/admin/repair-orders", element: <Suspense fallback={<PageFallback />}><AdminRepairOrders /></Suspense> },
    { path: "/admin/repair-orders/new", element: <Suspense fallback={<PageFallback />}><AdminRepairOrderNew /></Suspense> },
    { path: "/admin/repair-orders/:id", element: <Suspense fallback={<PageFallback />}><AdminRepairOrderDetail /></Suspense> },
    { path: "/admin/repair-orders/:id/edit", element: <Suspense fallback={<PageFallback />}><AdminRepairOrderEdit /></Suspense> },
  { path: "/admin/repair-parts", element: <Suspense fallback={<PageFallback />}><AdminRepairParts /></Suspense> },
];
