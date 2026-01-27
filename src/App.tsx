import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/layout/AppLayout";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";
import { Loader2 } from "lucide-react";

// Admin pages
import AdminDashboard from "./pages/admin/Dashboard";
import AdminOrderList from "./pages/admin/AdminOrderList";
import AdminProducts from "./pages/admin/Products";
import AdminStores from "./pages/admin/Stores";
import AdminOrders from "./pages/admin/AdminOrderList"; // Keep alias if needed or refactor usage
import AdminOrderComposer from "./pages/admin/OrderComposer";
import AdminOrderEdit from "./pages/admin/AdminOrderEdit";
import AdminSalesNotes from "./pages/admin/SalesNotes";
import AdminShippingPool from "./pages/admin/ShippingPool";
import AdminUsers from "./pages/admin/Users";
import AdminBrandPricing from "./pages/admin/BrandPricing";
import AdminAccounting from "./pages/admin/Accounting";
import AdminPurchaseOrders from "./pages/admin/PurchaseOrders";

// Store pages
import StoreDashboard from "./pages/store/Dashboard";
import StoreOrderList from "./pages/store/StoreOrderList";
import StoreCatalog from "./pages/store/Catalog";
import StoreSalesNotes from "./pages/store/SalesNotes";
import StoreCheckout from "./pages/store/Checkout";
import StoreOrderEdit from "./pages/store/StoreOrderEdit";
import StoreReceiving from "./pages/store/Receiving";
import StoreTeam from "./pages/store/Team";
import StoreAudit from "./pages/store/Audit";
import StoreNotifications from "./pages/store/Notifications";
import StoreAccounting from "./pages/store/Accounting";
import AcceptInvite from "./pages/AcceptInvite";

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

const queryClient = new QueryClient();

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/auth" element={<Auth />} />
      <Route path="/invite/:token" element={<AcceptInvite />} />

      {/* Admin Routes */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <AppLayout>
              <AdminDashboard />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/products"
        element={
          <ProtectedRoute>
            <AppLayout>
              <AdminProducts />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/stores"
        element={
          <ProtectedRoute>
            <AppLayout>
              <AdminStores />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/orders"
        element={
          <ProtectedRoute>
            <AppLayout>
              <AdminOrderList />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/orders/new"
        element={
          <ProtectedRoute>
            <AppLayout>
              <AdminOrderComposer />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/orders/:orderId/edit"
        element={
          <ProtectedRoute>
            <AppLayout>
              <AdminOrderEdit />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/sales-notes"
        element={
          <ProtectedRoute>
            <AppLayout>
              <AdminSalesNotes />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/shipping-pool"
        element={
          <ProtectedRoute>
            <AppLayout>
              <AdminShippingPool />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/users"
        element={
          <ProtectedRoute>
            <AppLayout>
              <AdminUsers />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/brand-pricing"
        element={
          <ProtectedRoute>
            <AppLayout>
              <AdminBrandPricing />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/accounting"
        element={
          <ProtectedRoute>
            <AppLayout>
              <AdminAccounting />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/purchase-orders"
        element={
          <ProtectedRoute>
            <AppLayout>
              <AdminPurchaseOrders />
            </AppLayout>
          </ProtectedRoute>
        }
      />

      {/* Store Routes */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <AppLayout>
              <StoreDashboard />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/orders"
        element={
          <ProtectedRoute>
            <AppLayout>
              <StoreOrderList />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/cart"
        element={
          <ProtectedRoute>
            <AppLayout>
              <StoreCheckout />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/orders/:orderId/edit"
        element={
          <ProtectedRoute>
            <AppLayout>
              <StoreOrderEdit />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/catalog"
        element={
          <ProtectedRoute>
            <AppLayout>
              <StoreCatalog />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/sales-notes"
        element={
          <ProtectedRoute>
            <AppLayout>
              <StoreSalesNotes />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/receiving"
        element={
          <ProtectedRoute>
            <AppLayout>
              <StoreReceiving />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/team"
        element={
          <ProtectedRoute>
            <AppLayout>
              <StoreTeam />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/audit"
        element={
          <ProtectedRoute>
            <AppLayout>
              <StoreAudit />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/notifications"
        element={
          <ProtectedRoute>
            <AppLayout>
              <StoreNotifications />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/accounting"
        element={
          <ProtectedRoute>
            <AppLayout>
              <StoreAccounting />
            </AppLayout>
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
