import StoreDashboard from "@/pages/store/Dashboard";
import StoreOrderList from "@/pages/store/StoreOrderList";
import StoreCatalog from "@/pages/store/Catalog";
import StoreSalesNotes from "@/pages/store/SalesNotes";
import StoreCheckout from "@/pages/store/Checkout";
import StoreOrderEdit from "@/pages/store/StoreOrderEdit";
import StoreReceiving from "@/pages/store/Receiving";
import StoreTeam from "@/pages/store/Team";
import StoreAudit from "@/pages/store/Audit";
import StoreNotifications from "@/pages/store/Notifications";
import StoreAccounting from "@/pages/store/Accounting";

export const storeRoutes = [
    { path: "/dashboard", element: <StoreDashboard /> },
    { path: "/orders", element: <StoreOrderList /> },
    { path: "/cart", element: <StoreCheckout /> },
    { path: "/orders/:orderId/edit", element: <StoreOrderEdit /> },
    { path: "/catalog", element: <StoreCatalog /> },
    { path: "/sales-notes", element: <StoreSalesNotes /> },
    { path: "/receiving", element: <StoreReceiving /> },
    { path: "/team", element: <StoreTeam /> },
    { path: "/audit", element: <StoreAudit /> },
    { path: "/notifications", element: <StoreNotifications /> },
    { path: "/accounting", element: <StoreAccounting /> },
];
