import AdminDashboard from "@/pages/admin/Dashboard";
import AdminOrderList from "@/pages/admin/orders/list/index";
import AdminProducts from "@/pages/admin/products/index";
import AdminStores from "@/pages/admin/Stores";
import AdminOrderComposer from "@/pages/admin/OrderComposer";
import AdminOrderEdit from "@/pages/admin/AdminOrderEdit";
import AdminSalesNotes from "@/pages/admin/SalesNotes";
import AdminShippingPool from "@/pages/admin/ShippingPool";
import AdminStorePricing from "@/pages/admin/BrandPricing";
import AdminAccounting from "@/pages/admin/accounting/index";
import AdminPurchaseOrders from "@/pages/admin/purchase-orders/index";
import AdminCategories from "@/pages/admin/categories/index";
import AdminInventory from "@/pages/admin/inventory/index";
import AdminAuditLogs from "@/pages/admin/audit-logs/index";
import AdminOrderGridTemplates from "@/pages/admin/order-grid-templates/index";
import AdminRepairOrders from "@/pages/admin/repair-orders/index";
import AdminRepairOrderNew from "@/pages/admin/repair-orders/new";
import AdminRepairOrderEdit from "@/pages/admin/repair-orders/new";
import AdminRepairOrderDetail from "@/pages/admin/repair-orders/detail";

export const adminRoutes = [
    { path: "/admin", element: <AdminDashboard /> },
    { path: "/admin/inventory", element: <AdminInventory /> },
    { path: "/admin/products", element: <AdminProducts /> },
    { path: "/admin/categories", element: <AdminCategories /> },
    { path: "/admin/stores", element: <AdminStores /> },
    { path: "/admin/orders", element: <AdminOrderList /> },
    { path: "/admin/orders/new", element: <AdminOrderComposer /> },
    { path: "/admin/orders/:orderId/edit", element: <AdminOrderEdit /> },
    { path: "/admin/sales-notes", element: <AdminSalesNotes /> },
    { path: "/admin/shipping-pool", element: <AdminShippingPool /> },
    { path: "/admin/brand-pricing", element: <AdminStorePricing /> },
    { path: "/admin/accounting", element: <AdminAccounting /> },
    { path: "/admin/purchase-orders", element: <AdminPurchaseOrders /> },
    { path: "/admin/audit-logs", element: <AdminAuditLogs /> },
    { path: "/admin/order-grid-templates", element: <AdminOrderGridTemplates /> },
    { path: "/admin/repair-orders", element: <AdminRepairOrders /> },
    { path: "/admin/repair-orders/new", element: <AdminRepairOrderNew /> },
    { path: "/admin/repair-orders/:id", element: <AdminRepairOrderDetail /> },
    { path: "/admin/repair-orders/:id/edit", element: <AdminRepairOrderEdit /> },
];
