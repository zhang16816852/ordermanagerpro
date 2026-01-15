// src/pages/admin/EditOrder.tsx
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useProductCache } from '@/hooks/useProductCache';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Save, Lock, Unlock, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { zhTW } from 'date-fns/locale';

const statusLabels = {
  pending: { label: '未確認', className: 'bg-warning text-warning-foreground' },
  processing: { label: '處理中', className: 'bg-primary text-primary-foreground' },
};

export default function AdminEditOrder() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { products } = useProductCache();

  const [notes, setNotes] = useState('');
  const [orderItems, setOrderItems] = useState<Array<{
    id: string;
    productId: string;
    quantity: number;
    unitPrice: number;
    isNew?: boolean;
  }>>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>('');

  const { data: order, isLoading } = useQuery({
    queryKey: ['order-detail', orderId],
    queryFn: async () => {
      if (!orderId) return null;
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          stores (name, code, brand),
          order_items (
            id,
            product_id,
            quantity,
            unit_price,
            shipped_quantity,
            status,
            products (name, sku)
          )
        `)
        .eq('id', orderId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!orderId,
  });

  useEffect(() => {
    if (order) {
      setNotes(order.notes || '');
      setOrderItems(order.order_items.map((item: any) => ({
        id: item.id,
        productId: item.product_id,
        quantity: item.quantity,
        unitPrice: item.unit_price,
      })));
    }
  }, [order]);

  const updateOrderMutation = useMutation({
    mutationFn: async () => {
      if (!orderId || !order) throw new Error('訂單不存在');

      // 更新訂單備註
      const { error: orderError } = await supabase
        .from('orders')
        .update({ notes: notes || null })
        .eq('id', orderId);
      if (orderError) throw orderError;

      // 更新現有項目
      for (const item of orderItems) {
        if (item.isNew) {
          // 新增項目
          const { error } = await supabase
            .from('order_items')
            .insert({
              order_id: orderId,
              product_id: item.productId,
              quantity: item.quantity,
              unit_price: item.unitPrice,
              store_id: order.store_id,
            });
          if (error) throw error;
        } else {
          // 更新現有項目
          const { error } = await supabase
            .from('order_items')
            .update({
              quantity: item.quantity,
              unit_price: item.unitPrice,
            })
            .eq('id', item.id);
          if (error) throw error;
        }
      }

      // 刪除已移除的項目
      const existingIds = order.order_items.map((item: any) => item.id);
      const currentIds = orderItems.filter(item => !item.isNew).map(item => item.id);
      const toDelete = existingIds.filter((id: string) => !currentIds.includes(id));

      if (toDelete.length > 0) {
        const { error } = await supabase
          .from('order_items')
          .delete()
          .in('id', toDelete);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success('訂單已更新');
      queryClient.invalidateQueries({ queryKey: ['order-detail'] });
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const toggleStatusMutation = useMutation({
    mutationFn: async () => {
      if (!orderId || !order) throw new Error('訂單不存在');
      const newStatus = order.status === 'pending' ? 'processing' : 'pending';
      const { error } = await supabase
        .from('orders')
        .update({ status: newStatus })
        .eq('id', orderId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('訂單狀態已更新');
      queryClient.invalidateQueries({ queryKey: ['order-detail'] });
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const handleQuantityChange = (index: number, value: number) => {
    setOrderItems(prev => {
      const updated = [...prev];
      updated[index].quantity = Math.max(1, value);
      return updated;
    });
  };

  const handlePriceChange = (index: number, value: number) => {
    setOrderItems(prev => {
      const updated = [...prev];
      updated[index].unitPrice = Math.max(0, value);
      return updated;
    });
  };

  const handleRemoveItem = (index: number) => {
    setOrderItems(prev => prev.filter((_, i) => i !== index));
  };

  const handleAddProduct = () => {
    if (!selectedProductId) return;
    const product = products.find(p => p.id === selectedProductId);
    if (!product) return;

    setOrderItems(prev => [
      ...prev,
      {
        id: `new-${Date.now()}`,
        productId: product.id,
        quantity: 1,
        unitPrice: product.base_wholesale_price,
        isNew: true,
      },
    ]);
    setSelectedProductId('');
  };

  const getProductName = (productId: string) => {
    const product = products.find(p => p.id === productId);
    return product?.name || '未知產品';
  };

  const getProductSku = (productId: string) => {
    const product = products.find(p => p.id === productId);
    return product?.sku || '';
  };

  const getTotalAmount = () => {
    return orderItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">載入中...</div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-muted-foreground">找不到訂單</p>
        <Button onClick={() => navigate('/admin/orders')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          返回訂單列表
        </Button>
      </div>
    );
  }

  const statusInfo = statusLabels[order.status as keyof typeof statusLabels];
  const availableProducts = products.filter(
    p => p.status === 'active' && !orderItems.some(item => item.productId === p.id)
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => navigate('/admin/orders')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            返回
          </Button>
          <div>
            <h1 className="text-2xl font-bold">編輯訂單</h1>
            <p className="text-muted-foreground font-mono text-sm">{order.id}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={statusInfo.className}>{statusInfo.label}</Badge>
          <Button
            variant="outline"
            onClick={() => toggleStatusMutation.mutate()}
            disabled={toggleStatusMutation.isPending}
          >
            {order.status === 'pending' ? (
              <>
                <Lock className="mr-2 h-4 w-4" />
                鎖定訂單
              </>
            ) : (
              <>
                <Unlock className="mr-2 h-4 w-4" />
                解除鎖定
              </>
            )}
          </Button>
        </div>
      </div>

      {/* 訂單資訊 */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>訂單資訊</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">店鋪：</span>
                <span className="font-medium">{order.stores?.name}</span>
              </div>
              <div>
                <span className="text-muted-foreground">品牌：</span>
                <span className="font-medium">{order.stores?.brand || '-'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">建立時間：</span>
                <span>{format(new Date(order.created_at), 'yyyy/MM/dd HH:mm', { locale: zhTW })}</span>
              </div>
              <div>
                <span className="text-muted-foreground">來源：</span>
                <span>{order.source_type === 'frontend' ? '前台' : '後台'}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>訂單備註</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              placeholder="輸入訂單備註..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
            />
          </CardContent>
        </Card>
      </div>

      {/* 新增產品 */}
      <Card>
        <CardHeader>
          <CardTitle>新增產品</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4">
            <Select value={selectedProductId} onValueChange={setSelectedProductId}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="選擇產品" />
              </SelectTrigger>
              <SelectContent>
                {availableProducts.map(product => (
                  <SelectItem key={product.id} value={product.id}>
                    {product.sku} - {product.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleAddProduct} disabled={!selectedProductId}>
              <Plus className="mr-2 h-4 w-4" />
              新增
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 訂單項目 */}
      <Card>
        <CardHeader>
          <CardTitle>訂單項目</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>產品名稱</TableHead>
                <TableHead className="w-32">單價</TableHead>
                <TableHead className="w-32">數量</TableHead>
                <TableHead className="text-right">小計</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orderItems.map((item, index) => (
                <TableRow key={item.id}>
                  <TableCell className="font-mono text-sm">
                    {getProductSku(item.productId)}
                    {item.isNew && <Badge variant="outline" className="ml-2">新增</Badge>}
                  </TableCell>
                  <TableCell>{getProductName(item.productId)}</TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      value={item.unitPrice}
                      onChange={(e) => handlePriceChange(index, parseFloat(e.target.value) || 0)}
                      className="w-24"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      value={item.quantity}
                      onChange={(e) => handleQuantityChange(index, parseInt(e.target.value) || 1)}
                      className="w-20"
                      min={1}
                    />
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    ${(item.quantity * item.unitPrice).toFixed(2)}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveItem(index)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex justify-between items-center mt-6 pt-4 border-t">
            <div className="text-lg font-semibold">
              總計：${getTotalAmount().toFixed(2)}
            </div>
            <Button
              onClick={() => updateOrderMutation.mutate()}
              disabled={updateOrderMutation.isPending}
            >
              <Save className="mr-2 h-4 w-4" />
              {updateOrderMutation.isPending ? '儲存中...' : '儲存變更'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
