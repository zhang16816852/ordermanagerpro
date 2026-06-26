import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Plus, Layers, Pencil, Trash2, ShoppingCart } from 'lucide-react';
import { VariantBatchCreator } from './VariantBatchCreator';
import { VariantEditDialog } from '@/components/products/VariantEditDialog';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { useOrderDraftStore } from '@/store/useOrderDraftStore';
import type { ProductWithPricing, VariantWithPricing } from '@/types/product';

const STATUS_LABELS: Record<string, string> = {
  active: '上架中',
  discontinued: '已停售',
  preorder: '預購中',
  sold_out: '售完停產',
};

export function VariantSection({ product }: { product: any }) {
  const [isBatchOpen, setIsBatchOpen] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingVariant, setEditingVariant] = useState<any>(null);
  const queryClient = useQueryClient();
  const store = useOrderDraftStore();

  const getVariantQty = (productId: string, variantId?: string) => {
    let total = 0;
    for (const sid of Object.keys(store.drafts)) {
      total += store.getItemQuantity(sid, productId, variantId);
    }
    return total;
  };

  const firstStoreId = Object.keys(store.drafts)[0];

  // 取得變體資料
  const { data: variants, isLoading } = useQuery({
    queryKey: ['product-variants', product.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_variants')
        .select('*')
        .eq('product_id', product.id)
        .order('sku');
      if (error) throw error;
      return data;
    },
    enabled: !!product.id, // 確保有 ID 才抓取
  });

  // 刷新函數
  const refreshVariants = () => {
    queryClient.invalidateQueries({ queryKey: ['product-variants', product.id] });
  };

  const handleAddToCart = (variant: any) => {
    const productForCart = { ...product, wholesale_price: product.wholesale_price ?? 0, retail_price: product.retail_price ?? 0, has_store_price: false } as ProductWithPricing;
    const variantForCart = { ...variant, effective_wholesale_price: variant.wholesale_price, effective_retail_price: variant.retail_price, has_brand_price: false } as VariantWithPricing;
    if (!firstStoreId) {
      toast.error('沒有可用的購物車');
      return;
    }
    store.addItem(firstStoreId, productForCart, variantForCart);
    toast.success(`${product.name} / ${variant.name} 已加入購物車`);
  };

  // 處理刪除 (範例)
  const handleDelete = async (id: string) => {
    if (!confirm('確定要刪除此規格變體嗎？')) return;
    const { error } = await supabase.from('product_variants').delete().eq('id', id);
    if (error) {
      toast.error('刪除失敗');
    } else {
      toast.success('變體已刪除');
      refreshVariants();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center bg-muted/30 p-4 rounded-lg border border-dashed">
        <div>
          <h3 className="font-medium">變體清單</h3>
          <p className="text-xs text-muted-foreground">
            {isLoading ? '讀取中...' : `目前此產品共有 ${variants?.length || 0} 個規格選項`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setIsBatchOpen(true)}>
            <Layers className="mr-2 h-4 w-4" />
            {variants && variants.length > 0 ? '批次編輯 / 產生' : '批次產生'}
          </Button>
          <Button size="sm" onClick={() => { setEditingVariant(null); setIsDialogOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" /> 新增單一
          </Button>
        </div>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-[120px]">SKU</TableHead>
              <TableHead>規格名稱</TableHead>
              <TableHead>選項1</TableHead>
              <TableHead>選項2</TableHead>
              <TableHead>顏色</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead className="text-right">批發價</TableHead>
              <TableHead className="text-right">零售價</TableHead>
              <TableHead className="w-[100px] text-center">購物車</TableHead>
              <TableHead className="w-[100px] text-center">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              // 載入中的 Skeleton 效果
              [1, 2, 3].map((i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell colSpan={3}><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-16 mx-auto" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-16 mx-auto" /></TableCell>
                </TableRow>
              ))
            ) : variants?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="h-32 text-center text-muted-foreground">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <Layers className="h-8 w-8 opacity-20" />
                    <p>尚未建立任何變體，請點擊「批次產生」快速建立。</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              variants?.map((v) => (
                <TableRow key={v.id} className="group">
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {v.sku}
                  </TableCell>
                  <TableCell className="font-medium">{v.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{v.option_1 || '-'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{v.option_2 || '-'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{v.option_3 || '-'}</TableCell>
                  <TableCell>
                    <Badge variant={v.status === 'active' ? 'default' : 'secondary'}>
                      {STATUS_LABELS[v.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">${v.wholesale_price}</TableCell>
                  <TableCell className="text-right font-mono">${v.retail_price}</TableCell>
                  <TableCell className="text-center">
                    {(() => {
                      const cartQty = getVariantQty(product.id, v.id);
                      return cartQty > 0 ? (
                        <Badge variant="default" className="text-[10px] h-5 px-1.5 whitespace-nowrap">
                          已加入 x{cartQty}
                        </Badge>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-[10px] px-1.5 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => handleAddToCart(v)}
                        >
                          <ShoppingCart className="h-3 w-3 mr-0.5" />
                          加入
                        </Button>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => { setEditingVariant(v); setIsDialogOpen(true); }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={() => handleDelete(v.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* 批次產生器 */}
      <VariantBatchCreator
        open={isBatchOpen}
        onOpenChange={setIsBatchOpen}
        product={product}
        onSuccess={refreshVariants}
      />

      <VariantEditDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        product={product}
        variant={editingVariant}
        onSuccess={refreshVariants}
      />
    </div>
  );
}