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
import { Plus, Pencil, Trash2, Layers, Search, CheckSquare, Edit3 } from 'lucide-react';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';
import { Skeleton } from '@/components/ui/skeleton';
import { VariantBatchCreator } from './form/VariantBatchCreator';
import { VariantEditDialog } from './VariantEditDialog';
import { useProductColors } from '@/hooks/useProductColors';
import { getContrastColor } from '@/utils/colorUtils';
import { useBrands } from '@/hooks/useBrands';

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
  const { colors } = useProductColors();
  const { getBrandName } = useBrands();
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isBatchOpen, setIsBatchOpen] = useState(false);
  const [editingVariant, setEditingVariant] = useState<ProductVariant | null>(null);
  const [selectedVariantIds, setSelectedVariantIds] = useState<Set<string>>(new Set());
  const [isBatchEditOpen, setIsBatchEditOpen] = useState(false);
  const [batchEditEntries, setBatchEditEntries] = useState<Array<{ field: string; value: string }>>([]);

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
      const { data: variants, error: variantsError } = await supabase
        .from('product_variants')
        .select('*')
        .eq('product_id', selectedProductId)
        .order('sku');
      
      if (variantsError) throw variantsError;
      if (!variants || variants.length === 0) return [];

      const variantIds = variants.map(v => v.id);
      const { data: linksData, error: linksError } = await supabase
        .from('entity_model_relations')
        .select('variant_id, model_id, device_models(name)')
        .eq('relation_type', 'include')
        .not('model_id', 'is', null)
        .in('variant_id', variantIds);
      
      if (linksError) throw linksError;

      return variants.map(v => ({
        ...v,
        device_model_links: linksData?.filter(link => link.variant_id === v.id) || []
      }));
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
      toast.error(`刪除失敗：${getErrorMessage(error)}`);
    },
  });

  const batchDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from('product_variants').delete().in('id', ids);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product-variants', selectedProductId] });
      setSelectedVariantIds(new Set());
      toast.success('已批量刪除變體');
    },
    onError: (error) => {
      toast.error(`批量刪除失敗：${getErrorMessage(error)}`);
    },
  });

  const batchEditMutation = useMutation({
    mutationFn: async ({ ids, updates }: { ids: string[]; updates: Record<string, any> }) => {
      const { error } = await supabase.from('product_variants').update(updates).in('id', ids);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product-variants', selectedProductId] });
      setSelectedVariantIds(new Set());
      setIsBatchEditOpen(false);
      toast.success('已批量更新變體');
    },
    onError: (error) => {
      toast.error(`批量更新失敗：${getErrorMessage(error)}`);
    },
  });

  const FIELD_OPTIONS: Array<{ value: string; label: string; type: 'number' | 'text' | 'select' }> = [
    { value: 'wholesale_price', label: '批發價', type: 'number' },
    { value: 'retail_price', label: '零售價', type: 'number' },
    { value: 'status', label: '狀態', type: 'select' },
    { value: 'name', label: '變體名稱', type: 'text' },
    { value: 'option_1', label: '選項1', type: 'text' },
    { value: 'option_2', label: '選項2', type: 'text' },
    { value: 'barcode', label: '條碼', type: 'text' },
  ];

  const handleBatchEdit = () => {
    const updates: Record<string, any> = {};
    for (const entry of batchEditEntries) {
      if (entry.value === '') continue;
      const opt = FIELD_OPTIONS.find(o => o.value === entry.field);
      if (!opt) continue;
      updates[entry.field] = opt.type === 'number' ? parseFloat(entry.value) : entry.value;
    }
    if (Object.keys(updates).length === 0) {
      toast.error('請至少填寫一個欄位');
      return;
    }
    batchEditMutation.mutate({ ids: Array.from(selectedVariantIds), updates });
  };

  const toggleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedVariantIds(new Set(variants.map(v => v.id)));
    } else {
      setSelectedVariantIds(new Set());
    }
  };

  const toggleSelectVariant = (id: string) => {
    setSelectedVariantIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
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
        <Select value={selectedProductId || ''} onValueChange={(v) => { setSelectedProductId(v); setSelectedVariantIds(new Set()); }}>
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
                {(selectedProduct as any).primary_brand_name && ` | 廠牌: ${(selectedProduct as any).primary_brand_name}`}
                {selectedProduct.model && ` | 型號: ${selectedProduct.model}`}
              </p>
            </div>
            <Badge variant="secondary">{variants.length} 個變體</Badge>
          </div>
        </div>
      )}

      {/* 批次操作列 */}
      {selectedVariantIds.size > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-muted/50 rounded-lg">
          <CheckSquare className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">已選取 {selectedVariantIds.size} 項</span>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { setBatchEditEntries([]); setIsBatchEditOpen(true); }}>
              <Edit3 className="mr-1 h-4 w-4" />
              批次編輯
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (window.confirm(`確定要刪除所選的 ${selectedVariantIds.size} 個變體？`)) {
                  batchDeleteMutation.mutate(Array.from(selectedVariantIds));
                }
              }}
              disabled={batchDeleteMutation.isPending}
            >
              <Trash2 className="mr-1 h-4 w-4" />
              刪除所選
            </Button>
          </div>
        </div>
      )}

      {/* 變體列表 */}
      {selectedProductId && (
        <div className="rounded-lg border bg-card shadow-soft">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={variants.length > 0 && selectedVariantIds.size === variants.length}
                    ref={(el) => { if (el) el.indeterminate = selectedVariantIds.size > 0 && selectedVariantIds.size < variants.length; }}
                    onChange={(e) => toggleSelectAll(e.target.checked)}
                  />
                </TableHead>
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
                    {Array.from({ length: 10 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-16" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : variants.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                    此產品尚無變體，點擊「新增變體」或「批次建立」開始
                  </TableCell>
                </TableRow>
              ) : (
                variants.map((variant) => (
                  <TableRow key={variant.id} className={selectedVariantIds.has(variant.id) ? 'bg-muted/50' : ''}>
                    <TableCell>
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={selectedVariantIds.has(variant.id)}
                        onChange={() => toggleSelectVariant(variant.id)}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-sm">{variant.sku}</TableCell>
                    <TableCell className="font-medium">{variant.name}</TableCell>
                    <TableCell className="text-muted-foreground">{variant.option_1 || '-'}</TableCell>
                    <TableCell className="text-muted-foreground">{variant.option_2 || '-'}</TableCell>
                    <TableCell>
                      {variant.option_3 ? (
                        (() => {
                          const color = colors.find(c => c.name === variant.option_3);
                          if (color) {
                            return (
                              <div className="flex items-center gap-1.5">
                                <div 
                                  className="w-3 h-3 rounded-full border border-black/10 shadow-sm" 
                                  style={{ backgroundColor: color.hex_code }} 
                                />
                                <span>{variant.option_3}</span>
                              </div>
                            );
                          }
                          return variant.option_3;
                        })()
                      ) : '-'}
                    </TableCell>
                    <TableCell className="text-right">${variant.wholesale_price}</TableCell>
                    <TableCell className="text-right">${variant.retail_price}</TableCell>
                    <TableCell>
                      <Badge variant={variant.status === 'active' ? 'default' : 'secondary'}>
                        {STATUS_LABELS[variant.status]}
                      </Badge>
                      {variant.device_model_links && variant.device_model_links.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {variant.device_model_links.map((link: any) => (
                            <Badge key={link.model_id} variant="secondary" className="text-[9px] px-1 h-3.5 bg-amber-100 text-amber-800 hover:bg-amber-100/80 border-transparent">
                              {link.device_models?.name}
                            </Badge>
                          ))}
                        </div>
                      )}
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

      {/* 批次編輯對話框 */}
      <Dialog open={isBatchEditOpen} onOpenChange={setIsBatchEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>批次編輯欄位</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {batchEditEntries.map((entry, idx) => {
              const opt = FIELD_OPTIONS.find(o => o.value === entry.field);
              return (
                <div key={idx} className="flex items-end gap-2">
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs">欄位</Label>
                    <Select
                      value={entry.field}
                      onValueChange={v => setBatchEditEntries(prev => prev.map((e, i) => i === idx ? { ...e, field: v, value: '' } : e))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="選擇欄位" />
                      </SelectTrigger>
                      <SelectContent>
                        {FIELD_OPTIONS.filter(o => !batchEditEntries.some((e, i) => i !== idx && e.field === o.value)).map(o => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex-[2] space-y-1">
                    <Label className="text-xs">新值</Label>
                    {opt?.type === 'select' ? (
                      <Select value={entry.value} onValueChange={v => setBatchEditEntries(prev => prev.map((e, i) => i === idx ? { ...e, value: v } : e))}>
                        <SelectTrigger>
                          <SelectValue placeholder="選擇狀態" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">上架中</SelectItem>
                          <SelectItem value="preorder">預購中</SelectItem>
                          <SelectItem value="sold_out">售完停產</SelectItem>
                          <SelectItem value="discontinued">已停售</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        type={opt?.type === 'number' ? 'number' : 'text'}
                        step={opt?.type === 'number' ? '0.01' : undefined}
                        placeholder="輸入新值"
                        value={entry.value}
                        onChange={e => setBatchEditEntries(prev => prev.map((ent, i) => i === idx ? { ...ent, value: e.target.value } : ent))}
                      />
                    )}
                  </div>
                  <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-destructive" onClick={() => setBatchEditEntries(prev => prev.filter((_, i) => i !== idx))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
            <Button variant="outline" size="sm" className="w-full" onClick={() => setBatchEditEntries(prev => [...prev, { field: '', value: '' }])}>
              <Plus className="mr-1 h-4 w-4" /> 增加欄位
            </Button>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" onClick={() => setIsBatchEditOpen(false)}>取消</Button>
            <Button onClick={handleBatchEdit} disabled={batchEditMutation.isPending}>
              更新 {selectedVariantIds.size} 個變體
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
