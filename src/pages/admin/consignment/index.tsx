import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useConsignment } from './hooks/useConsignment';
import { OrderListTab } from './components/OrderListTab';
import { CreateOrderDialog } from './components/CreateOrderDialog';
import { OrderDetailDialog } from './components/OrderDetailDialog';
import { ReportsTab } from './components/ReportsTab';
import { ConsignmentOrder } from './types';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, ClipboardList, ClipboardCheck } from 'lucide-react';

export default function AdminConsignment() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'orders');
  const [createOpen, setCreateOpen] = useState(false);
  const [viewingOrder, setViewingOrder] = useState<ConsignmentOrder | null>(null);
  const {
    orders,
    ordersLoading,
    pendingReports,
    reportsLoading,
  } = useConsignment();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">寄賣管理</h1>
          <p className="text-muted-foreground">管理廠商寄賣收貨與店家寄賣出貨、銷售回報審核與結算</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" /> 建立寄賣單
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => {
        setActiveTab(v);
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.set("tab", v);
          return next;
        }, { replace: true });
      }} className="space-y-4">
        <TabsList>
          <TabsTrigger value="orders" className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4" /> 寄賣單
          </TabsTrigger>
          <TabsTrigger value="reports" className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4" />
            銷售回報審核
            {pendingReports.length > 0 && (
              <span className="ml-1 rounded-full bg-destructive text-destructive-foreground text-xs px-1.5">
                {pendingReports.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="orders" className="space-y-4">
          <OrderListTab
            orders={orders}
            onView={(order) => setViewingOrder(order)}
            isLoading={ordersLoading}
          />
        </TabsContent>

        <TabsContent value="reports" className="space-y-4">
          <ReportsTab
            reports={pendingReports}
            isLoading={reportsLoading}
          />
        </TabsContent>
      </Tabs>

      <CreateOrderDialog open={createOpen} onOpenChange={setCreateOpen} />

      <OrderDetailDialog
        order={viewingOrder}
        onClose={() => setViewingOrder(null)}
      />
    </div>
  );
}
