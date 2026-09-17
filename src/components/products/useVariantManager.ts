import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';
import { entityRelationService } from '@/services/entityRelationService';
import type { DeviceSelectionRef } from './StandaloneDeviceModelSelectField';
import type {
  Product,
  ProductVariant,
  BatchEditEntry,
  BatchEditPayload,
  OptionGroupRow,
  VariantWithExtras,
  ModelLink,
  OptionDisplay,
} from './variantManagerTypes';
import { FIELD_OPTIONS } from './variantManagerTypes';

export function useVariantManager({ products, search }: { products: Product[]; search: string }) {
  const queryClient = useQueryClient();
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isBatchOpen, setIsBatchOpen] = useState(false);
  const [editingVariant, setEditingVariant] = useState<ProductVariant | null>(null);
  const [selectedVariantIds, setSelectedVariantIds] = useState<Set<string>>(new Set());
  const [isBatchEditOpen, setIsBatchEditOpen] = useState(false);
  const [batchEditEntries, setBatchEditEntries] = useState<BatchEditEntry[]>([]);

  const productsWithVariants = products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.code || '').toLowerCase().includes(search.toLowerCase())
  );

  const selectedProduct = products.find(p => p.id === selectedProductId);

  const { data: variants = [], isLoading: variantsLoading } = useQuery<VariantWithExtras[]>({
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

      const { data: groupsData } = await (supabase
        .from('product_option_groups' as any)
        .select('*, product_option_values(*)' as any) as any)
        .eq('product_id' as any, selectedProductId as any)
        .order('sort_order');

      const { data: variantOptsData } = await (supabase
        .from('product_variant_options' as any)
        .select('*' as any) as any)
        .in('variant_id' as any, variantIds as any);

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
        device_model_links: ((linksData ?? []) as unknown as ModelLink[]).filter((link) => link.variant_id === v.id),
        optionDisplays: variantOptionsMap[v.id] || ([] as OptionDisplay[]),
      }));
    },
    enabled: !!selectedProductId,
  });

  const { data: optionGroupsData = [] } = useQuery<OptionGroupRow[]>({
    queryKey: ['product-option-groups', selectedProductId],
    queryFn: async () => {
      if (!selectedProductId) return [];
      const { data, error } = await (supabase.from('product_option_groups') as any)
        .select('*, product_option_values(*)')
        .eq('product_id', selectedProductId)
        .order('sort_order');
      if (error) throw error;
      return (data || []) as OptionGroupRow[];
    },
    enabled: !!selectedProductId,
  });

  const invalidateVariants = () => {
    queryClient.invalidateQueries({ queryKey: ['product-variants', selectedProductId] });
  };

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
      invalidateVariants();
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
      invalidateVariants();
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
    mutationFn: async (payload: BatchEditPayload) => {
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
            (v) => (v.label || v.value || '').trim().toLowerCase() === customLabel.trim().toLowerCase()
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
      invalidateVariants();
      queryClient.invalidateQueries({ queryKey: ['product-option-groups', selectedProductId] });
      setSelectedVariantIds(new Set());
      setIsBatchEditOpen(false);
      toast.success('已批量更新變體');
    },
    onError: (error) => {
      toast.error(`批量更新失敗：${getErrorMessage(error)}`);
    },
  });

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

  const openEditDialog = (variant: ProductVariant | null) => {
    setEditingVariant(variant);
    setIsDialogOpen(true);
  };

  const handleSelectProduct = (id: string) => {
    setSelectedProductId(id);
    setSelectedVariantIds(new Set());
  };

  return {
    selectedProductId,
    isDialogOpen,
    setIsDialogOpen,
    isBatchOpen,
    setIsBatchOpen,
    editingVariant,
    selectedVariantIds,
    setSelectedVariantIds,
    isBatchEditOpen,
    setIsBatchEditOpen,
    batchEditEntries,
    setBatchEditEntries,
    productsWithVariants,
    selectedProduct,
    variants,
    variantsLoading,
    optionGroupsData,
    updateBatchEntry,
    handleBatchEdit,
    toggleSelectAll,
    toggleSelectVariant,
    openEditDialog,
    handleSelectProduct,
    invalidateVariants,
    deleteMutation,
    batchDeleteMutation,
    batchEditMutation,
  };
}