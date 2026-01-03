import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Search, Eye, Plus, Pencil, Package, Truck, List, LayoutGrid } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

interface OrderWithDetails {
  id: string;
  created_at: string;
  source_type: 'frontend' | 'admin_proxy';
  status: 'pending' | 'processing';
  notes: string | null;
  store_id: string;
  stores: { name: string; code: string | null } | null;
  order_items: {
    id: string;
    quantity: number;
    shipped_quantity: number;
    unit_price: number;
    status: string;
    store_id: string;
    products: { name: string; sku: string } | null;
  }[];
}

interface ShipmentSelection {
  itemId: string;
  quantity: number;
  maxQuantity: number;
  productName: string;
  sku: string;
  storeId: string;
  storeName: string;
}

const statusLabels: Record<string, { label: string; className: string }> = {
  waiting: { label: '待出貨', className: 'bg-status-waiting text-warning-foreground' },
  partial: { label: '部分出貨', className: 'bg-status-partial text-primary-foreground' },
  shipped: { label: '已出貨', className: 'bg-status-shipped text-success-foreground' },
  out_of_stock: { label: '缺貨', className: 'bg-status-out-of-stock text-destructive-foreground' },
  discontinued: { label: '已停售', className: 'bg-status-discontinued text-muted-foreground' },
};

const orderStatusLabels: Record<string, { label: string; className: string }> = {
  pending: { label: '未確認', className: 'bg-warning text-warning-foreground' },
  processing: { label: '處理中', className: 'bg-primary text-primary-foreground' },
};

export default function AdminOrders() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [storeFilter, setStoreFilter] = useState<string>('all');
  const [productFilter, setProductFilter] = useState<string>('');
  const [selectedOrder, setSelectedOrder] = useState<OrderWithDetails | null>(null);
  const [statusTab, setStatusTab] = useState<'pending' | 'processing'>('pending');
  const [viewMode, setViewMode] = useState<'orders' | 'items'>('orders');
  
  // 出貨選擇
  const [selectedItems, setSelectedItems] = useState<Map<string, ShipmentSelection>>(new Map());
  const [showShipDialog, setShowShipDialog] = useState(false);

  const { data: stores } = useQuery({
    queryKey: ['stores-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stores')
        .select('id, name, code')
        .order('name');
      if (error) throw error;
      return data;
    },
  });

  const { data: orders, isLoading } = useQuery({
    queryKey: ['admin-orders', storeFilter, statusTab],
    queryFn: async () => {
      let query = supabase
        .from('orders')
        .select(`
          id,
          created_at,
          source_type,
          status,
          notes,
          store_id,
          stores (name, code),
          order_items (
            id,
            quantity,
            shipped_quantity,
            unit_price,
            status,
            store_id,
            products (name, sku)
          )
        `)
        .eq('status', statusTab)
        .order('created_at', { ascending: false });

      if (storeFilter && storeFilter !== 'all') {
        query = query.eq('store_id', storeFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as OrderWithDetails[];
    },
  });

  // 獲取所有待出貨的項目（用於商品視圖）
  const allPendingItems = orders?.flatMap(order => 
    order.order_items
      .filter(item => item.quantity > item.shipped_quantity)
      .filter(item => {
        if (!productFilter) return true;
        const searchLower = productFilter.toLowerCase();
        return (
          item.products?.name.toLowerCase().includes(searchLower) ||
          item.products?.sku.toLowerCase().includes(searchLower)
        );
      })
      .map(item => ({
        ...item,
        orderId: order.id,
        orderCreatedAt: order.created_at,
        storeName: order.stores?.name || '',
        storeCode: order.stores?.code || '',
        storeId: order.store_id,
      }))
  ) || [];

  const filteredOrders = orders?.filter((order) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      order.stores?.name.toLowerCase().includes(searchLower) ||
      order.stores?.code?.toLowerCase().includes(searchLower) ||
      order.id.toLowerCase().includes(searchLower)
    );
  });

  const getOrderShipmentStatus = (items: OrderWithDetails['order_items']) => {
    if (items.length === 0) return 'waiting';
    const allShipped = items.every((i) => i.status === 'shipped');
    const someShipped = items.some((i) => i.shipped_quantity > 0);
    if (allShipped) return 'shipped';
    if (someShipped) return 'partial';
    return 'waiting';
  };

  const getOrderTotal = (items: OrderWithDetails['order_items']) => {
    return items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
  };

  const toggleItemSelection = (item: typeof allPendingItems[0], checked: boolean) => {
    const newMap = new Map(selectedItems);
    if (checked) {
      newMap.set(item.id, {
        itemId: item.id,
        quantity: item.quantity - item.shipped_quantity,
        maxQuantity: item.quantity - item.shipped_quantity,
        productName: item.products?.name || '',
        sku: item.products?.sku || '',
        storeId: item.storeId,
        storeName: item.storeName,
      });
    } else {
      newMap.delete(item.id);
    }
    setSelectedItems(newMap);
  };

  const updateItemQuantity = (itemId: string, quantity: number) => {
    const newMap = new Map(selectedItems);
    const item = newMap.get(itemId);
    if (item) {
      newMap.set(itemId, {
        ...item,
        quantity: Math.min(Math.max(1, quantity), item.maxQuantity),
      });
      setSelectedItems(newMap);
    }
  };

  // 按店家分組已選擇的項目
  const groupedSelections = Array.from(selectedItems.values()).reduce((acc, item) => {
    if (!acc[item.storeId]) {
      acc[item.storeId] = {
        storeName: item.storeName,
        items: [],
      };
    }
    acc[item.storeId].items.push(item);
    return acc;
  }, {} as Record<string, { storeName: string; items: ShipmentSelection[] }>);

  const addToShippingPoolMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('未登入');
      if (selectedItems.size === 0) throw new Error('請選擇至少一個項目');

      // 按店家分組建立銷售單
      for (const [storeId, group] of Object.entries(groupedSelections)) {
        // 建立銷售單
        const { data: salesNote, error: noteError } = await supabase
          .from('sales_notes')
          .insert({
            store_id: storeId,
            created_by: user.id,
            status: 'draft',
          })
          .select()
          .single();

        if (noteError) throw noteError;

        // 建立銷售單項目
        const noteItems = group.items.map(item => ({
          sales_note_id: salesNote.id,
          order_item_id: item.itemId,
          quantity: item.quantity,
        }));

        const { error: itemsError } = await supabase
          .from('sales_note_items')
          .insert(noteItems);

        if (itemsError) throw itemsError;
      }
    },
    onSuccess: () => {
      toast.success(`已加入出貨池，共 ${Object.keys(groupedSelections).length} 個店家`);
      setSelectedItems(new Map());
      setShowShipDialog(false);
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">所有訂單</h1>
          <p className="text-muted-foreground">查看與管理系統中的所有訂單</p>
        </div>
        <Button onClick={() => navigate('/admin/orders/new')}>
          <Plus className="mr-2 h-4 w-4" />
          代訂訂單
        </Button>
      </div>

      {/* 狀態 Tabs */}
      <Tabs value={statusTab} onValueChange={(v) => setStatusTab(v as 'pending' | 'processing')}>
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="pending" className="gap-2">
              <Package className="h-4 w-4" />
              未確認
            </TabsTrigger>
            <TabsTrigger value="processing" className="gap-2">
              <Truck className="h-4 w-4" />
              處理中
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

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mt-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={viewMode === 'orders' ? "搜尋訂單編號或店鋪..." : "搜尋產品名稱或 SKU..."}
              value={viewMode === 'orders' ? search : productFilter}
              onChange={(e) => viewMode === 'orders' ? setSearch(e.target.value) : setProductFilter(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={storeFilter} onValueChange={setStoreFilter}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="選擇店鋪" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部店鋪</SelectItem>
              {stores?.map((store) => (
                <SelectItem key={store.id} value={store.id}>
                  {store.code ? `${store.code} - ${store.name}` : store.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          {selectedItems.size > 0 && (
            <Button onClick={() => setShowShipDialog(true)}>
              <Truck className="h-4 w-4 mr-2" />
              加入出貨池 ({selectedItems.size})
            </Button>
          )}
        </div>

        <TabsContent value={statusTab} className="mt-4">
          {viewMode === 'orders' ? (
            // 訂單視圖
            <div className="rounded-lg border bg-card shadow-soft">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>訂單編號</TableHead>
                    <TableHead>店鋪</TableHead>
                    <TableHead>品項數</TableHead>
                    <TableHead className="text-right">金額</TableHead>
                    <TableHead>來源</TableHead>
                    <TableHead>出貨狀態</TableHead>
                    <TableHead>建立時間</TableHead>
                    <TableHead className="w-24"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-8" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                        <TableCell><Skeleton className="h-8 w-16" /></TableCell>
                      </TableRow>
                    ))
                  ) : filteredOrders?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                        沒有找到訂單
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredOrders?.map((order) => {
                      const itemStatus = getOrderShipmentStatus(order.order_items);
                      const itemStatusInfo = statusLabels[itemStatus];
                      return (
                        <TableRow key={order.id}>
                          <TableCell className="font-mono text-sm">
                            {order.id.slice(0, 8)}...
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{order.stores?.name}</div>
                            {order.stores?.code && (
                              <div className="text-xs text-muted-foreground">
                                {order.stores.code}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>{order.order_items.length}</TableCell>
                          <TableCell className="text-right font-medium">
                            ${getOrderTotal(order.order_items).toFixed(2)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {order.source_type === 'frontend' ? '前台' : '後台'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge className={itemStatusInfo.className}>
                              {itemStatusInfo.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {format(new Date(order.created_at), 'MM/dd HH:mm', { locale: zhTW })}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setSelectedOrder(order)}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => navigate(`/admin/orders/${order.id}/edit`)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          ) : (
            // 商品視圖
            <div className="rounded-lg border bg-card shadow-soft">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox
                        checked={allPendingItems.length > 0 && selectedItems.size === allPendingItems.length}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            const newMap = new Map();
                            allPendingItems.forEach(item => {
                              newMap.set(item.id, {
                                itemId: item.id,
                                quantity: item.quantity - item.shipped_quantity,
                                maxQuantity: item.quantity - item.shipped_quantity,
                                productName: item.products?.name || '',
                                sku: item.products?.sku || '',
                                storeId: item.storeId,
                                storeName: item.storeName,
                              });
                            });
                            setSelectedItems(newMap);
                          } else {
                            setSelectedItems(new Map());
                          }
                        }}
                      />
                    </TableHead>
                    <TableHead>店鋪</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>產品名稱</TableHead>
                    <TableHead className="text-right">訂購</TableHead>
                    <TableHead className="text-right">已出貨</TableHead>
                    <TableHead className="text-right">待出貨</TableHead>
                    <TableHead className="w-32">出貨數量</TableHead>
                    <TableHead>訂單日期</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-8" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-8" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-8" /></TableCell>
                        <TableCell><Skeleton className="h-8 w-20" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      </TableRow>
                    ))
                  ) : allPendingItems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                        沒有待出貨的商品
                      </TableCell>
                    </TableRow>
                  ) : (
                    allPendingItems.map((item) => {
                      const pending = item.quantity - item.shipped_quantity;
                      const selection = selectedItems.get(item.id);
                      return (
                        <TableRow key={item.id} className={selection ? 'bg-muted/50' : ''}>
                          <TableCell>
                            <Checkbox
                              checked={!!selection}
                              onCheckedChange={(checked) => toggleItemSelection(item, !!checked)}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{item.storeName}</div>
                            {item.storeCode && (
                              <div className="text-xs text-muted-foreground">{item.storeCode}</div>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-sm">{item.products?.sku}</TableCell>
                          <TableCell>{item.products?.name}</TableCell>
                          <TableCell className="text-right">{item.quantity}</TableCell>
                          <TableCell className="text-right">{item.shipped_quantity}</TableCell>
                          <TableCell className="text-right">
                            <Badge variant={pending > 0 ? 'default' : 'secondary'}>{pending}</Badge>
                          </TableCell>
                          <TableCell>
                            {selection && (
                              <Input
                                type="number"
                                min={1}
                                max={selection.maxQuantity}
                                value={selection.quantity}
                                onChange={(e) => updateItemQuantity(item.id, parseInt(e.target.value) || 1)}
                                className="w-20 h-8"
                              />
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {format(new Date(item.orderCreatedAt), 'MM/dd', { locale: zhTW })}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* 訂單詳情 Dialog */}
      <Dialog open={!!selectedOrder} onOpenChange={() => setSelectedOrder(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>訂單詳情</DialogTitle>
          </DialogHeader>
          {selectedOrder && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">訂單編號：</span>
                  <span className="font-mono">{selectedOrder.id}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">店鋪：</span>
                  <span>{selectedOrder.stores?.name}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">建立時間：</span>
                  <span>
                    {format(new Date(selectedOrder.created_at), 'yyyy/MM/dd HH:mm', {
                      locale: zhTW,
                    })}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">來源：</span>
                  <span>{selectedOrder.source_type === 'frontend' ? '前台訂單' : '後台代訂'}</span>
                </div>
              </div>
              {selectedOrder.notes && (
                <div className="text-sm">
                  <span className="text-muted-foreground">備註：</span>
                  <span>{selectedOrder.notes}</span>
                </div>
              )}
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>產品名稱</TableHead>
                      <TableHead className="text-right">單價</TableHead>
                      <TableHead className="text-right">數量</TableHead>
                      <TableHead className="text-right">已出貨</TableHead>
                      <TableHead>狀態</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedOrder.order_items.map((item) => {
                      const itemStatus = statusLabels[item.status];
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="font-mono text-sm">
                            {item.products?.sku}
                          </TableCell>
                          <TableCell>{item.products?.name}</TableCell>
                          <TableCell className="text-right">
                            ${item.unit_price.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right">{item.quantity}</TableCell>
                          <TableCell className="text-right">{item.shipped_quantity}</TableCell>
                          <TableCell>
                            <Badge className={itemStatus.className} variant="secondary">
                              {itemStatus.label}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="flex justify-end text-lg font-semibold">
                總計：${getOrderTotal(selectedOrder.order_items).toFixed(2)}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 確認出貨 Dialog */}
      <Dialog open={showShipDialog} onOpenChange={setShowShipDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5" />
              確認加入出貨池
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              以下商品將按店家分組加入出貨池：
            </p>
            {Object.entries(groupedSelections).map(([storeId, group]) => (
              <div key={storeId} className="border rounded-lg p-4">
                <h4 className="font-medium mb-2">{group.storeName}</h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>產品</TableHead>
                      <TableHead className="text-right">出貨數量</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.items.map(item => (
                      <TableRow key={item.itemId}>
                        <TableCell className="font-mono text-sm">{item.sku}</TableCell>
                        <TableCell>{item.productName}</TableCell>
                        <TableCell className="text-right">{item.quantity}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowShipDialog(false)}>
              取消
            </Button>
            <Button
              onClick={() => addToShippingPoolMutation.mutate()}
              disabled={addToShippingPoolMutation.isPending}
            >
              {addToShippingPoolMutation.isPending ? '處理中...' : '確認加入出貨池'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
