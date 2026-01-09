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
import { VariantBatchCreator } from './VariantBatchCreator';

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

  const createMutation = useMutation({
    mutationFn: async (variant: VariantInsert) => {
      const { error } = await supabase.from('product_variants').insert(variant);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product-variants', selectedProductId] });
      toast.success('變體已新增');
      setIsDialogOpen(false);
    },
    onError: (error) => {
      toast.error(`新增失敗：${error.message}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ProductVariant> & { id: string }) => {
      const { error } = await supabase.from('product_variants').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product-variants', selectedProductId] });
      toast.success('變體已更新');
      setIsDialogOpen(false);
      setEditingVariant(null);
    },
    onError: (error) => {
      toast.error(`更新失敗：${error.message}`);
    },
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

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const variantData = {
      product_id: selectedProductId!,
      sku: formData.get('sku') as string,
      name: formData.get('name') as string,
      barcode: formData.get('barcode') as string || null,
      color: formData.get('color') as string || null,
      option_1: formData.get('option_1') as string || null,
      option_2: formData.get('option_2') as string || null,
      option_3: formData.get('option_3') as string || null,
      wholesale_price: parseFloat(formData.get('wholesale_price') as string) || 0,
      retail_price: parseFloat(formData.get('retail_price') as string) || 0,
      status: formData.get('status') as ProductVariant['status'],
    };

    if (editingVariant) {
      updateMutation.mutate({ id: editingVariant.id, ...variantData });
    } else {
      createMutation.mutate(variantData);
    }
  };

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

      {/* 新增/編輯對話框 */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingVariant ? '編輯變體' : '新增變體'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="sku">SKU *</Label>
                <Input
                  id="sku"
                  name="sku"
                  defaultValue={editingVariant?.sku || `${selectedProduct?.sku}-`}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">變體名稱 *</Label>
                <Input
                  id="name"
                  name="name"
                  defaultValue={editingVariant?.name}
                  required
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="option_1">選項1</Label>
                <Input
                  id="option_1"
                  name="option_1"
                  placeholder="如：霧面"
                  defaultValue={editingVariant?.option_1 || ''}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="option_2">選項2</Label>
                <Input
                  id="option_2"
                  name="option_2"
                  placeholder="如：256GB"
                  defaultValue={editingVariant?.option_2 || ''}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="option_3">選項3</Label>
                <Input
                  id="option_3"
                  name="option_3"
                  placeholder="如：白色"
                  defaultValue={editingVariant?.option_3 || ''}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="barcode">條碼</Label>
                <Input
                  id="barcode"
                  name="barcode"
                  defaultValue={editingVariant?.barcode || ''}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="color">顏色備註</Label>
                <Input
                  id="color"
                  name="color"
                  defaultValue={editingVariant?.color || ''}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="wholesale_price">批發價</Label>
                <Input
                  id="wholesale_price"
                  name="wholesale_price"
                  type="number"
                  step="0.01"
                  defaultValue={editingVariant?.wholesale_price || selectedProduct?.base_wholesale_price}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="retail_price">零售價</Label>
                <Input
                  id="retail_price"
                  name="retail_price"
                  type="number"
                  step="0.01"
                  defaultValue={editingVariant?.retail_price || selectedProduct?.base_retail_price}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="status">狀態</Label>
                <Select name="status" defaultValue={editingVariant?.status || 'active'}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">上架中</SelectItem>
                    <SelectItem value="preorder">預購中</SelectItem>
                    <SelectItem value="sold_out">售完停產</SelectItem>
                    <SelectItem value="discontinued">已停售</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={closeDialog}>
                取消
              </Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {editingVariant ? '儲存' : '新增'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

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
