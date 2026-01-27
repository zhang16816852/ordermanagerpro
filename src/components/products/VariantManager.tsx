// src/components/products/VariantManager.tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tables, TablesInsert } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Plus, Pencil, Trash2, Layers, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { VariantBatchCreator } from '../ProductFormDialog/VariantBatchCreator';
import { VariantEditDialog } from './VariantEditDialog';

type Product = Tables<'products'>;
type ProductVariant = Tables<'product_variants'>;
type VariantInsert = TablesInsert<'product_variants'>;

interface VariantManagerProps {
  products: Product[];
  search: string;
}

const STATUS_LABELS: Record<string, string> = {
  active: '上架中',
  discontinued: '已停售',
  preorder: '預購中',
  sold_out: '售完停產',
};

export function VariantManager({ products, search }: VariantManagerProps) {
  const queryClient = useQueryClient();
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isBatchOpen, setIsBatchOpen] = useState(false);
  const [editingVariant, setEditingVariant] = useState<ProductVariant | null>(null);

  // 篩選有變體的產品
  const productsWithVariants = products.filter(p =>
    p.has_variants &&
    (p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.sku.toLowerCase().includes(search.toLowerCase()))
  );

  const selectedProduct = products.find(p => p.id === selectedProductId);

  // 取得選定產品的變體
  const { data: variants = [], isLoading: variantsLoading } = useQuery({
    queryKey: ['product-variants', selectedProductId],
    queryFn: async () => {
      if (!selectedProductId) return [];
      const { data, error } = await supabase
        .from('product_variants')
        .select('*')
        .eq('product_id', selectedProductId)
        .order('sku');
      if (error) throw error;
      return data;
    },
    enabled: !!selectedProductId,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('product_variants').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product-variants', selectedProductId] });
      toast.success('變體已刪除');
    },
    onError: (error) => {
      toast.error(`刪除失敗：${error.message}`);
    },
  });

  const openEditDialog = (variant: ProductVariant) => {
    setEditingVariant(variant);
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingVariant(null);
  };

  return (
    <div className="space-y-4">
      {/* 產品選擇器 */}
      <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
        <Label className="text-sm font-medium whitespace-nowrap">選擇產品：</Label>
        <Select value={selectedProductId || ''} onValueChange={setSelectedProductId}>
          <SelectTrigger className="flex-1 max-w-md">
            <SelectValue placeholder="選擇有變體的產品" />
          </SelectTrigger>
          <SelectContent>
            {productsWithVariants.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground text-center">
                沒有啟用變體的產品
              </div>
            ) : (
              productsWithVariants.map((product) => (
                <SelectItem key={product.id} value={product.id}>
                  <span className="font-mono text-xs mr-2">{product.sku}</span>
                  {product.name}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>

        {selectedProductId && (
          <>
            <Button onClick={() => { setEditingVariant(null); setIsDialogOpen(true); }}>
              <Plus className="mr-2 h-4 w-4" />
              新增變體
            </Button>
            <Button variant="outline" onClick={() => setIsBatchOpen(true)}>
              <Layers className="mr-2 h-4 w-4" />
              批次建立
            </Button>
          </>
        )}
      </div>

      {/* 產品資訊 */}
      {selectedProduct && (
        <div className="p-4 border rounded-lg bg-card">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-lg">{selectedProduct.name}</h3>
              <p className="text-sm text-muted-foreground">
                SKU: {selectedProduct.sku}
                {selectedProduct.brand && ` | 廠牌: ${selectedProduct.brand}`}
                {selectedProduct.model && ` | 型號: ${selectedProduct.model}`}
              </p>
            </div>
            <Badge variant="secondary">{variants.length} 個變體</Badge>
          </div>
        </div>
      )}

      {/* 變體列表 */}
      {selectedProductId && (
        <div className="rounded-lg border bg-card shadow-soft">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>名稱</TableHead>
                <TableHead>選項1</TableHead>
                <TableHead>選項2</TableHead>
                <TableHead>選項3</TableHead>
                <TableHead className="text-right">批發價</TableHead>
                <TableHead className="text-right">零售價</TableHead>
                <TableHead>狀態</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {variantsLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 9 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-16" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : variants.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    此產品尚無變體，點擊「新增變體」或「批次建立」開始
                  </TableCell>
                </TableRow>
              ) : (
                variants.map((variant) => (
                  <TableRow key={variant.id}>
                    <TableCell className="font-mono text-sm">{variant.sku}</TableCell>
                    <TableCell className="font-medium">{variant.name}</TableCell>
                    <TableCell className="text-muted-foreground">{variant.option_1 || '-'}</TableCell>
                    <TableCell className="text-muted-foreground">{variant.option_2 || '-'}</TableCell>
                    <TableCell className="text-muted-foreground">{variant.option_3 || '-'}</TableCell>
                    <TableCell className="text-right">${variant.wholesale_price}</TableCell>
                    <TableCell className="text-right">${variant.retail_price}</TableCell>
                    <TableCell>
                      <Badge variant={variant.status === 'active' ? 'default' : 'secondary'}>
                        {STATUS_LABELS[variant.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEditDialog(variant)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive"
                          onClick={() => deleteMutation.mutate(variant.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {!selectedProductId && (
        <div className="rounded-lg border bg-card p-12 text-center text-muted-foreground">
          <Layers className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg">請先選擇一個有變體的產品</p>
          <p className="text-sm mt-2">
            如果沒有產品顯示，請先在產品列表中啟用「有變體選項」
          </p>
        </div>
      )}

      <VariantEditDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        product={selectedProduct || null}
        variant={editingVariant}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['product-variants', selectedProductId] });
        }}
      />

      {/* 批次建立對話框 */}
      {selectedProduct && (
        <VariantBatchCreator
          open={isBatchOpen}
          onOpenChange={setIsBatchOpen}
          product={selectedProduct}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['product-variants', selectedProductId] });
          }}
        />
      )}
    </div>
  );
}
