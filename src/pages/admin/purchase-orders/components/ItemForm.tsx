import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DialogFooter } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { Product, PurchaseOrderItem } from '../types';

interface ItemFormProps {
  products: Product[];
  onSubmit: (data: Partial<PurchaseOrderItem>) => void;
  isLoading: boolean;
}

export function ItemForm({
  products,
  onSubmit,
  isLoading,
}: ItemFormProps) {
  const [productId, setProductId] = useState('');
  const [variantId, setVariantId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [unitCost, setUnitCost] = useState('');
  const [variants, setVariants] = useState<{ id: string; name: string; sku: string }[]>([]);

  // Fetch variants when product is selected
  const handleProductChange = async (pId: string) => {
    setProductId(pId);
    setVariantId(null);
    setVariants([]);

    const product = products.find(p => p.id === pId);
    if (product?.has_variants) {
      const { data } = await supabase
        .from('product_variants')
        .select('id, name, sku')
        .eq('product_id', pId)
        .order('name');

      if (data) {
        setVariants(data as any);
      }
    }
  };

  const selectedProduct = products.find(p => p.id === productId);
  const showVariantSelect = selectedProduct?.has_variants;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>產品</Label>
        <Select value={productId} onValueChange={handleProductChange}>
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

      {showVariantSelect && (
        <div className="space-y-2">
          <Label>規格/變體</Label>
          <Select value={variantId || ''} onValueChange={setVariantId}>
            <SelectTrigger>
              <SelectValue placeholder="選擇規格" />
            </SelectTrigger>
            <SelectContent>
              {variants.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.sku ? `${v.sku} - ` : ''}{v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

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
            variant_id: variantId || null,
            quantity: parseInt(quantity),
            unit_cost: parseFloat(unitCost) || 0,
          })}
          disabled={!productId || (showVariantSelect && !variantId) || !quantity || isLoading}
        >
          {isLoading ? '處理中...' : '新增'}
        </Button>
      </DialogFooter>
    </div>
  );
}
