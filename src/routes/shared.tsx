import { Route } from "react-router-dom";
import Auth from "@/pages/Auth";
import AcceptInvite from "@/pages/AcceptInvite";
import SharedOrder from "@/pages/share/SharedOrder";
import SharedSales from "@/pages/share/SharedSales";
import NotFound from "@/pages/NotFound";

export const sharedRoutes = [
    { path: "/auth", element: <Auth /> },
    { path: "/invite/:token", element: <AcceptInvite /> },
    { path: "/share/order/:orderId", element: <SharedOrder /> },
    { path: "/share/sale/:salesNoteId", element: <SharedSales /> },
    { path: "*", element: <NotFound /> },
];
