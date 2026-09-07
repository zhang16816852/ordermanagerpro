import WorkshopRepairOrders from "@/pages/admin/repair-orders/RepairOrdersPage";
import WorkshopRepairOrderNew from "@/pages/admin/repair-orders/new";
import WorkshopRepairOrderEdit from "@/pages/admin/repair-orders/new";
import WorkshopRepairOrderDetail from "@/pages/admin/repair-orders/detail";

// FixEngineer（維修人員）獨立工作台路由
export const workshopRoutes = [
    { path: "/workshop", element: <WorkshopRepairOrders /> },
    { path: "/workshop/new", element: <WorkshopRepairOrderNew /> },
    { path: "/workshop/:id", element: <WorkshopRepairOrderDetail /> },
    { path: "/workshop/:id/edit", element: <WorkshopRepairOrderEdit /> },
];