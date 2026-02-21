import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useStoreProductCache } from '@/hooks/useProductCache';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { OrderItemsTable } from '@/components/order/OrderItemsTable';
import { OrderEditHeader } from '@/components/order/OrderEditHeader';
import { OrderNotesCard } from '@/components/order/OrderNotesCard';
import { AddProductCard } from '@/components/order/AddProductCard';
import { LockedOrderView } from '@/components/order/LockedOrderView';

const statusLabels = {
  pending: { label: '未確認', className: 'bg-warning text-warning-foreground', editable: true },
  processing: { label: '處理中', className: 'bg-primary text-primary-foreground', editable: false },
};

export default function StoreOrderEdit() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { storeId } = useAuth();
  const { products } = useStoreProductCache(storeId);

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
    queryKey: ['store-order-detail', orderId],
    queryFn: async () => {
      if (!orderId) return null;
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
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
      if (order.status !== 'pending') throw new Error('只能修改未確認的訂單');

      // 更新訂單備註
      const { error: orderError } = await supabase
        .from('orders')
        .update({ notes: notes || null })
        .eq('id', orderId);
      if (orderError) throw orderError;

      // 更新現有項目
      for (const item of orderItems) {
        if (item.isNew) {
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
      queryClient.invalidateQueries({ queryKey: ['store-order-detail'] });
      queryClient.invalidateQueries({ queryKey: ['store-orders'] });
      navigate('/orders');
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
        unitPrice: product.wholesale_price,
        isNew: true,
      },
    ]);
    setSelectedProductId('');
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
        <Button onClick={() => navigate('/orders')}>
          返回訂單列表
        </Button>
      </div>
    );
  }

  const statusInfo = statusLabels[order.status as keyof typeof statusLabels];
  const isEditable = order.status === 'pending';
  const availableProducts = products.filter(
    p => !orderItems.some(item => item.productId === p.id)
  );

  if (!isEditable) {
    return (
      <LockedOrderView
        orderId={order.id}
        orderItems={order.order_items}
        onBack={() => navigate('/orders')}
      />
    );
  }

  return (
    <div className="space-y-6">
      <OrderEditHeader
        orderId={order.id}
        statusLabel={statusInfo.label}
        statusClassName={statusInfo.className}
        onBack={() => navigate('/orders')}
      />

      <OrderNotesCard
        notes={notes}
        createdAt={format(new Date(order.created_at), 'yyyy/MM/dd HH:mm', { locale: zhTW })}
        onNotesChange={setNotes}
      />

      <AddProductCard
        availableProducts={availableProducts}
        selectedProductId={selectedProductId}
        onProductSelect={setSelectedProductId}
        onAddProduct={handleAddProduct}
      />

      <Card>
        <CardHeader>
          <CardTitle>訂單項目</CardTitle>
        </CardHeader>
        <CardContent>
          <OrderItemsTable
            items={orderItems}
            products={products}
            onUpdateQuantity={handleQuantityChange}
            onRemove={handleRemoveItem}
            isEditable={true}
          />
          <div className="flex justify-end mt-4">
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
