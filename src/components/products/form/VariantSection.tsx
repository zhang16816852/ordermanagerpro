import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Layers, Pencil, Trash2, ShoppingCart, CheckSquare, Edit3, ReplaceAll, Search } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { VariantBatchCreator } from './VariantBatchCreator';
import { VariantEditDialog } from '@/components/products/VariantEditDialog';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';
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
  const [selectedVariantIds, setSelectedVariantIds] = useState<Set<string>>(new Set());
  const [isBatchEditOpen, setIsBatchEditOpen] = useState(false);
  const [batchEditEntries, setBatchEditEntries] = useState<Array<{ field: string; value: string }>>([]);
  const [isReplaceOpen, setIsReplaceOpen] = useState(false);
  const [replaceScope, setReplaceScope] = useState<'all' | 'selected'>('selected');
  const [replaceFind, setReplaceFind] = useState('');
  const [replaceWith, setReplaceWith] = useState('');
  const [replaceFields, setReplaceFields] = useState<Set<string>>(new Set(['name', 'option_1', 'option_2', 'option_3', 'sku']));
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

  const handleBatchDelete = async () => {
    if (selectedVariantIds.size === 0) return;
    if (!confirm(`確定要刪除所選的 ${selectedVariantIds.size} 個變體？`)) return;
    const { error } = await supabase.from('product_variants').delete().in('id', Array.from(selectedVariantIds));
    if (error) {
      toast.error('批量刪除失敗');
    } else {
      toast.success('已批量刪除變體');
      setSelectedVariantIds(new Set());
      refreshVariants();
    }
  };

  const FIELD_OPTIONS: Array<{ value: string; label: string; type: 'number' | 'text' | 'select' }> = [
    { value: 'wholesale_price', label: '批發價', type: 'number' },
    { value: 'retail_price', label: '零售價', type: 'number' },
    { value: 'status', label: '狀態', type: 'select' },
    { value: 'name', label: '變體名稱', type: 'text' },
    { value: 'option_1', label: '選項1', type: 'text' },
    { value: 'option_2', label: '選項2', type: 'text' },
    { value: 'barcode', label: '條碼', type: 'text' },
  ];

  const REPLACE_FIELDS: Array<{ value: string; label: string }> = [
    { value: 'name', label: '變體名稱' },
    { value: 'option_1', label: '選項1' },
    { value: 'option_2', label: '選項2' },
    { value: 'option_3', label: '顏色' },
    { value: 'sku', label: 'SKU' },
    { value: 'barcode', label: '條碼' },
  ];

  const replacePreview = useMemo(() => {
    if (!variants || !replaceFind || replaceFields.size === 0) return [];

    const targetVariants = replaceScope === 'selected'
      ? variants.filter(v => selectedVariantIds.has(v.id))
      : variants;

    return targetVariants.filter(v => {
      for (const field of replaceFields) {
        const val = (v as any)[field];
        if (typeof val === 'string' && val.includes(replaceFind)) return true;
      }
      return false;
    });
  }, [variants, replaceFind, replaceFields, replaceScope, selectedVariantIds]);

  const handleReplace = async () => {
    if (!replaceFind || replaceFields.size === 0 || !variants) return;

    const targetVariants = replaceScope === 'selected'
      ? variants.filter(v => selectedVariantIds.has(v.id))
      : variants;

    const changedVariants: any[] = [];

    for (const v of targetVariants) {
      let changed = false;
      const newV = { ...v };
      for (const field of replaceFields) {
        const oldVal = (v as any)[field];
        if (typeof oldVal === 'string' && oldVal.includes(replaceFind)) {
          (newV as any)[field] = oldVal.replaceAll(replaceFind, replaceWith);
          changed = true;
        }
      }
      if (changed) changedVariants.push(newV);
    }

    if (changedVariants.length === 0) {
      toast.info('沒有符合的變體需要取代');
      return;
    }

    const { error } = await supabase.from('product_variants').upsert(changedVariants, { onConflict: 'id' });
    if (error) {
      toast.error(`取代失敗：${getErrorMessage(error)}`);
    } else {
      toast.success(`已取代 ${changedVariants.length} 個變體`);
      setIsReplaceOpen(false);
      setSelectedVariantIds(new Set());
      refreshVariants();
    }
  };

  const handleBatchEdit = async () => {
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
    const { error } = await supabase.from('product_variants').update(updates).in('id', Array.from(selectedVariantIds));
    if (error) {
      toast.error(`批量更新失敗：${getErrorMessage(error)}`);
    } else {
      toast.success('已批量更新變體');
      setSelectedVariantIds(new Set());
      setIsBatchEditOpen(false);
      refreshVariants();
    }
  };

  const toggleSelectAll = (checked: boolean) => {
    if (!variants) return;
    setSelectedVariantIds(checked ? new Set(variants.map(v => v.id)) : new Set());
  };

  const toggleSelectVariant = (id: string) => {
    setSelectedVariantIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
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
          <Button size="sm" variant="outline" onClick={() => { setReplaceScope('all'); setIsReplaceOpen(true); }}>
            <ReplaceAll className="mr-2 h-4 w-4" /> 取代全部
          </Button>
          <Button size="sm" onClick={() => { setEditingVariant(null); setIsDialogOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" /> 新增單一
          </Button>
        </div>
      </div>

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
            <Button variant="outline" size="sm" onClick={() => { setReplaceScope('selected'); setIsReplaceOpen(true); }}>
              <ReplaceAll className="mr-1 h-4 w-4" />
              取代所選
            </Button>
            <Button variant="destructive" size="sm" onClick={handleBatchDelete}>
              <Trash2 className="mr-1 h-4 w-4" />
              刪除所選
            </Button>
          </div>
        </div>
      )}

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={!!variants?.length && selectedVariantIds.size === variants.length}
                  ref={(el) => { if (el) el.indeterminate = selectedVariantIds.size > 0 && selectedVariantIds.size < (variants?.length || 0); }}
                  onChange={(e) => toggleSelectAll(e.target.checked)}
                />
              </TableHead>
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
                  <TableCell><Skeleton className="h-4 w-4" /></TableCell>
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
                <TableCell colSpan={11} className="h-32 text-center text-muted-foreground">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <Layers className="h-8 w-8 opacity-20" />
                    <p>尚未建立任何變體，請點擊「批次產生」快速建立。</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              variants?.map((v) => (
                <TableRow key={v.id} className={`group ${selectedVariantIds.has(v.id) ? 'bg-muted/50' : ''}`}>
                  <TableCell>
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={selectedVariantIds.has(v.id)}
                      onChange={() => toggleSelectVariant(v.id)}
                    />
                  </TableCell>
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
            <Button onClick={handleBatchEdit}>
              更新 {selectedVariantIds.size} 個變體
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 取代對話框 */}
      <Dialog open={isReplaceOpen} onOpenChange={setIsReplaceOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>批次取代變體欄位</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2 flex-1 overflow-y-auto">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Search className="h-4 w-4" />
              作用範圍：
              {replaceScope === 'selected'
                ? `已選取 ${selectedVariantIds.size} 個變體`
                : `全部 ${variants?.length || 0} 個變體`
              }
              {selectedVariantIds.size > 0 && (
                <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setReplaceScope(replaceScope === 'all' ? 'selected' : 'all')}>
                  {replaceScope === 'all' ? '改為已選取' : '改為全部'}
                </Button>
              )}
            </div>

            <div className="space-y-2">
              <Label>目標欄位</Label>
              <div className="flex flex-wrap gap-3">
                {REPLACE_FIELDS.map(f => (
                  <label key={f.value} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={replaceFields.has(f.value)}
                      onChange={() => {
                        setReplaceFields(prev => {
                          const next = new Set(prev);
                          if (next.has(f.value)) next.delete(f.value);
                          else next.add(f.value);
                          return next;
                        });
                      }}
                    />
                    {f.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>尋找文字</Label>
                <Input
                  placeholder="輸入要取代的文字..."
                  value={replaceFind}
                  onChange={e => setReplaceFind(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>取代為</Label>
                <Input
                  placeholder="輸入新文字..."
                  value={replaceWith}
                  onChange={e => setReplaceWith(e.target.value)}
                />
              </div>
            </div>

            {replaceFind && replaceFields.size > 0 && (
              <div className="space-y-2">
                <Label>預覽（符合 {replacePreview.length} 個變體）</Label>
                <div className="border rounded-md max-h-60 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>變體</TableHead>
                        <TableHead>變更內容</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {replacePreview.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={2} className="text-center text-muted-foreground py-8">
                            無符合項目
                          </TableCell>
                        </TableRow>
                      ) : (
                        replacePreview.map(v => {
                          const changes: { field: string; oldVal: string; newVal: string }[] = [];
                          for (const field of replaceFields) {
                            const val = (v as any)[field];
                            if (typeof val === 'string' && val.includes(replaceFind)) {
                              changes.push({
                                field: REPLACE_FIELDS.find(f => f.value === field)?.label || field,
                                oldVal: val,
                                newVal: val.replaceAll(replaceFind, replaceWith),
                              });
                            }
                          }
                          return (
                            <TableRow key={v.id}>
                              <TableCell className="font-medium">{v.name}</TableCell>
                              <TableCell>
                                <div className="text-xs space-y-0.5">
                                  {changes.map((c, i) => (
                                    <div key={i} className="text-muted-foreground">
                                      <span className="font-medium">{c.field}</span>:
                                      "<span className="line-through">{c.oldVal}</span>"
                                      → "<span className="text-primary">{c.newVal}</span>"
                                    </div>
                                  ))}
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" onClick={() => setIsReplaceOpen(false)}>取消</Button>
            <Button
              onClick={handleReplace}
              disabled={!replaceFind || replaceFields.size === 0 || replacePreview.length === 0}
            >
              <ReplaceAll className="mr-2 h-4 w-4" />
              取代 {replacePreview.length} 個變體
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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