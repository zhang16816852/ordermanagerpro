import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search, Package, Truck, List, LayoutGrid } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { OrderDetailDialog } from '@/components/order/OrderDetailDialog';
import { OrdersTableView } from '@/components/order/OrdersTableView';
import { OrdersCardView } from '@/components/order/OrdersCardView';
import { ItemsTableView } from '@/components/order/ItemsTableView';
import { ItemsCardView } from '@/components/order/ItemsCardView';
import { Order, OrderItem } from '@/types/order';

const statusLabels: Record<string, { label: string; className: string }> = {
  waiting: { label: '待出貨', className: 'bg-status-waiting text-warning-foreground' },
  partial: { label: '部分出貨', className: 'bg-status-partial text-primary-foreground' },
  shipped: { label: '已出貨', className: 'bg-status-shipped text-success-foreground' },
  out_of_stock: { label: '缺貨', className: 'bg-status-out-of-stock text-destructive-foreground' },
  discontinued: { label: '已停售', className: 'bg-status-discontinued text-muted-foreground' },
  cancelled: { label: '已取消', className: 'bg-status-cancelled text-muted-foreground' },
};

const orderStatusLabels: Record<string, { label: string; className: string }> = {
  pending: { label: '未確認', className: 'bg-warning text-warning-foreground' },
  processing: { label: '處理中', className: 'bg-primary text-primary-foreground' },
  shipped: { label: '已出貨', className: 'bg-success text-success-foreground' },
};

export default function StoreOrderList() {
  const navigate = useNavigate();
  const { storeRoles } = useAuth();
  const storeId = storeRoles[0]?.store_id;
  const [search, setSearch] = useState('');
  const [productFilter, setProductFilter] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [statusTab, setStatusTab] = useState<'pending' | 'processing' | 'shipped'>('pending');
  const [viewMode, setViewMode] = useState<'orders' | 'items'>('orders');

  const { data: orders, isLoading } = useQuery({
    queryKey: ['store-orders', storeId, statusTab],
    queryFn: async () => {
      if (!storeId) return [];
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id,
          code,
          created_at,
          status,
          notes,
          order_items (
            id,
            quantity,
            shipped_quantity,
            unit_price,
            status,
            product:products (name, sku),
            product_variant:product_variants (name)
          )
        `)
        .eq('store_id', storeId)
        .eq('status', statusTab)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as unknown as Order[];
    },
    enabled: !!storeId,
  });

  // 獲取所有商品項目（用於商品視圖）
  const allItems = orders?.flatMap(order =>
    order.order_items
      .filter(item => {
        if (!productFilter) return true;
        const searchLower = productFilter.toLowerCase();
        return (
          item.product?.name.toLowerCase().includes(searchLower) ||
          item.product?.sku.toLowerCase().includes(searchLower)
        );
      })
      .map(item => ({
        ...item,
        orderId: order.id,
        orderCreatedAt: order.created_at,
        orderStatus: order.status,
      }))
  ) || [];

  const filteredOrders = orders?.filter((order) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      order.id.toLowerCase().includes(searchLower) ||
      (order.code && order.code.toLowerCase().includes(searchLower)) ||
      order.order_items.some((item) =>
        item.product?.name.toLowerCase().includes(searchLower) ||
        item.product?.sku.toLowerCase().includes(searchLower)
      )
    );
  });

  const getOrderShipmentStatus = (items: OrderItem[]) => {
    if (items.length === 0) return 'waiting';
    const allShipped = items.every((i) => i.status === 'shipped');
    const someShipped = items.some((i) => i.shipped_quantity > 0);
    if (allShipped) return 'shipped';
    if (someShipped) return 'partial';
    return 'waiting';
  };

  const getOrderTotal = (items: OrderItem[]) => {
    return items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
  };

  if (!storeId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">您尚未被指派到任何店鋪</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] space-y-4 p-4 md:p-6 ">
      <div className="flex-none">
        <h1 className="text-2xl font-bold tracking-tight">我的訂單</h1>
        <p className="text-muted-foreground">查看您的所有訂單</p>
      </div>

      {/* 狀態 Tabs */}
      <Tabs value={statusTab} onValueChange={(v) => setStatusTab(v as 'pending' | 'processing' | 'shipped')}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between flex-none">
          <TabsList>
            <TabsTrigger value="pending" className="gap-2">
              <Package className="h-4 w-4" />
              未確認
            </TabsTrigger>
            <TabsTrigger value="processing" className="gap-2">
              <Truck className="h-4 w-4" />
              處理中
            </TabsTrigger>
            <TabsTrigger value="shipped" className="gap-2">
              <Truck className="h-4 w-4" />
              已出貨
            </TabsTrigger>
          </TabsList>

          {/* 視圖切換 */}
          <div className="flex items-center gap-2">
            <Button
              variant={viewMode === 'orders' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('orders')}
            >
              <List className="h-4 w-4 mr-1" />
              訂單
            </Button>
            <Button
              variant={viewMode === 'items' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('items')}
            >
              <LayoutGrid className="h-4 w-4 mr-1" />
              商品
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-4 mt-4 flex-none">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={viewMode === 'orders' ? "搜尋訂單編號或產品..." : "搜尋產品名稱或 SKU..."}
              value={viewMode === 'orders' ? search : productFilter}
              onChange={(e) => viewMode === 'orders' ? setSearch(e.target.value) : setProductFilter(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <TabsContent value={statusTab} className="flex-1 mt-4 min-h-0 flex flex-col">
          {viewMode === 'orders' ? (
            <>
              <OrdersTableView
                orders={filteredOrders}
                isLoading={isLoading}
                onView={setSelectedOrder}
                onEdit={(orderId) => navigate(`/orders/${orderId}/edit`)}
                getOrderShipmentStatus={getOrderShipmentStatus}
                getOrderTotal={getOrderTotal}
              />
              <OrdersCardView
                orders={filteredOrders}
                isLoading={isLoading}
                onView={setSelectedOrder}
                onEdit={(orderId) => navigate(`/orders/${orderId}/edit`)}
                getOrderShipmentStatus={getOrderShipmentStatus}
                getOrderTotal={getOrderTotal}
              />
            </>
          ) : (
            <>
              <ItemsTableView
                items={allItems}
                isLoading={isLoading}
                statusLabels={statusLabels}
              />
              <ItemsCardView
                items={allItems}
                isLoading={isLoading}
                statusLabels={statusLabels}
              />
            </>
          )}
        </TabsContent>
      </Tabs>

      <OrderDetailDialog
        order={selectedOrder}
        open={!!selectedOrder}
        onOpenChange={(open) => !open && setSelectedOrder(null)}
      />
    </div>
  );
}
