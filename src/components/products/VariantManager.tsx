// src/components/products/VariantManager.tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';
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
import { StandaloneDeviceModelSelectField, type DeviceSelectionRef } from './StandaloneDeviceModelSelectField';
import { entityRelationService } from '@/services/entityRelationService';

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

const COLOR_GROUP_NAME_RE = /(顏色|色|color)/i;
function isColorGroupName(name: string): boolean {
  return COLOR_GROUP_NAME_RE.test(name);
}

interface BatchEditEntry {
  field: string;
  value: string;
  optionGroupId?: string;
  optionValueId?: string;
  newOptionValueLabel?: string;
  newOptionValueHex?: string;
  modelRefs?: DeviceSelectionRef[];
}

export function VariantManager({ products, search }: VariantManagerProps) {
  const queryClient = useQueryClient();
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isBatchOpen, setIsBatchOpen] = useState(false);
  const [editingVariant, setEditingVariant] = useState<ProductVariant | null>(null);
  const [selectedVariantIds, setSelectedVariantIds] = useState<Set<string>>(new Set());
  const [isBatchEditOpen, setIsBatchEditOpen] = useState(false);
  const [batchEditEntries, setBatchEditEntries] = useState<BatchEditEntry[]>([]);

  // 篩選產品（所有產品皆有變體）
  const productsWithVariants = products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.code || '').toLowerCase().includes(search.toLowerCase())
  );

  const selectedProduct = products.find(p => p.id === selectedProductId);

  // 取得選定產品的變體與選項資料
  const { data: variants = [], isLoading: variantsLoading } = useQuery({
    queryKey: ['product-variants', selectedProductId],
    queryFn: async () => {
      if (!selectedProductId) return [];
      const { data: variantsData, error: variantsError } = await (supabase
        .from('product_variants' as any)
        .select('*' as any) as any)
        .eq('product_id' as any, selectedProductId as any)
        .order('sku');

      if (variantsError) throw variantsError;

      const normalizedVariants = (variantsData ?? []) as unknown as ProductVariant[];
      if (normalizedVariants.length === 0) return [];

      const variantIds = normalizedVariants.map(v => v.id);
      const { data: linksData, error: linksError } = await (supabase
        .from('entity_model_relations' as any)
        .select('variant_id, model_id, device_models(name)' as any) as any)
        .eq('relation_type' as any, 'include' as any)
        .not('model_id' as any, 'is' as any, null as any)
        .in('variant_id' as any, variantIds as any);

      if (linksError) throw linksError;

      // 取得此產品的選項群組與值
      const { data: groupsData } = await (supabase
        .from('product_option_groups' as any)
        .select('*, product_option_values(*)' as any) as any)
        .eq('product_id' as any, selectedProductId as any)
        .order('sort_order');

      // 取得變體的選項關聯
      const { data: variantOptsData } = await (supabase
        .from('product_variant_options' as any)
        .select('*' as any) as any)
        .in('variant_id' as any, variantIds as any);

      // 建立值查詢表
      const valueMap: Record<string, { label: string; hexCode: string | null; groupName: string }> = {};
      const groups = (groupsData ?? []) as any[];
      for (const group of groups) {
        const values = (group as any).product_option_values ?? [];
        for (const val of values) {
          valueMap[val.id] = {
            label: val.label,
            hexCode: val.hex_code,
            groupName: group.name,
          };
        }
      }

      // 建立各變體的選項顯示資料
      const variantOptionsMap: Record<string, Array<{ label: string; hexCode: string | null; groupName: string }>> = {};
      const opts = (variantOptsData ?? []) as any[];
      for (const opt of opts) {
        const vId = opt.variant_id;
        if (!variantOptionsMap[vId]) variantOptionsMap[vId] = [];
        const valInfo = valueMap[opt.option_value_id];
        if (valInfo) {
          variantOptionsMap[vId].push(valInfo);
        }
      }

      return normalizedVariants.map(v => ({
        ...v,
        device_model_links: ((linksData ?? []) as Array<{ variant_id: string; model_id: string; device_models?: { name?: string | null } | null }>).filter((link) => link.variant_id === v.id),
        optionDisplays: variantOptionsMap[v.id] || [],
      }));
    },
    enabled: !!selectedProductId,
  });

  const { data: optionGroupsData = [] } = useQuery({
    queryKey: ['product-option-groups', selectedProductId],
    queryFn: async () => {
      if (!selectedProductId) return [] as any[];
      const { data, error } = await (supabase.from('product_option_groups') as any)
        .select('*, product_option_values(*)')
        .eq('product_id', selectedProductId)
        .order('sort_order');
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: !!selectedProductId,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await (supabase.rpc as any)('delete_variant_if_safe', { p_variant_id: id });
      if (error) throw error;
      const result = data as { ok?: boolean; reason?: string; adopted_by?: Array<{ label?: string }> } | null;
      if (result && result.ok === false) {
        const err = new Error(result.reason || '刪除失敗') as any;
        const labels = (result.adopted_by || []).map((b: any) => b?.label).filter(Boolean).join('、');
        err.hint = labels ? `被引用：${labels}` : '';
        err.reason = result.reason;
        throw err;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product-variants', selectedProductId] });
      toast.success('變體已刪除');
    },
    onError: (error: any) => {
      toast.error(error?.reason ? `刪除失敗：${error.reason}` : `刪除失敗：${getErrorMessage(error)}`, {
        description: error?.hint || undefined,
      });
    },
  });

  const batchDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const results: string[] = [];
      const blocked: Array<{ id: string; reason: string; hint?: string }> = [];
      for (const id of ids) {
        const { data, error } = await (supabase.rpc as any)('delete_variant_if_safe', { p_variant_id: id });
        if (error) throw error;
        const result = data as { ok?: boolean; reason?: string; adopted_by?: Array<{ label?: string }> } | null;
        if (result && result.ok === false) {
          const labels = (result.adopted_by || []).map((b: any) => b?.label).filter(Boolean).join('、');
          blocked.push({ id, reason: result.reason || '刪除失敗', hint: labels ? `被引用：${labels}` : undefined });
        } else {
          results.push(id);
        }
      }
      if (blocked.length === 0 && results.length === 0) return;
      if (blocked.length > 0) {
        const err = new Error(`有 ${blocked.length} 個變體被引用無法刪除`) as any;
        err.reason = blocked.map(b => b.reason).filter((v, i, a) => a.indexOf(v) === i).join('；');
        err.hint = blocked.map(b => b.hint).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join('；');
        throw err;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product-variants', selectedProductId] });
      setSelectedVariantIds(new Set());
      toast.success('已批量刪除變體');
    },
    onError: (error: any) => {
      toast.error(error?.reason ? `批量刪除失敗：${error.reason}` : `批量刪除失敗：${getErrorMessage(error)}`, {
        description: error?.hint || undefined,
      });
    },
  });

  const batchEditMutation = useMutation({
    mutationFn: async (payload: {
      ids: string[];
      updates: Record<string, any>;
      optionGroupId?: string;
      optionValueId?: string;
      customLabel?: string;
      customHex?: string;
      modelRefs?: DeviceSelectionRef[];
    }) => {
      const { ids, updates, optionGroupId, optionValueId, customLabel, customHex, modelRefs } = payload;

      if (Object.keys(updates).length > 0) {
        const { error } = await (supabase.from('product_variants') as any).update(updates as any).in('id' as any, ids as any);
        if (error) throw error;
      }

      if (optionGroupId) {
        let targetValueId: string | null = null;
        if (optionValueId) {
          targetValueId = optionValueId;
        } else if (customLabel && customLabel.trim()) {
          const existingRow = (optionGroupsData || []).find(g => g.id === optionGroupId)?.product_option_values?.find(
            (v: any) => (v.label || v.value || '').trim().toLowerCase() === customLabel.trim().toLowerCase()
          );
          if (existingRow) {
            targetValueId = existingRow.id;
          } else {
            const { data, error } = await (supabase.from('product_option_values') as any)
              .insert({ group_id: optionGroupId, label: customLabel.trim(), value: customLabel.trim(), hex_code: customHex || null })
              .select('*')
              .single();
            if (error) throw error;
            targetValueId = data.id;
          }
        }
        if (targetValueId) {
          const { error: delErr } = await (supabase.from('product_variant_options') as any)
            .delete().in('variant_id', ids as any).eq('option_group_id', optionGroupId);
          if (delErr) throw delErr;
          const { error: insErr } = await (supabase.from('product_variant_options') as any)
            .insert(ids.map(id => ({ variant_id: id, option_group_id: optionGroupId, option_value_id: targetValueId })));
          if (insErr) throw insErr;
        }
      }

      if (modelRefs && modelRefs.length > 0) {
        for (const id of ids) {
          await entityRelationService.updateRelations('variant', id, {
            modelIds: modelRefs.filter(r => r.type === 'model').map(r => r.id),
            groupIds: modelRefs.filter(r => r.type === 'group').map(r => r.id),
          });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product-variants', selectedProductId] });
      queryClient.invalidateQueries({ queryKey: ['product-option-groups', selectedProductId] });
      setSelectedVariantIds(new Set());
      setIsBatchEditOpen(false);
      toast.success('已批量更新變體');
    },
    onError: (error) => {
      toast.error(`批量更新失敗：${getErrorMessage(error)}`);
    },
  });

  const FIELD_OPTIONS: Array<{ value: string; label: string; type: 'number' | 'text' | 'select' | 'option' | 'model' }> = [
    { value: 'option', label: '選項群組值', type: 'option' },
    { value: 'model', label: '型號', type: 'model' },
    { value: 'wholesale_price', label: '批發價', type: 'number' },
    { value: 'retail_price', label: '零售價', type: 'number' },
    { value: 'status', label: '狀態', type: 'select' },
    { value: 'name', label: '變體名稱', type: 'text' },
    { value: 'barcode', label: '條碼', type: 'text' },
  ];

  const updateBatchEntry = (idx: number, patch: Partial<BatchEditEntry>) => {
    setBatchEditEntries(prev => prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  };

  const handleBatchEdit = () => {
    const updates: Record<string, any> = {};
    let optionGroupId: string | undefined;
    let optionValueId: string | undefined;
    let customLabel: string | undefined;
    let customHex: string | undefined;
    let modelRefs: DeviceSelectionRef[] | undefined;

    for (const entry of batchEditEntries) {
      if (entry.field === 'option') {
        if (!entry.optionGroupId) continue;
        if (entry.optionValueId && entry.optionValueId !== '__custom__') {
          optionGroupId = entry.optionGroupId;
          optionValueId = entry.optionValueId;
        } else if ((entry.newOptionValueLabel || '').trim()) {
          optionGroupId = entry.optionGroupId;
          customLabel = entry.newOptionValueLabel;
          customHex = entry.newOptionValueHex || '';
        }
      } else if (entry.field === 'model') {
        if (entry.modelRefs && entry.modelRefs.length > 0) {
          modelRefs = entry.modelRefs;
        }
      } else {
        const opt = FIELD_OPTIONS.find(o => o.value === entry.field);
        if (!opt || entry.value === '') continue;
        updates[entry.field] = opt.type === 'number' ? parseFloat(entry.value) : entry.value;
      }
    }

    if (Object.keys(updates).length === 0 && !optionGroupId && !modelRefs) {
      toast.error('請至少填寫一個欄位');
      return;
    }

    batchEditMutation.mutate({
      ids: Array.from(selectedVariantIds),
      updates,
      optionGroupId,
      optionValueId,
      customLabel,
      customHex,
      modelRefs,
    });
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
            <SelectValue placeholder="選擇產品" />
          </SelectTrigger>
          <SelectContent>
            {productsWithVariants.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground text-center">
                沒有符合的產品
              </div>
            ) : (
              productsWithVariants.map((product) => (
                <SelectItem key={product.id} value={product.id}>
                  <span className="font-mono text-xs mr-2">{product.code}</span>
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
                代碼: {selectedProduct.code}
                {(selectedProduct as any).primary_brand_name && ` | 廠牌: ${(selectedProduct as any).primary_brand_name}`}
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
                <TableHead>選項</TableHead>
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
                    {Array.from({ length: 8 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-16" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : variants.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
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
                    <TableCell>
                      {((variant as any).optionDisplays?.length > 0) ? (
                        <div className="flex flex-wrap gap-1">
                          {((variant as any).optionDisplays || []).map((opt: any, i: number) => (
                            opt.hexCode ? (
                              <div key={i} className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-secondary text-xs" title={opt.groupName}>
                                <div className="w-2.5 h-2.5 rounded-full border border-black/10 shadow-sm" style={{ backgroundColor: opt.hexCode }} />
                                <span>{opt.label}</span>
                              </div>
                            ) : (
                              <Badge key={i} variant="secondary" className="text-xs">
                                {opt.groupName}: {opt.label}
                              </Badge>
                            )
                          ))}
                        </div>
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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>批次編輯欄位</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {batchEditEntries.map((entry, idx) => {
              const opt = FIELD_OPTIONS.find(o => o.value === entry.field);
              const currentGroup = optionGroupsData.find((g: any) => g.id === entry.optionGroupId);
              const isColorGroup = isColorGroupName(currentGroup?.name || '');
              const customMode = entry.optionValueId === '__custom__';
              return (
                <div key={idx} className="flex items-start gap-2">
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs">欄位</Label>
                    <Select
                      value={entry.field}
                      onValueChange={v => updateBatchEntry(idx, {
                        field: v,
                        value: '',
                        optionGroupId: undefined,
                        optionValueId: undefined,
                        newOptionValueLabel: undefined,
                        newOptionValueHex: undefined,
                        modelRefs: undefined,
                      })}
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
                      <Select value={entry.value} onValueChange={v => updateBatchEntry(idx, { value: v })}>
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
                    ) : opt?.type === 'option' ? (
                      <div className="space-y-2">
                        <Select
                          value={entry.optionGroupId || ''}
                          onValueChange={v => updateBatchEntry(idx, { optionGroupId: v, optionValueId: undefined, newOptionValueLabel: undefined, newOptionValueHex: undefined })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="選擇選項群組" />
                          </SelectTrigger>
                          <SelectContent>
                            {optionGroupsData.length === 0 ? (
                              <div className="px-3 py-2 text-sm text-muted-foreground">此產品尚無選項群組</div>
                            ) : optionGroupsData.map((g: any) => (
                              <SelectItem key={g.id} value={g.id}>{g.name || '（未命名群組）'}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {currentGroup && (
                          <>
                            <Select
                              value={customMode ? '__custom__' : entry.optionValueId || ''}
                              onValueChange={v => {
                                if (v === '__custom__') {
                                  updateBatchEntry(idx, { optionValueId: '__custom__' });
                                } else {
                                  updateBatchEntry(idx, { optionValueId: v, newOptionValueLabel: undefined, newOptionValueHex: undefined });
                                }
                              }}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder={customMode ? '輸入新值' : '選擇值或輸入新值'} />
                              </SelectTrigger>
                              <SelectContent>
                                {(currentGroup.product_option_values || []).map((v: any) => (
                                  <SelectItem key={v.id} value={v.id}>
                                    <span className="flex items-center gap-1.5">
                                      {v.hex_code ? (
                                        <span className="inline-block w-3 h-3 rounded-full border border-black/10 shrink-0" style={{ backgroundColor: v.hex_code }} />
                                      ) : null}
                                      {v.label}
                                    </span>
                                  </SelectItem>
                                ))}
                                <SelectItem value="__custom__">＋ 輸入新值…</SelectItem>
                              </SelectContent>
                            </Select>
                            {customMode && (
                              <div className="flex items-center gap-2">
                                <Input
                                  className="h-8 flex-1"
                                  placeholder="新值名稱"
                                  value={entry.newOptionValueLabel || ''}
                                  onChange={e => updateBatchEntry(idx, { newOptionValueLabel: e.target.value })}
                                />
                                {isColorGroup && (
                                  <>
                                    <Input
                                      className="h-8 w-[110px] font-mono"
                                      placeholder="#RRGGBB"
                                      maxLength={7}
                                      value={entry.newOptionValueHex || ''}
                                      onChange={e => updateBatchEntry(idx, { newOptionValueHex: e.target.value })}
                                    />
                                    {entry.newOptionValueHex && /^#[0-9a-fA-F]{6}$/.test(entry.newOptionValueHex) && (
                                      <span className="w-5 h-5 rounded border shrink-0" style={{ backgroundColor: entry.newOptionValueHex }} />
                                    )}
                                  </>
                                )}
                              </div>
                            )}
                            {isColorGroup && (
                              <p className="text-[11px] text-muted-foreground">顏色群組：可套用既有值，或輸入新值並填色碼</p>
                            )}
                          </>
                        )}
                      </div>
                    ) : opt?.type === 'model' ? (
                      <StandaloneDeviceModelSelectField
                        selectionOrder={entry.modelRefs || []}
                        onOrderChange={refs => updateBatchEntry(idx, { modelRefs: refs })}
                      />
                    ) : (
                      <Input
                        type={opt?.type === 'number' ? 'number' : 'text'}
                        step={opt?.type === 'number' ? '0.01' : undefined}
                        placeholder="輸入新值"
                        value={entry.value}
                        onChange={e => updateBatchEntry(idx, { value: e.target.value })}
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
          <p className="text-lg">請先選擇一個產品</p>
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
