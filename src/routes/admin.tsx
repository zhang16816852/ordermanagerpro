import AdminDashboard from "@/pages/admin/Dashboard";
import AdminOrderList from "@/pages/admin/orders/list/OrderListPage";
import AdminProducts from "@/pages/admin/products/ProductsPage";
import AdminProductFormPage from "@/pages/admin/products/ProductFormPage";
import AdminStores from "@/pages/admin/Stores";
import AdminOrderComposer from "@/pages/admin/OrderComposer";
import AdminOrderForm from "@/pages/admin/AdminOrderForm";
import AdminSalesNotes from "@/pages/admin/SalesNotes";
import AdminShippingPool from "@/pages/admin/ShippingPool";
import AdminStorePricing from "@/pages/admin/BrandPricing";
import AdminAccounting from "@/pages/admin/accounting/AccountingPage";
import AdminPurchaseOrders from "@/pages/admin/purchase-orders/PurchaseOrdersPage";
import AdminConsignment from "@/pages/admin/consignment/ConsignmentPage";
import AdminCategories from "@/pages/admin/categories/CategoriesPage";
import CategoryEditor from "@/pages/admin/categories/CategoryEditor";
import AdminInventory from "@/pages/admin/inventory/InventoryPage";
import AdminAuditLogs from "@/pages/admin/audit-logs/AuditLogsPage";
import AdminOrderGridTemplates from "@/pages/admin/order-grid-templates/OrderGridTemplatesPage";
import AdminRepairOrders from "@/pages/admin/repair-orders/RepairOrdersPage";
import AdminRepairOrderNew from "@/pages/admin/repair-orders/new";
import AdminRepairOrderEdit from "@/pages/admin/repair-orders/new";
import AdminRepairOrderDetail from "@/pages/admin/repair-orders/detail";
import AdminReps from "@/pages/admin/Reps";

export const adminRoutes = [
    { path: "/admin", element: <AdminDashboard /> },
    { path: "/admin/inventory", element: <AdminInventory /> },
    { path: "/admin/products", element: <AdminProducts /> },
    { path: "/admin/products/new", element: <AdminProductFormPage /> },
    { path: "/admin/products/:productId/edit", element: <AdminProductFormPage /> },
    { path: "/admin/categories", element: <AdminCategories /> },
    { path: "/admin/categories/new", element: <CategoryEditor /> },
    { path: "/admin/categories/:categoryId", element: <CategoryEditor /> },
    { path: "/admin/stores", element: <AdminStores /> },
    { path: "/admin/reps", element: <AdminReps /> },
    { path: "/admin/orders", element: <AdminOrderList /> },
    { path: "/admin/orders/new", element: <AdminOrderComposer /> },
    { path: "/admin/orders/checkout", element: <AdminOrderForm /> },
    { path: "/admin/orders/:orderId/edit", element: <AdminOrderForm /> },
    { path: "/admin/sales-notes", element: <AdminSalesNotes /> },
    { path: "/admin/shipping-pool", element: <AdminShippingPool /> },
    { path: "/admin/brand-pricing", element: <AdminStorePricing /> },
    { path: "/admin/accounting", element: <AdminAccounting /> },
    { path: "/admin/purchase-orders", element: <AdminPurchaseOrders /> },
    { path: "/admin/consignment", element: <AdminConsignment /> },
    { path: "/admin/audit-logs", element: <AdminAuditLogs /> },
    { path: "/admin/order-grid-templates", element: <AdminOrderGridTemplates /> },
    { path: "/admin/repair-orders", element: <AdminRepairOrders /> },
    { path: "/admin/repair-orders/new", element: <AdminRepairOrderNew /> },
    { path: "/admin/repair-orders/:id", element: <AdminRepairOrderDetail /> },
    { path: "/admin/repair-orders/:id/edit", element: <AdminRepairOrderEdit /> },
];
