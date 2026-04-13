import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DialogFooter } from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { format } from 'date-fns';
import { ProductWithPrice } from '../types';

interface ImportFromOrdersDialogProps {
  products: ProductWithPrice[];
  onSubmit: (items: { product_id: string; variant_id: string | null; quantity: number; unit_cost: number }[]) => void;
  isLoading: boolean;
}

export function ImportFromOrdersDialog({
  products,
  onSubmit,
  isLoading
}: ImportFromOrdersDialogProps) {
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  // Fetch pending order items
  const { data: pendingItems = [], isLoading: dataLoading } = useQuery({
    queryKey: ['pending-order-items-for-po'],
    queryFn: async () => {
      // Fetch orders processing or pending
      const { data: orders, error } = await supabase
        .from('orders')
        .select(`
          id,
          created_at,
          order_items (
            id,
            quantity,
            shipped_quantity,
            product_id,
            variant_id,
            products (id, name, sku),
            product_variants (id, name, sku, wholesale_price)
          )
        `)
        .in('status', ['pending', 'processing'])
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Flatten items and filter those that need purchasing (simple logic: not fully shipped)
      const items: any[] = [];
      orders?.forEach((order: any) => {
        order.order_items?.forEach((item: any) => {
          if (item.quantity > item.shipped_quantity) {
            items.push({
              _id: item.id, // Unique Key
              order_id: order.id,
              order_date: order.created_at,
              product_id: item.product_id,
              variant_id: item.variant_id,
              product_name: item.products?.name,
              variant_name: item.product_variants?.name,
              sku: item.product_variants?.sku || item.products?.sku,
              quantity: item.quantity - item.shipped_quantity, // Remaining needed
              estimated_cost: item.product_variants?.wholesale_price ||
                products.find(p => p.id === item.product_id)?.base_wholesale_price || 0,
            });
          }
        });
      });
      return items;
    }
  });

  const handleToggle = (id: string, checked: boolean) => {
    const next = new Set(selectedItems);
    if (checked) next.add(id);
    else next.delete(id);
    setSelectedItems(next);
  };

  const handleConfirm = () => {
    const itemsToImport = pendingItems
      .filter((item: any) => selectedItems.has(item._id))
      .map((item: any) => ({
        product_id: item.product_id,
        variant_id: item.variant_id,
        quantity: item.quantity,
        unit_cost: item.estimated_cost
      }));
    onSubmit(itemsToImport);
  };

  return (
    <div className="space-y-4">
      <Table containerClassName="max-h-[400px]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[50px]">
              <Checkbox
                checked={pendingItems.length > 0 && selectedItems.size === pendingItems.length}
                onCheckedChange={(c) => {
                  if (c) setSelectedItems(new Set(pendingItems.map((i: any) => i._id)));
                  else setSelectedItems(new Set());
                }}
              />
            </TableHead>
            <TableHead>來源訂單</TableHead>
            <TableHead>SKU</TableHead>
            <TableHead>產品</TableHead>
            <TableHead className="text-right">需採購數</TableHead>
            <TableHead className="text-right">預估成本</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {dataLoading ? (
            <TableRow><TableCell colSpan={6} className="text-center py-8">載入中...</TableCell></TableRow>
          ) : pendingItems.length === 0 ? (
            <TableRow><TableCell colSpan={6} className="text-center py-8">沒有待採購項目</TableCell></TableRow>
          ) : (
            pendingItems.map((item: any) => (
              <TableRow key={item._id}>
                <TableCell>
                  <Checkbox
                    checked={selectedItems.has(item._id)}
                    onCheckedChange={(c) => handleToggle(item._id, !!c)}
                  />
                </TableCell>
                <TableCell>
                  <div className="font-mono text-xs">{item.order_id.slice(0, 8)}</div>
                  <div className="text-xs text-muted-foreground">{format(new Date(item.order_date), 'MM/dd')}</div>
                </TableCell>
                <TableCell className="font-mono text-sm">{item.sku}</TableCell>
                <TableCell>
                  {item.product_name}
                  {item.variant_name && <span className="text-muted-foreground ml-1">- {item.variant_name}</span>}
                </TableCell>
                <TableCell className="text-right">{item.quantity}</TableCell>
                <TableCell className="text-right text-muted-foreground">${item.estimated_cost}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <DialogFooter>
        <div className="flex-1 text-sm text-muted-foreground self-center">
          已選擇 {selectedItems.size} 個項目
        </div>
        <Button onClick={handleConfirm} disabled={selectedItems.size === 0 || isLoading}>
          {isLoading ? '處理中...' : '匯入選取項目'}
        </Button>
      </DialogFooter>
    </div>
  );
}
