import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Package,
  Plus,
  Edit,
  Trash2,
  Truck,
  Building2,
  Eye,
  Check,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { toast } from 'sonner';

type PurchaseOrderStatus = 'draft' | 'ordered' | 'partial_received' | 'received' | 'cancelled';

interface Supplier {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
}

interface PurchaseOrder {
  id: string;
  supplier_id: string | null;
  status: PurchaseOrderStatus;
  order_date: string;
  expected_date: string | null;
  received_date: string | null;
  total_amount: number;
  notes: string | null;
  created_by: string;
  created_at: string;
  supplier?: Supplier;
}

interface PurchaseOrderItem {
  id: string;
  purchase_order_id: string;
  product_id: string | null;
  variant_id: string | null;
  quantity: number;
  received_quantity: number;
  unit_cost: number;
  product?: { id: string; name: string; sku: string };
}

interface Product {
  id: string;
  name: string;
  sku: string;
  has_variants: boolean;
}

export default function AdminPurchaseOrders() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('orders');
  
  const [orderDialogOpen, setOrderDialogOpen] = useState(false);
  const [supplierDialogOpen, setSupplierDialogOpen] = useState(false);
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [receiveDialogOpen, setReceiveDialogOpen] = useState(false);
  const [viewingOrder, setViewingOrder] = useState<PurchaseOrder | null>(null);
  const [editingOrder, setEditingOrder] = useState<PurchaseOrder | null>(null);

  // Queries - 使用 as any 因為新表格尚未在 types.ts 中
  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('suppliers')
        .select('*')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return (data || []) as Supplier[];
    },
  });

  const { data: orders = [], isLoading: ordersLoading } = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('purchase_orders')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      
      return ((data || []) as any[]).map((order) => ({
        ...order,
        supplier: suppliers.find(s => s.id === order.supplier_id),
      })) as PurchaseOrder[];
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products-for-purchase'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, sku, has_variants')
        .eq('status', 'active')
        .order('name');
      if (error) throw error;
      return data as Product[];
    },
  });

  const { data: orderItems = [] } = useQuery({
    queryKey: ['purchase-order-items', viewingOrder?.id],
    queryFn: async () => {
      if (!viewingOrder) return [];
      const { data, error } = await (supabase as any)
        .from('purchase_order_items')
        .select('*')
        .eq('purchase_order_id', viewingOrder.id);
      if (error) throw error;
      
      // Get product info
      const productIds = (data || []).map((item: any) => item.product_id).filter(Boolean);
      let productMap: Record<string, Product> = {};
      if (productIds.length > 0) {
        const { data: prods } = await supabase
          .from('products')
          .select('id, name, sku')
          .in('id', productIds);
        productMap = (prods || []).reduce((acc, p) => ({ ...acc, [p.id]: p }), {});
      }
      
      return ((data || []) as any[]).map((item) => ({
        ...item,
        product: productMap[item.product_id],
      })) as PurchaseOrderItem[];
    },
    enabled: !!viewingOrder,
  });

  // Mutations
  const createOrderMutation = useMutation({
    mutationFn: async (data: Partial<PurchaseOrder>) => {
      const { data: result, error } = await (supabase as any)
        .from('purchase_orders')
        .insert({
          ...data,
          created_by: user?.id,
        })
        .select()
        .single();
      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      setOrderDialogOpen(false);
      setEditingOrder(null);
      toast.success('採購訂單已建立');
    },
    onError: () => toast.error('建立失敗'),
  });

  const updateOrderMutation = useMutation({
    mutationFn: async ({ id, ...data }: Partial<PurchaseOrder> & { id: string }) => {
      const { error } = await (supabase as any).from('purchase_orders').update(data).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      setOrderDialogOpen(false);
      setEditingOrder(null);
      toast.success('採購訂單已更新');
    },
    onError: () => toast.error('更新失敗'),
  });

  const deleteOrderMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('purchase_orders').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      toast.success('採購訂單已刪除');
    },
    onError: () => toast.error('刪除失敗'),
  });

  const createSupplierMutation = useMutation({
    mutationFn: async (data: Partial<Supplier>) => {
      const { error } = await (supabase as any).from('suppliers').insert(data);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      setSupplierDialogOpen(false);
      toast.success('供應商已新增');
    },
    onError: () => toast.error('新增失敗'),
  });

  const addItemMutation = useMutation({
    mutationFn: async (data: Partial<PurchaseOrderItem>) => {
      const { error } = await (supabase as any).from('purchase_order_items').insert(data);
      if (error) throw error;

      if (viewingOrder) {
        const newTotal = viewingOrder.total_amount + (data.quantity || 0) * (data.unit_cost || 0);
        await (supabase as any)
          .from('purchase_orders')
          .update({ total_amount: newTotal })
          .eq('id', viewingOrder.id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-order-items'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      setItemDialogOpen(false);
      toast.success('品項已新增');
    },
    onError: () => toast.error('新增失敗'),
  });

  const receiveItemsMutation = useMutation({
    mutationFn: async (items: { id: string; received_quantity: number }[]) => {
      for (const item of items) {
        const { error } = await (supabase as any)
          .from('purchase_order_items')
          .update({ received_quantity: item.received_quantity })
          .eq('id', item.id);
        if (error) throw error;

        const orderItem = orderItems.find(i => i.id === item.id);
        if (orderItem && orderItem.product_id) {
          const { data: existing } = await (supabase as any)
            .from('product_inventory')
            .select('quantity')
            .eq('product_id', orderItem.product_id)
            .maybeSingle();
          
          const currentQty = existing?.quantity || 0;
          const { error: invError } = await (supabase as any)
            .from('product_inventory')
            .upsert({
              product_id: orderItem.product_id,
              variant_id: orderItem.variant_id,
              quantity: currentQty + item.received_quantity,
            }, {
              onConflict: 'product_id,variant_id',
            });
          if (invError) console.error('Inventory update error:', invError);
        }
      }

      const allReceived = orderItems.every(item => {
        const received = items.find(i => i.id === item.id);
        return received ? received.received_quantity >= item.quantity : item.received_quantity >= item.quantity;
      });

      const anyReceived = items.some(i => i.received_quantity > 0);
      const newStatus: PurchaseOrderStatus = allReceived ? 'received' : anyReceived ? 'partial_received' : 'ordered';

      if (viewingOrder) {
        await (supabase as any)
          .from('purchase_orders')
          .update({ 
            status: newStatus,
            received_date: allReceived ? new Date().toISOString().split('T')[0] : null,
          })
          .eq('id', viewingOrder.id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-order-items'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      setReceiveDialogOpen(false);
      toast.success('收貨已記錄');
    },
    onError: () => toast.error('記錄失敗'),
  });

  const getStatusBadge = (status: PurchaseOrderStatus) => {
    switch (status) {
      case 'draft': return <Badge variant="secondary">草稿</Badge>;
      case 'ordered': return <Badge className="bg-blue-600 hover:bg-blue-700">已下單</Badge>;
      case 'partial_received': return <Badge className="bg-amber-500 hover:bg-amber-600">部分收貨</Badge>;
      case 'received': return <Badge className="bg-green-600 hover:bg-green-700">已收貨</Badge>;
      case 'cancelled': return <Badge variant="destructive">已取消</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">採購管理</h1>
          <p className="text-muted-foreground">管理供應商和採購訂單</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="orders">採購訂單</TabsTrigger>
          <TabsTrigger value="suppliers">供應商</TabsTrigger>
        </TabsList>

        <TabsContent value="orders" className="space-y-4">
          <div className="flex justify-end">
            <Dialog open={orderDialogOpen} onOpenChange={setOrderDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={() => setEditingOrder(null)}>
                  <Plus className="h-4 w-4 mr-2" /> 新增採購單
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{editingOrder ? '編輯採購單' : '新增採購單'}</DialogTitle>
                </DialogHeader>
                <OrderForm
                  order={editingOrder}
                  suppliers={suppliers}
                  onSubmit={(data) => {
                    if (editingOrder) {
                      updateOrderMutation.mutate({ id: editingOrder.id, ...data });
                    } else {
                      createOrderMutation.mutate(data);
                    }
                  }}
                  isLoading={createOrderMutation.isPending || updateOrderMutation.isPending}
                />
              </DialogContent>
            </Dialog>
          </div>

          <Card>
            <CardContent className="pt-6">
              {ordersLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : orders.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  沒有採購訂單
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>訂單編號</TableHead>
                      <TableHead>供應商</TableHead>
                      <TableHead>下單日期</TableHead>
                      <TableHead>預計到貨</TableHead>
                      <TableHead className="text-right">金額</TableHead>
                      <TableHead>狀態</TableHead>
                      <TableHead>操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell className="font-mono text-sm">{order.id.slice(0, 8)}...</TableCell>
                        <TableCell>{order.supplier?.name || '-'}</TableCell>
                        <TableCell>{format(new Date(order.order_date), 'yyyy/MM/dd')}</TableCell>
                        <TableCell>
                          {order.expected_date ? format(new Date(order.expected_date), 'yyyy/MM/dd') : '-'}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          ${order.total_amount.toLocaleString()}
                        </TableCell>
                        <TableCell>{getStatusBadge(order.status)}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setViewingOrder(order)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setEditingOrder(order);
                                setOrderDialogOpen(true);
                              }}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            {order.status === 'draft' && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  if (confirm('確定要刪除這筆採購單嗎？')) {
                                    deleteOrderMutation.mutate(order.id);
                                  }
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="suppliers" className="space-y-4">
          <div className="flex justify-end">
            <Dialog open={supplierDialogOpen} onOpenChange={setSupplierDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" /> 新增供應商
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>新增供應商</DialogTitle>
                </DialogHeader>
                <SupplierForm
                  onSubmit={(data) => createSupplierMutation.mutate(data)}
                  isLoading={createSupplierMutation.isPending}
                />
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {suppliers.map((supplier) => (
              <Card key={supplier.id}>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Building2 className="h-5 w-5" />
                    {supplier.name}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {supplier.contact_name && <p>聯絡人：{supplier.contact_name}</p>}
                  {supplier.phone && <p>電話：{supplier.phone}</p>}
                  {supplier.email && <p>Email：{supplier.email}</p>}
                  {supplier.address && <p className="text-muted-foreground">{supplier.address}</p>}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* Order Detail Dialog */}
      <Dialog open={!!viewingOrder} onOpenChange={(open) => !open && setViewingOrder(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              採購單明細
              {viewingOrder && getStatusBadge(viewingOrder.status)}
            </DialogTitle>
          </DialogHeader>
          {viewingOrder && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">供應商</p>
                  <p className="font-medium">{viewingOrder.supplier?.name || '-'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">下單日期</p>
                  <p className="font-medium">{format(new Date(viewingOrder.order_date), 'yyyy/MM/dd')}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">預計到貨</p>
                  <p className="font-medium">
                    {viewingOrder.expected_date ? format(new Date(viewingOrder.expected_date), 'yyyy/MM/dd') : '-'}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">總金額</p>
                  <p className="font-medium text-lg">${viewingOrder.total_amount.toLocaleString()}</p>
                </div>
              </div>

              {viewingOrder.notes && (
                <div>
                  <p className="text-muted-foreground text-sm">備註</p>
                  <p>{viewingOrder.notes}</p>
                </div>
              )}

              <div className="flex justify-between items-center">
                <h4 className="font-medium">品項列表</h4>
                <div className="flex gap-2">
                  {viewingOrder.status !== 'received' && viewingOrder.status !== 'cancelled' && (
                    <>
                      <Button variant="outline" size="sm" onClick={() => setItemDialogOpen(true)}>
                        <Plus className="h-4 w-4 mr-1" /> 新增品項
                      </Button>
                      <Button size="sm" onClick={() => setReceiveDialogOpen(true)}>
                        <Truck className="h-4 w-4 mr-1" /> 收貨
                      </Button>
                    </>
                  )}
                </div>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>品項</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">數量</TableHead>
                    <TableHead className="text-right">已收</TableHead>
                    <TableHead className="text-right">單價</TableHead>
                    <TableHead className="text-right">小計</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orderItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.product?.name || '-'}</TableCell>
                      <TableCell className="font-mono text-sm">
                        {item.product?.sku || '-'}
                      </TableCell>
                      <TableCell className="text-right">{item.quantity}</TableCell>
                      <TableCell className="text-right">
                        {item.received_quantity}
                        {item.received_quantity >= item.quantity && (
                          <Check className="h-4 w-4 inline ml-1 text-green-600" />
                        )}
                      </TableCell>
                      <TableCell className="text-right">${item.unit_cost.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-medium">
                        ${(item.quantity * item.unit_cost).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Item Dialog */}
      <Dialog open={itemDialogOpen} onOpenChange={setItemDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新增品項</DialogTitle>
          </DialogHeader>
          <ItemForm
            products={products}
            onSubmit={(data) => {
              if (viewingOrder) {
                addItemMutation.mutate({
                  ...data,
                  purchase_order_id: viewingOrder.id,
                });
              }
            }}
            isLoading={addItemMutation.isPending}
          />
        </DialogContent>
      </Dialog>

      {/* Receive Dialog */}
      <Dialog open={receiveDialogOpen} onOpenChange={setReceiveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>記錄收貨</DialogTitle>
          </DialogHeader>
          <ReceiveForm
            items={orderItems}
            onSubmit={(data) => receiveItemsMutation.mutate(data)}
            isLoading={receiveItemsMutation.isPending}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Order Form
function OrderForm({
  order,
  suppliers,
  onSubmit,
  isLoading,
}: {
  order: PurchaseOrder | null;
  suppliers: Supplier[];
  onSubmit: (data: Partial<PurchaseOrder>) => void;
  isLoading: boolean;
}) {
  const [supplierId, setSupplierId] = useState(order?.supplier_id || '');
  const [orderDate, setOrderDate] = useState(order?.order_date || format(new Date(), 'yyyy-MM-dd'));
  const [expectedDate, setExpectedDate] = useState(order?.expected_date || '');
  const [notes, setNotes] = useState(order?.notes || '');
  const [status, setStatus] = useState<PurchaseOrderStatus>(order?.status || 'draft');

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>供應商</Label>
        <Select value={supplierId} onValueChange={setSupplierId}>
          <SelectTrigger>
            <SelectValue placeholder="選擇供應商" />
          </SelectTrigger>
          <SelectContent>
            {suppliers.map((supplier) => (
              <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>下單日期</Label>
          <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>預計到貨（選填）</Label>
          <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
        </div>
      </div>

      {order && (
        <div className="space-y-2">
          <Label>狀態</Label>
          <Select value={status} onValueChange={(v: PurchaseOrderStatus) => setStatus(v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">草稿</SelectItem>
              <SelectItem value="ordered">已下單</SelectItem>
              <SelectItem value="cancelled">已取消</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-2">
        <Label>備註</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="輸入備註" />
      </div>

      <DialogFooter>
        <Button
          onClick={() => onSubmit({
            supplier_id: supplierId || null,
            order_date: orderDate,
            expected_date: expectedDate || null,
            notes: notes || null,
            status,
          })}
          disabled={isLoading}
        >
          {isLoading ? '處理中...' : order ? '更新' : '建立'}
        </Button>
      </DialogFooter>
    </div>
  );
}

// Supplier Form
function SupplierForm({
  onSubmit,
  isLoading,
}: {
  onSubmit: (data: Partial<Supplier>) => void;
  isLoading: boolean;
}) {
  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>供應商名稱 *</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>聯絡人</Label>
          <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>電話</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Email</Label>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>地址</Label>
        <Input value={address} onChange={(e) => setAddress(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>備註</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <DialogFooter>
        <Button
          onClick={() => onSubmit({
            name,
            contact_name: contactName || null,
            phone: phone || null,
            email: email || null,
            address: address || null,
            notes: notes || null,
          })}
          disabled={!name || isLoading}
        >
          {isLoading ? '處理中...' : '新增'}
        </Button>
      </DialogFooter>
    </div>
  );
}

// Item Form
function ItemForm({
  products,
  onSubmit,
  isLoading,
}: {
  products: Product[];
  onSubmit: (data: Partial<PurchaseOrderItem>) => void;
  isLoading: boolean;
}) {
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unitCost, setUnitCost] = useState('');

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>產品</Label>
        <Select value={productId} onValueChange={setProductId}>
          <SelectTrigger>
            <SelectValue placeholder="選擇產品" />
          </SelectTrigger>
          <SelectContent>
            {products.map((product) => (
              <SelectItem key={product.id} value={product.id}>
                {product.sku} - {product.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>數量</Label>
          <Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} min="1" />
        </div>
        <div className="space-y-2">
          <Label>單價（成本）</Label>
          <Input type="number" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
        </div>
      </div>
      <DialogFooter>
        <Button
          onClick={() => onSubmit({
            product_id: productId || null,
            quantity: parseInt(quantity),
            unit_cost: parseFloat(unitCost) || 0,
          })}
          disabled={!productId || !quantity || isLoading}
        >
          {isLoading ? '處理中...' : '新增'}
        </Button>
      </DialogFooter>
    </div>
  );
}

// Receive Form
function ReceiveForm({
  items,
  onSubmit,
  isLoading,
}: {
  items: PurchaseOrderItem[];
  onSubmit: (data: { id: string; received_quantity: number }[]) => void;
  isLoading: boolean;
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>(
    items.reduce((acc, item) => ({ ...acc, [item.id]: item.quantity }), {})
  );

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-4">
            <div className="flex-1">
              <p className="font-medium">{item.product?.name || '-'}</p>
              <p className="text-sm text-muted-foreground">
                訂購: {item.quantity} / 已收: {item.received_quantity}
              </p>
            </div>
            <Input
              type="number"
              className="w-24"
              value={quantities[item.id] || 0}
              onChange={(e) => setQuantities({ ...quantities, [item.id]: parseInt(e.target.value) || 0 })}
              min="0"
              max={item.quantity}
            />
          </div>
        ))}
      </div>
      <DialogFooter>
        <Button
          onClick={() => onSubmit(
            Object.entries(quantities).map(([id, received_quantity]) => ({ id, received_quantity }))
          )}
          disabled={isLoading}
        >
          {isLoading ? '處理中...' : '確認收貨'}
        </Button>
      </DialogFooter>
    </div>
  );
}
